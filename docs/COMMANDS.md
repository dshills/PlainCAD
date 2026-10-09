# Shared commands

PlainCAD's UI, browser API and CLI use one runtime registry in
`src/commands/registry.ts`. CAD edits retain the same document history, native
preview checks, rebuild scheduling and stale-result guards as interactive use.
Requests accept JSON data, never JavaScript functions or kernel handles.

## Browser API

```typescript
const discovered = await window.plaincadCommands.list();
if (!discovered.ok) throw new Error(discovered.error.message);
const { session } = discovered.value;
const response = await window.plaincadCommands.execute({
  command: "parameter.update", session,
  arguments: { parameterId: "thickness-parameter", patch: { expression: "8mm" } },
});
```

Discovery returns IDs, descriptions, input schemas, source locations and current
bindings with their target IDs, labels, availability/reason and control state.
Responses are `{ok:true,command,value}` or `{ok:false,command,error:{code,message}}`.
`result_unavailable` specifically means execution occurred but a bounded JSON
result could not be returned; inspect the snapshot rather than retrying a mutation.
Check `ok` before accessing `value`. Choose a `target` when multiple bindings share
an ID. Except discovery and `runtime.snapshot`, requests require the current
project session. Opening/replacing a project invalidates earlier sessions even
when its document ID is unchanged. Refresh discovery after replacement.
Payload size, depth, unknown fields and unsafe object keys are checked.

The browser API is intentionally available in both development and production.
It is an interface for trusted code in the app's browser session, not a security
boundary against scripts or extensions that already control that session.
Production keeps its existing CSP; the API grants no filesystem or provider-key
access. Project import validation and current-session checks still apply.

Stable domain commands include `document.import`, `document.serialize`,
`parameter.update`, `selection.set`, sketch/modeling commands, history undo/redo
and file actions. `document.import` takes `{text}`; `file.openProject` takes
`{file:{name,text,type}}`. Both preserve the import safety boundary.
Some commands open dialogs, such as multi-body STL export; discover and use their
mounted controls to configure and apply the task.

## UI interaction commands

The Vite transform in `scripts/command-instrumentation.ts` routes JSX callbacks,
intrinsic controls and project-owned native input listeners through the registry.
It runs in development, production and component tests. Source coverage tests
check every current interaction and the syntax of transformed files.
New handlers enter the registry without a separate scripting implementation.

Generated interaction IDs are source-derived; target IDs identify mounted React
instances. Rediscover them after source edits or remounts. Prefer stable domain
IDs for reusable workflows. Open tools with domain commands, then discover their
mounted field/button bindings. Fields use `onChange` with `{value}` or `{checked}`.
Draft fields that commit on blur need `onFocus`, `onChange`, then `onBlur` or Enter.
The transport flushes React updates between commands.
Focus/blur results report `focused` and `changed`; focusing an unfocusable target
fails clearly. An already focused/blurred field reports an unchanged state.

Hidden, disabled, inert and outside-modal controls are unavailable. Read-only
fields and disabled/unknown select options reject edits. Form submission requires
an enabled submit button and valid fields. Custom React callbacks are local
adapters: external callers use their actual DOM controls. Runtime preview frames
cannot be manufactured from JSON to bypass Apply guards.

Native pointer/mouse/wheel gestures use the CLI's Chromium input transport, which
supports real pointer capture. Coordinates are `{x,y}` target fractions (0–1) or
absolute `{clientX,clientY}`. It currently supports mouse pointer ID 1. The plain
browser API reports a diagnostic without a native input transport. Drag/drop
adapters accept MIME-to-string `data` and bounded `{name,type,text}` file DTOs;
they do not read arbitrary paths. Third-party OrbitControls input receives native
browser gestures; its internal library callbacks are not public commands.

## Completion and downloads

Interaction receipts report `dispatched` and whether the registered handler was
`invoked`; listener exceptions and returned Promise failures reach the caller.
Interaction execution confirms dispatch; native geometry or asynchronous work
may still be pending. `runtime.snapshot` reports current geometry proof, errors,
history and project data. `runtime.awaitNative` waits for a nonempty current
OpenCascade result with valid solid assertions. Empty models, fallback meshes,
failed builds and intervening edits produce diagnostics. `runtime.waitForCommand`
waits for an available command ID or label/property, such as an Apply button.

`runtime.artifacts` reports the latest 64 initiated downloads with sequence,
filename, MIME type and byte count. `runtime.awaitArtifact` waits for a sequence
greater than `arguments.after`. This records delivery intent, not a completed
filesystem write. The CLI's `awaitArtifact` flag also waits for Chromium's real
download and save. Runtime bindings, meshes and download bytes are never persisted
in project JSON.

## CLI and agents

Start `npm run dev`, install Chromium (`npx playwright install chromium`) if needed,
then run:

```sh
npm run cad -- --project src/persistence/fixtures/schema-v13.pcaddoc \
  --script commands.json --output test-results/cli
```

`commands.json` is an ordered array:

```json
[
  {"command":"runtime.awaitNative"},
  {"command":"parameter.update","arguments":{"parameterId":"thickness-parameter","patch":{"expression":"8mm"}}},
  {"command":"runtime.awaitNative"},
  {"command":"history.undo"},
  {"command":"runtime.awaitNative"},
  {"command":"file.saveProject","awaitArtifact":true},
  {"command":"file.exportStl","awaitArtifact":true},
  {"command":"drawing.open"},
  {"command":"runtime.waitForCommand","arguments":{"label":"Download drawing SVG","property":"onClick"}},
  {"label":"Download drawing SVG","property":"onClick","awaitArtifact":true}
]
```

The CLI resolves an unambiguous available label/property pair. It supplies the
current session when omitted; explicitly provide a captured session to reject
stale agent work. It stops on errors and prints JSON responses. Without `--script`,
it reads JSON lines from stdin. Invoke `node scripts/plaincad-cli.mjs` directly
for JSON-only stdout without npm's header. Use `--help` for options.
Use `awaitArtifact:true` on asynchronous download buttons to keep the browser
running until their work finishes. Artifact paths describe completed saves.

The CLI starts an isolated Chromium session against a loopback app URL. It does
not attach to the user's current tab. Pass a saved project or import one through
the API. Modeling still uses browser WebAssembly workers and OpenCascade, rather
than a separate Node kernel.

Agents can discover and execute these JSON commands through an existing browser
session or CLI. Provider credentials and executable code are not transport fields.
The built-in AI recipe planner retains its bounded generation workflow; this
interface additionally lets external agents operate the live UI.

For extensions, prefer explicit domain bindings with typed JSON input, availability
and immutable document helpers. Register with `bindCommand` and use the same
executor for UI and automation. `ui/commands/commandRegistry.ts` supplies CAD
metadata/enablement compatibility and registers its actions in this runtime
registry; it is not another executor. Keep native proof checks inside operations.
Interaction bindings capture current handlers and are disposed on unmount.
Never place runtime preview proofs or callbacks in JSON input schemas.
The build rejects unsupported listener rewrites, including earlier optional chains;
extract those into an explicitly guarded EventTarget rather than bypassing routing.
