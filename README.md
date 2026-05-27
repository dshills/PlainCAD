# PlainCAD

PlainCAD is a browser-first, local-first parametric CAD MVP for simple mechanical parts. It keeps the durable source of truth in a serializable project document, rebuilds runtime geometry through a worker-backed CAD kernel boundary, previews meshes with Three.js, and exports project JSON plus STL.

The MVP is intentionally narrow: make parameters, sketches, rebuilds, inspection, save/load, and STL export reliable before adding broad CAD features.

## Features

- Single active part document.
- Named parameters with units and expressions.
- XY-plane sketches with points, lines, rectangle helpers, and circles.
- Profile detection for rectangular and circular workflows.
- Extrude features for simple solid generation.
- Mounting plate and parametric box templates.
- 3D viewer with orbit, pan, zoom, fit, reset, selection, and inspection.
- Project import/export as `.pcaddoc` or JSON.
- Mesh-based STL export after successful rebuilds.
- Command palette with `Cmd/Ctrl+K`.
- Rebuild, file, import, and export errors shown in the UI.

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`.
- npm, included with Node.js.
- A modern desktop browser with WebAssembly and WebGL support.

The Node.js version range matches the Vite engine requirement used by this project.

## Quick Start

```sh
npm install
npm run dev
```

Vite prints the local URL, usually `http://localhost:5173/`. Open that URL in a browser.

If port `5173` is already in use, start on another port:

```sh
npm run dev -- --host 127.0.0.1 --port 5174
```

## Available Scripts

```sh
npm run dev
```

Starts the Vite development server.

```sh
npm run lint
```

Runs the TypeScript project check with `tsc -b --noEmit`.

```sh
npm test
```

Runs the Vitest test suite once.

```sh
npm run test:watch
```

Runs Vitest in watch mode.

```sh
npm run build
```

Runs TypeScript checks and creates a production build in `dist/`.

```sh
npm run release:check
```

Runs `lint`, `test`, and `build`. Use this before commits or release handoff.

The production build currently emits a Vite chunk-size warning because OpenCascade WebAssembly and related viewer code are large. The warning is expected for the current MVP and does not fail the build.

## Using the App

### Create a Model

1. Start the dev server and open the local URL.
2. Click `Mounting Plate` to load the primary MVP workflow.
3. Or click `Box` to load a simpler parametric box.
4. The rebuild status pill in the toolbar shows the current rebuild state.

### Edit Parameters

1. Use the Parameters panel on the right.
2. Edit parameter names or expressions.
3. Press `Enter` or blur the input to commit the edit.
4. Press `Escape` while editing to cancel the draft value.

Examples of parameter expressions:

```text
100mm
plate_width - 20mm
hole_diameter / 2
```

The app reports expression, unit, sketch, feature, import, and export errors in user-facing language.

### Work With Sketches

1. Use `New XY` to create an XY-plane sketch.
2. Use `Center Rectangle`, `Circle`, or template-generated geometry for MVP workflows.
3. Select sketches and sketch entities from the left panel.
4. Edit selected sketch entity expressions in the Inspector panel.

The MVP sketch solver is intentionally simple. It supports the guided rectangle/circle workflows needed for the mounting plate and box templates, not a general-purpose sketch constraint system.

### Work With Features

1. Select a sketch with a detected profile.
2. Click `Extrude` in the Feature Timeline.
3. Select a feature to inspect or rename it.
4. Use `Suppress` or `Delete` on selected features.

Only `newBody` extrudes are implemented in the MVP. Join and cut operations are visible as unavailable where relevant and are not exported as working controls.

### Navigate the Viewer

- Orbit: drag in the viewer.
- Pan: right-drag or middle-drag.
- Zoom: scroll over the viewer.
- Fit: press `F` or click `Fit`.
- Reset camera: click `Reset`.
- Clear selection: press `Escape`.

### Command Palette

Open the command palette with:

```text
Cmd+K on macOS
Ctrl+K on Windows/Linux
```

