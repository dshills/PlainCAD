# CAPABILITY_MATRIX.md - Working CAD Baseline

This matrix records the current MVP state before implementing the working CAD phases in `PLAN.md`.

## Implemented

- React/Vite/TypeScript app shell.
- Three.js viewer with grid, axes, camera fit, and reset.
- Local-first `CadDocument` model with stable IDs.
- Parameters with basic units and expressions.
- XY sketches with points, lines, circles, rectangle helpers, and simple dimensions.
- Profile detection for supported rectangle/circle MVP workflows.
- Extrude new-body feature from supported sketch profiles.
- Worker-backed rebuild path with stale response protection.
- OpenCascade adapter boundary.
- STL export from successful rebuild meshes.
- Project save/load for current schema.
- Command registry, command palette, top ribbon, left browser, right inspector, and bottom timeline.
- Undo/redo for document edits.
- Rebuild diagnostics and source selection for supported objects.
- Automated unit, integration, and component tests.

## Partially Implemented

- Timeline ordering: `timelineStep` is now the durable ordering source for new/updated sketches and features, with timestamp and index fallback for legacy documents. A future migration should backfill explicit steps for all old project fixtures.
- Sketch-to-extrude workflow: surfaced in the UI and covered by tests, but still limited to MVP-supported profiles.
- Feature graph: sequential rebuild and suppression exist, but validated reordering, target scope, and full dependency diagnostics are still missing.
- Parameters: basic expression support exists, but full dimensional analysis, stable tokenized references, advanced functions, and robust rename semantics are still future work.
- Import validation: current validation exists, but Phase 1 must harden schema validation, migration fixtures, size limits, and prototype-pollution defenses.
- Worker lifecycle: kernel worker exists, but timeout watchdogs, cache ownership, memory monitoring, and disposable OpenCascade scopes are still future work.
- Export: STL works for current meshes, but multi-body modes, filename hardening, manifold checks, and STEP gating are future work.

## Missing

- Explicit schema-version migration suite for working CAD.
- XY/XZ/YZ multi-plane sketching.
- Offset construction planes.
- Planar-face sketching with lost-plane repair.
- Arcs and construction geometry.
- Full sketch dimensions and constraints.
- Iterative constraint solver with underconstrained/overconstrained diagnostics.
- General line/arc/circle loop extraction with holes and stable profile signatures.
- Extrude cut, join, through-all, and to-face termination.
- Body target scope and stable body declarations.
- Revolve features.
- Hole features.
- Localized topological naming for feature-owned faces and edges.
- Fillet and chamfer.
- Measurement tools, named views, section/clipping view, and viewer LOD.
- Autosave and project recovery.
- Browser smoke automation for release.
- Performance reporting.

## Intentionally Deferred

- Assemblies and mates.
- CAM and toolpath generation.
- Simulation.
- Sheet metal.
- Generative design.
- Multi-user collaboration.
- Cloud sync as a requirement.
- Mobile-first editing.
- Plugin system.
- General-purpose commercial-CAD topological naming.
- AI model generation.
