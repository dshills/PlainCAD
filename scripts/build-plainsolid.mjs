import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../", import.meta.url));
const source = process.argv[2];
if (process.argv.length > 3) {
  throw new Error("Usage: npm run kernel:plainsolid -- [/path/to/PlainSolid]");
}
const { revision, go: goVersion } = JSON.parse(await readFile(new URL("plainsolid-pin.json", import.meta.url), "utf8"));
const repository = "https://github.com/dshills/PlainSolid.git";
const env = {
  ...process.env,
  GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0",
  GOENV: "off", GOFLAGS: "", GOEXPERIMENT: "", GOWORK: "off",
  GOTOOLCHAIN: "local", GOPROXY: "off",
};
const version = execFileSync("go", ["env", "GOVERSION"], { env, encoding: "utf8" }).trim();
if (version !== `go${goVersion}`) throw new Error(`Install Go ${goVersion} to build the pinned PlainSolid kernel (found ${version}).`);

const temporary = await mkdtemp(join(tmpdir(), "plaincad-plainsolid-"));
try {
  // Build the committed sources so a developer's worktree cannot change a release asset.
  const checkout = source ? resolve(source) : join(temporary, "repository");
  const git = (args) => execFileSync("git", args, { cwd: checkout });
  if (!source) {
    await mkdir(checkout);
    git(["init", "-q"]);
    git(["fetch", "--no-tags", "--depth=1", repository, revision]);
    if (git(["rev-parse", "FETCH_HEAD"]).toString().trim() !== revision)
      throw new Error("Fetched an unexpected PlainSolid revision.");
  }
  const tree = join(temporary, "source");
  const archive = join(temporary, "source.tar");
  await mkdir(tree);
  git(["archive", "--format=tar", "--output=" + archive, revision]);
  execFileSync("tar", ["-xf", archive, "-C", tree]);
  const wasm = join(temporary, "plainsolid-kernel.wasm");
  execFileSync("go", ["build", "-trimpath", "-buildvcs=false", "-o", wasm, "./cmd/plaincadwasm"], { cwd: tree, env, stdio: "inherit" });
  const goroot = execFileSync("go", ["env", "GOROOT"], { cwd: tree, env, encoding: "utf8" }).trim();
  const glue = join(goroot, "lib", "wasm", "wasm_exec.js");
  const assets = join(app, "src", "cad", "kernel");
  const staged = await mkdtemp(join(assets, ".plainsolid-"));
  try {
    const wasmName = "plainsolid-kernel.wasm";
    const runtimeName = "wasm_exec.js";
    const manifestName = "plainsolid-kernel.json";
    const noticeName = "plainsolid-NOTICE.txt";
    await copyFile(wasm, join(staged, wasmName));
    await copyFile(glue, join(staged, runtimeName));
    const plainSolidLicense = await readFile(join(tree, "LICENSE"), "utf8");
    const goLicense = await readFile(join(app, "deployment", "go-wasm-LICENSE.txt"), "utf8");
    await writeFile(join(staged, noticeName), `PlainSolid\n\n${plainSolidLicense.trim()}\n\nGo WebAssembly runtime\n\n${goLicense.trim()}\n`);
    const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
    const manifest = {
      revision,
      go: goVersion,
      wasmSha256: await sha256(wasm),
      runtimeSha256: await sha256(glue),
      noticeSha256: await sha256(join(staged, noticeName)),
    };
    await writeFile(join(staged, manifestName), JSON.stringify(manifest, null, 2) + "\n");
    // Publish the manifest last so selected builds can detect a mixed asset set.
    for (const name of [wasmName, runtimeName, noticeName, manifestName]) {
      await rename(join(staged, name), join(assets, name));
    }
    console.log(`Built PlainSolid ${revision} (${manifest.wasmSha256})`);
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