Type to filter commands. Disabled commands are shown as unavailable when the current document or rebuild state does not allow them.

## Save, Load, and Export

### Save a Project

Click `Save` to download a `.pcaddoc` project file. The file is deterministic JSON and contains the parametric document model only.

### Open a Project

Click `Open` and select a `.pcaddoc` or compatible JSON project file. Imported projects are parsed, validated, migrated when supported, loaded into the store, and rebuilt.

### Export JSON

Use the command palette command `Export Project JSON` if you need a `.json` copy instead of `.pcaddoc`.

### Export STL

Click `STL` after the model has rebuilt successfully. STL export is disabled when:

- the kernel is not ready,
- the latest rebuild failed,
- the rebuild result does not match the current document,
- or there are no rebuilt meshes.

## Project File Model

Project files store durable CAD intent:

- schema version,
- document metadata,
- parameters,
- sketches,
- feature timeline.

Project files do not store runtime-only data:

- Three.js objects,
- OpenCascade runtime objects,
- transient meshes,
- viewer camera state,
- rebuild worker state.

This keeps `.pcaddoc` files stable and portable.

## Repository Structure

```text
src/
  app/                 React app shell
  cad/
    document/          Durable CAD document schema and operations
    features/          Feature graph rebuild logic
    kernel/            OpenCascade/kernel adapter boundary and STL export
    parameters/        Units and expression evaluation
    sketch/            Sketch helpers, solving, and profile detection
    worker/            Geometry worker protocol
  persistence/         Project import/export helpers
  state/               Zustand CAD store and selectors
  templates/           Built-in mounting plate and box templates
  tests/               Vitest and React Testing Library coverage
  ui/                  Panels and command palette
  viewer/              Three.js viewer
specs/initial/         Original spec, implementation plan, and release notes
```

## Testing Strategy

The test suite focuses on pure CAD logic and critical UI workflows:

- document validation,
- parameter expression evaluation,
- unit handling,
- sketch helper creation,
- profile detection,
- feature graph rebuild behavior,
- mounting plate workflow validation,
- project save/load round trips,
- STL export smoke coverage,
- command enablement,
- inspector routing,
- release hardening workflows.

Run the full release gate with:

```sh
npm run release:check
```

## Troubleshooting

### Port Already In Use

Start Vite on a different port:

```sh
npm run dev -- --host 127.0.0.1 --port 5174
```

### OpenCascade or WebAssembly Load Issues

Use a modern desktop browser and load the app from the Vite dev server rather than opening `index.html` directly from disk. The kernel and worker assets are served by Vite.

### STL Button Is Disabled

Wait for the rebuild status to show `succeeded`. If errors are present, fix the parameter, sketch, or feature error first. STL export requires at least one rebuilt mesh.

### Project Import Fails

The app validates imported files. Common causes are invalid JSON, unsupported schema versions, or missing required document fields. The file error banner and Rebuild panel show user-facing messages.

### Build Chunk Warning

The production build warns that some chunks exceed 500 kB. This is currently expected because OpenCascade/WebAssembly and CAD viewer code are large. The build still succeeds.

## MVP Scope

Implemented in the initial MVP:

- parameters,
- XY sketches,
- simple profile detection,
- extrude,
- worker-backed rebuild,
- viewer,
- import/export,
- STL export,
- usability and release hardening.

Deferred until after MVP:

- assemblies,
- mates and joints,
- CAM/toolpaths,
- simulation,
- sheet metal,
- loft/sweep/surface modeling,
- robust topological naming,
- full sketch constraint solving,
- multi-user collaboration,
- plugin system,
- cloud sync,
- desktop packaging.

## Reference Docs

- `specs/initial/SPEC.md`: original product and technical specification.
- `specs/initial/PLAN.md`: phased implementation plan.
- `specs/initial/RELEASE_HARDENING.md`: release hardening checklist.
- `specs/initial/MVP_COMPLETION.md`: MVP completion review.
