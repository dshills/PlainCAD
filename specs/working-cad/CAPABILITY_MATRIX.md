# Working CAD Capability Matrix

Reviewed against source and automated tests on 2026-10-02. This is the current
implementation status, not a declaration that the working-CAD spec is complete.
Unit/component tests exercise fallback geometry and jsdom. Chromium acceptance
coverage now verifies native OpenCascade rectangle extrusion and circular through-cut
on XY/XZ/YZ, parameter edits, save/open, binary STL normals/volume/coordinates,
Z-up camera/grid, rendered mesh/sketch alignment, stale worker delivery, and
reinitialization after an old worker fails. This
bounded workflow does not establish general OpenCascade modeling support.

## Implemented foundations

- React/Vite/TypeScript UI, Three.js viewer, Zustand document history and undo/redo.
- Serializable document with stable IDs, deterministic JSON, schema migrations
  through version 6, and validation before imported state is accepted.
- Import unsafe-key rejection, nesting/node limits, and parameter/sketch/entity/
  constraint/feature count limits; unknown and runtime fields stripped by migration.
- Parameter expressions, dependency ordering/cycle errors, compatible unit
  conversion, dimensional arithmetic, CAD math functions, and expression limits.
- XY/XZ/YZ origin sketches with points, lines, circles, and rectangle helpers.
- Line-loop and circle profiles, nesting/holes, stable entity-based profile IDs,
  and duplicate/self-intersection diagnostics for supported geometry.
- Timeline steps with legacy ordering/migration fallbacks, suppression, stable
  feature-derived body IDs, reference/dependency planning and invalid-order errors.
- Worker request IDs and epochs, stale-response protection, watchdog timeouts,
  progress messages, disposal helpers, tessellation cache helpers, and rebuild metrics.
- Camera navigation, fit/reset, body/feature selection, basic inspection,
  sketch overlays, and source-linked rebuild/import/export diagnostics.
- Mounting-plate and box templates, command palette, shared command enablement,
  save/open/project JSON, and current-successful-rebuild STL gating.

## Modeling availability and limits

| Capability | Current behavior | Availability |
| --- | --- | --- |
| Extrude new body | Positive distance extrudes; fallback polygon output is limited and does not establish arbitrary polygon BREP support | Creation command and inspector |
| Extrude cut | One explicit target body; requires compatible sketch plane; narrow circular-through-hole fallback; broader cuts require OpenCascade handles | Inspector; failures diagnosed |
| Extrude join | One explicit target body; requires OpenCascade shape handles; fallback cannot join | Inspector; failures diagnosed |
| Through all | Computes positive-direction distance from target bounds; subject to cut/join and plane limits | Inspector |
| Extrude to face | Stable face termination not implemented | Disabled option; rebuild diagnostic |
| Negative/symmetric extrude | Not implemented | Disabled options; rebuild diagnostic |
| Revolve | New-body rectangular profile, full 360 degrees, origin Y-axis, constrained mesh fallback; crossing-axis profiles rejected | Document/rebuild path; no creation command |
| Revolve cut/join, other axes/angles | Not implemented | Rebuild diagnostic; no creation command |
| Hole | Explicit target, sketch point centers and diameter; narrow cylindrical-through-hole path; unsupported cuts diagnosed | Document/rebuild path; no creation command |
| Fillet/chamfer | Stable extrude edge-role references can be resolved, but geometry operations are not implemented | No creation commands; imported features show unavailable status and fail rebuild; suppress/delete to recover |
| Offset/face sketch planes | Schema preserves references but transforms and repair are not implemented | No creation commands; rebuild blocks with sketch-linked diagnostic |
| STEP | Optional adapter interface only; no implemented exporter | Hidden |

Unsupported edge treatments keep their document intent and upstream preview bodies,
but the rebuild is failed and STL export is disabled. Suppressed treatments do not
block rebuilding. Neither metadata nor unchanged preview meshes count as successful
fillet/chamfer modeling.

## Partial or missing working-CAD requirements

- Parameter names are still expression symbols: stable-ID token references, safe
  rename semantics, authored unit defaults/display units, and grouping need work.
- Sketch constraints/dimensions largely validate evaluated geometry (with
  coincident-point handling); no general iterative solve, seed/reset policy,
  degrees-of-freedom reporting, or anti-flip diagnostics.
- Arcs, construction geometry, mixed line/arc loop extraction, intersection
  fragmentation, and general interactive sketch authoring are missing.
- Feature planning has ordering checks, but validated reorder UI, richer downstream
  diagnostics, durable multi-body scopes and target/profile repair need work.
- Stable planar-face resolution, face selection/repair, offset construction planes,
  and real kernel fillet/chamfer implementation are missing.
- Measurement, named views, section views,
  body visibility controls, and full feature/dimension/constraint inspectors need work.
- STL emits one binary file from meshes; separate/merged multi-body modes, manifold/
  overlap validation, complete filename hardening, and background UI export need work.
- Autosave and recovery, regression fixture corpus for every released schema,
  import parsing/migration in a worker, body/triangle limits, and deployment CSP
  remain incomplete.
- Broader browser/kernel acceptance coverage (general profiles, joins, holes, other
  browsers), accessibility audit, controlled performance reporting, and deployment
  documentation remain open. The bounded Chromium suite runs in the release gate
  and GitHub Actions; CI execution itself has not been verified locally.

## Intentionally deferred

Assemblies/mates, CAM, simulation, sheet metal, generative design, collaboration,
cloud sync, mobile-first editing, plugins, AI generation, and general cross-feature
topological naming remain outside the working-CAD target. STEP can remain hidden
until validated support exists.
