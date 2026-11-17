import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const examples = new URL("../docs/examples/", import.meta.url);
const requested = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const galleryUrl = process.env.PLAINCAD_GALLERY_URL ?? "http://127.0.0.1:5278";
const captures = [];
let failures = 0;
try {
  const page = await browser.newPage();
  await page.goto(galleryUrl, { waitUntil: "domcontentloaded" });
  const catalog = await page.evaluate(async () => {
    const { GALLERY_EXAMPLES } = await import("/src/ui/workspace/projectGalleryCatalog.ts");
    return GALLERY_EXAMPLES.map(({ id, parts }) => ({ id, parts }));
  });
  const projects = catalog.filter(({ id }) => !requested.length || requested.includes(id));
  if (!projects.length || (requested.length && projects.length !== requested.length)) {
    throw new Error("Specify existing gallery examples by filename without the .pcaddoc suffix.");
  }
  for (const { id, parts } of projects) {
    const filename = `${id}.pcaddoc`;
    try {
      const text = await readFile(new URL(filename, examples), "utf8");
      const cover = await page.evaluate(capture, { filename, text, parts });
      captures.push({ id, image: cover.image });
      console.log(`${filename}: ${parts} native bodies · ${cover.volume.toFixed(6)} mm³ (plainsolid)`);
    } catch (error) {
      failures++;
      console.error(`${filename}: ${error.message}`);
    }
  }
} finally {
  await browser.close();
}
// Writing assets while a Vite page is open can hot-reload the active capture.
for (const { id, image } of captures) {
  await writeFile(new URL(`images/${id}.png`, examples), Buffer.from(image.split(",")[1], "base64"));
}
if (failures) process.exitCode = 1;

async function capture({ filename, text, parts }) {
  const [{ importProjectFile }, { previewModeling }, { bodyComponentId }, THREE] = await Promise.all([
    import("/src/persistence/importProject.ts"),
    import("/src/cad/worker/extrudePreviewClient.ts"),
    import("/src/cad/document/components.ts"),
    import("/node_modules/three/build/three.module.js"),
  ]);
  const signal = AbortSignal.timeout(45000);
  const document = await importProjectFile(new File([text], filename), signal);
  const result = await previewModeling(document, signal);
  const meshes = result.meshes;
  if (!result.success) throw new Error(result.errors.map(error => error.message).join(" "));
  if (meshes.length !== parts || meshes.some(mesh => mesh.geometrySource !== "plainsolid" || !mesh.geometryAssertions?.valid ||
    mesh.geometryAssertions.solidCount < 1 || !Number.isFinite(mesh.geometryAssertions.volume) || mesh.geometryAssertions.volume <= 0)) {
    throw new Error(`Expected ${parts} valid bodies from the PlainSolid browser worker, got ${meshes.length}.`);
  }

  // Fit the projected native vertices so tall and wide subjects use the same
  // frame and padding. The orthographic camera never includes CAD overlays.
  const width = 768;
  const height = 480;
  const aspect = width / height;
  const bounds = new THREE.Box3();
  for (const mesh of meshes) {
    bounds.expandByPoint(new THREE.Vector3(...mesh.bounds.min));
    bounds.expandByPoint(new THREE.Vector3(...mesh.bounds.max));
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const span = bounds.getSize(new THREE.Vector3()).length();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.set(1.45, -1.75, 1.28).setLength(4);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const frame = new THREE.Box3();
  const point = new THREE.Vector3();
  const finishes = { aluminum: 0x689fa9, steel: 0x657f9b, brass: 0xb18c54, polymer: 0x407b82 };

  try {
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    scene.background = new THREE.Color(0xeaf0f1);
    for (const mesh of meshes) {
      const positions = Float32Array.from(mesh.positions);
      for (let index = 0; index < positions.length; index += 3) {
        point.fromArray(positions, index).sub(center).divideScalar(span).toArray(positions, index);
        frame.expandByPoint(point.applyMatrix4(camera.matrixWorldInverse));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(mesh.normals), 3));
      geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.indices), 1));
      const componentId = bodyComponentId(document, mesh.bodyId);
      const appearance = componentId ? document.components[componentId]?.appearance : undefined;
      const solid = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: finishes[appearance] ?? finishes.aluminum, roughness: 0.67 }));
      solid.castShadow = true;
      solid.receiveShadow = true;
      scene.add(solid);
    }
    const halfHeight = Math.max(frame.max.y - frame.min.y, (frame.max.x - frame.min.x) / aspect) * 0.61;
    const midX = (frame.max.x + frame.min.x) / 2;
    const midY = (frame.max.y + frame.min.y) / 2;
    camera.left = midX - halfHeight * aspect;
    camera.right = midX + halfHeight * aspect;
    camera.top = midY + halfHeight;
    camera.bottom = midY - halfHeight;
    camera.updateProjectionMatrix();

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.17 }));
    floor.position.z = (bounds.min.z - center.z) / span - 0.003;
    floor.receiveShadow = true;
    scene.add(floor, new THREE.HemisphereLight(0xf5faff, 0x8795a4, 2));
    const key = new THREE.DirectionalLight(0xfff8ed, 2.4);
    key.position.set(-2, -3, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 12 });
    key.shadow.normalBias = 0.006;
    scene.add(key);
    renderer.render(scene, camera);
    return {
      image: renderer.domElement.toDataURL("image/png"),
      volume: meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions.volume, 0),
    };
  } finally {
    scene.traverse(object => {
      if (object.isMesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
      if (object.isLight) object.dispose();
    });
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
