# PlainCAD

PlainCAD is a browser-first, local-first parametric CAD MVP for simple mechanical parts. It uses a serializable document model for parameters, sketches, and features, rebuilds geometry through a worker-backed CAD kernel boundary, previews models with Three.js, and exports project JSON and STL.

## Current MVP

- Single active part document.
- Named parameters with units and expressions.
- XY sketches with points, lines, rectangle helpers, and circles.
- Profile detection for rectangular and circular workflows.
- Extrude features for simple solid generation.
- Mounting plate and parametric box templates.
- 3D viewer with orbit, pan, zoom, fit, reset, selection, and inspection.
- Project import/export as `.pcaddoc` or JSON.
- Mesh-based STL export.
- Command palette with `Cmd/Ctrl+K`.
- Rebuild, file, and export errors shown in the UI.

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`.
- npm.

## Run Locally

```sh
npm install
npm run dev
```

Vite will print the local URL. If port `5173` is already in use, choose another port:

```sh
npm run dev -- --host 127.0.0.1 --port 5174
```

## Verify

```sh
npm run release:check
```

This runs TypeScript checks, the Vitest suite, and a production build. The production build currently emits a Vite chunk-size warning because OpenCascade WebAssembly and related viewer code are large; the warning is expected and does not fail the build.

## MVP Workflow

1. Open the app.
2. Click `Mounting Plate` or `Box`.
3. Edit parameters in the Parameters panel.
4. Inspect sketches, features, bodies, and rebuild state in the side panels.
5. Use `Fit`, `Reset`, mouse orbit/pan/zoom, or the command palette.
6. Save the project with `Save`.
7. Export printable geometry with `STL` after a successful rebuild.

## Project Files

- `.pcaddoc` files are deterministic JSON project documents.
- Runtime meshes, kernel objects, and viewer state are not stored in project files.
- Imported projects are validated and rebuilt after load.

## Release Notes

The initial MVP implementation is tracked in `specs/initial/PLAN.md`. Release hardening notes are in `specs/initial/RELEASE_HARDENING.md`, and the MVP completion review is in `specs/initial/MVP_COMPLETION.md`.
