# PLAN.md - Phased Implementation Plan for Working Parametric CAD

## 1. Planning Assumptions

This plan implements `SPEC.md` for the post-MVP working CAD system. The current PlainCAD MVP already has a React/Vite app, Three.js viewer, local document model, parameters, sketch helpers, extrude rebuild, STL export, project import/export, command palette, undo/redo, and a Fusion-inspired layout with a top ribbon and bottom parametric timeline.

Primary assumptions:

- The product remains browser-first and local-first.
- The serialized `CadDocument` remains the durable source of truth.
- OpenCascade.js remains isolated behind the kernel adapter and worker boundary.
- Runtime shapes, meshes, workers, viewer state, and kernel handles remain disposable artifacts.
- Every phase must leave the app runnable, buildable, and covered by focused tests.
- Feature breadth is secondary to predictable rebuilds, source-linked diagnostics, and durable project files.
- STEP export remains conditional until the kernel path is reliable enough to expose.

## 2. Implementation Strategy

Implement the working CAD target as vertical capability layers:

1. Harden the current document and timeline foundations.
2. Expand parameters and units before expanding geometry.
3. Add multi-plane sketching and stable plane references.
4. Build a more capable sketch solver and profile detector.
5. Extend the feature graph with body-aware operations.
6. Add localized topological naming only where required by supported features.
7. Harden export, persistence, performance, and release workflows.

Each phase should include:

- schema and migration updates when durable data changes,
- source-linked errors for invalid states,
- unit tests for model logic,
- integration tests for user-visible workflows,
- browser smoke coverage when UI behavior changes,
- Prism review before commit.

## 3. Phase 0 - Baseline Hardening and Planning Alignment

### Goal

Stabilize the MVP as the foundation for the working CAD roadmap and remove ambiguity in the new spec before adding major CAD breadth.

### Tasks

- Audit the existing implementation against `specs/working-cad/SPEC.md`.
- Add a current-state capability matrix:
  - implemented,
  - partially implemented,
  - missing,
  - intentionally deferred.
- Add or update durable timeline metadata:
  - explicit `timelineStep` or equivalent monotonically ordered operation sequence,
  - sketch and feature creation timestamps for display and fallback only,
  - legacy fallback ordering for documents created before explicit sequence metadata.
- Commit to explicit timeline sequence as the source of truth for ordering. Creation timestamps must not drive editable CAD history because users need validated reordering without changing creation dates.
- Add a migration plan for old `.pcaddoc` files missing new timeline metadata.
- Confirm command enablement is shared between ribbon, command palette, and timeline controls.
- Confirm the Fusion-style layout remains usable at desktop and tablet widths.

### Tests

- Unit tests for timeline ordering with:
  - new documents,
  - legacy documents without timestamps,
  - unused sketches,
  - multiple sketches feeding multiple features.
- App tests for ribbon command enablement.
- Browser smoke test for:
  - app load,
  - create sketch,
  - draw rectangle,
  - extrude,
  - bottom timeline update.

### Acceptance Criteria

- The app passes `npm run release:check`.
- Legacy project files still load.
- Timeline ordering is deterministic and documented.
- No CAD commands appear enabled unless their execution path is valid.

## 4. Phase 1 - Schema Versioning, Migrations, and Import Safety

### Goal

Make the project file format durable enough to support repeated schema evolution throughout the working CAD implementation.

### Tasks

- Increment `schemaVersion` for the working CAD line.
- Create a migration registry with one migration function per version step.
- Run migrations atomically on an in-memory document copy for ordinary-sized files. For files near configured size/entity limits, use chunked or streaming migration steps to avoid duplicating large documents in memory. Commit migrated data to primary storage only after every step completes and the final document passes current schema validation.
- Add regression fixtures for every released schema version.
- Require each migration result to pass the current schema validator after migration.
- Add strict import validation before project state is accepted.
- Add project size and entity-count limits:
  - parameters,
  - sketches,
  - sketch entities,
  - dimensions,
  - constraints,
  - features,
  - bodies,
  - mesh triangles.
- Add JSON nesting depth enforcement.
- Add strict schema-based validation after parsing and a `JSON.parse` reviver that blocks `__proto__`, `prototype`, `constructor`, and dangerous inherited/coercion keys before object materialization reaches application state.
- Materialize imported document sections into null-prototype containers or strict schema-owned objects, strip every property not explicitly defined in the schema, and forbid recursive deep-assign patterns that merge untrusted objects into existing app state.
- Reject prototype-pollution vectors before objects reach app state.
- Make migration independent of kernel initialization.
- Add deterministic serialization checks for:
  - object ordering,
  - stable IDs,
  - canonical metadata fields,
  - no runtime-only fields.

### Tests

- Migration tests for every fixture.
- Invalid import tests for:
  - malformed JSON,
  - missing schema version,
  - unsupported future schema,
  - dangerous keys,
  - oversized files,
  - too-deep documents,
  - missing references.
- Round-trip serialization tests.

### Acceptance Criteria

- Old project fixtures load or fail with clear messages.
- Future schema versions fail safely.
- Project import cannot mutate prototypes.
- Migrations run without OpenCascade or viewer initialization.

## 5. Phase 2 - Parameter System Expansion

### Goal

Upgrade the MVP expression system into a robust CAD parameter engine with dimensional analysis, stable identity, and safe renames.

### Tasks

- Replace or extend expression parsing with an auditable Pratt or iterative parser.
- Support:
  - unary operators,
  - binary `+`, `-`, `*`, `/`,
  - parentheses,
  - `sin`, `cos`, `tan`,
  - inverse trigonometric functions,
  - `sqrt`,
  - `abs`,
  - `min`,
  - `max`,
  - `pow(a, b)`.
- Enforce expression nesting depth, initially 32 unless an iterative parser proves a higher limit is safe.
- Enforce expression token and operation limits, initially around 512 tokens per expression, plus a total evaluation budget for the parameter graph.
- Enforce linear-time tokenization.
- Run parameter dependency DAG validation and topological sorting before evaluating any parameter expression, with an explicit maximum dependency-chain depth.
- Make the parser unit-aware so mixed-unit literals such as `5in + 10mm` normalize to internal base units during evaluation rather than being treated as unitless scalar arithmetic.
- Add dimensional analysis:
  - scalar,
  - length,
  - area,
  - volume,
  - angle,
  - count or option-like values where needed.
- Require each parameter-bound field to declare accepted dimensionality.
- When a parameter's dimensionality changes, immediately revalidate dependent expressions, dimensions, constraints, and features; incompatible dependents must enter failed or repair-required state with source-linked diagnostics.
- Preserve raw expression text and display-unit metadata.
- Normalize length to millimeters and angles to radians for geometry.
- Reject dimensionless forward trigonometric arguments.
- Return unit-bearing angles from inverse trigonometric functions.
- Store tokenized parameter references by stable parameter ID while preserving display names.
- Implement safe parameter rename behavior without brittle raw string replacement.
- Add parameter descriptions and groups if the UI can support them without clutter.
- Add source-linked parameter diagnostics for:
  - unknown references,
  - cycles,
  - invalid units,
  - dimension mismatch,
  - parser depth limit,
  - division by zero.

### Tests

- Unit tests for every expression operator and function.
- Dimensional analysis tests for valid and invalid field bindings.
- Rename tests that prove expressions track stable IDs.
- Cycle detection tests.
- Parser depth and tokenizer stress tests.
- Integration test for parameter edit triggering correct rebuild diagnostics.

### Acceptance Criteria

- Parameter evaluation is deterministic and under target time for typical documents.
- Invalid expressions never reach sketch solving or kernel operations.
- Renaming a parameter preserves design intent.

## 6. Phase 3 - Multi-Plane Sketching and Coordinate Policy

### Goal

Support sketching on XY, XZ, YZ, offset planes, and stable feature-owned planar faces while keeping viewer, overlays, picking, and exports in one coordinate system.

### Tasks

- Extend sketch plane schema:
  - origin plane references,
  - offset plane references,
  - stable feature-owned planar face references,
  - lost-plane state.
- Implement document objects for construction planes if needed.
- Add plane transforms:
  - local 2D sketch coordinates to right-handed Z-up world coordinates,
  - world coordinates to sketch plane coordinates,
  - viewer transform and inverse transform.
- Configure the viewer to use Z-up directly where possible.
- If Three.js remains Y-up internally, define one canonical right-handed CAD-to-view 4x4 transform and use its inverse only to map UI/view inputs back into CAD space. Measurements and geometric queries must be computed in kernel/CAD coordinates before any view transform is applied.
- Update sketch overlays to render on selected planes.
- Update picking to map view rays into sketch plane space.
- Add UI controls:
  - create XY sketch,
  - create XZ sketch,
  - create YZ sketch,
  - create offset plane,
  - sketch on supported planar face.
- Add lost-plane repair workflow:
  - keep sketch entities,
  - block dependent rebuilds,
  - allow reselecting a plane.

### Tests

- Unit tests for plane transforms and inverse transforms.
- Viewer/overlay tests for XY, XZ, and YZ sketches.
- Integration tests for extruding from each origin plane.
- Tests for lost-plane diagnostics and repair state.

### Acceptance Criteria

- Users can sketch and extrude from XY, XZ, and YZ.
- Existing XY documents continue to load.
- Rendered meshes, overlays, selections, and export previews share orientation.

## 7. Phase 4 - Sketch Entity and Constraint Expansion

### Goal

Evolve sketches from helper-created rectangles and circles into an editable 2D constraint system for practical mechanical profiles.

### Tasks

- Add sketch entities:
  - arcs,
  - construction lines,
  - construction circles where useful,
  - explicit rectangle helpers backed by primitive entities.
- Add dimensions:
  - horizontal distance,
  - vertical distance,
  - point-to-point distance,
  - line length,
  - radius,
  - diameter,
  - angle.
- Add constraints:
  - fixed,
  - coincident,
  - horizontal,
  - vertical,
  - parallel,
  - perpendicular,
  - tangent,
  - equal length,
  - equal radius,
  - midpoint,
  - symmetric.
- Implement a deterministic iterative solver for the supported set.
- Use previous solved geometry as the initial seed.
- Add canonical re-solve or reset behavior.
- Add anti-flip diagnostics where multiple valid solutions exist.
- Add degrees-of-freedom heuristics for underconstrained reporting.
- Add overconstrained and conflicting diagnostics.
- Define shared geometric tolerances before solver work begins:
  - linear tolerance in millimeters,
  - angular tolerance in radians,
  - stricter 2D sketch closure/coincidence tolerance where needed,
  - model-size-bounded tolerance scaling for unusually small or large models.
- Enforce solver iteration and elapsed-time limits.
- Reject degenerate solved geometry before profile detection.
- Add editable dimension and constraint inspector views.

### Tests

- Unit tests for every supported constraint.
- Tests for underconstrained, overconstrained, and conflicting sketches.
- Degenerate geometry tests:
  - zero-length line,
  - non-positive radius,
  - zero-sweep arc,
  - self-overlap from dimensions.
- Performance tests for typical sketches.
- Integration tests for editing dimensions and rebuilding dependent features.

### Acceptance Criteria

- The supported solver set is reliable and documented.
- Invalid sketches fail with source-linked diagnostics.
- Feature rebuilds never use stale or guessed sketch geometry.

## 8. Phase 5 - Profile Detection 2.0

### Goal

Support reliable profile detection for mixed line, arc, and circle sketches with stable profile IDs that survive ordinary edits.

### Tasks

- Implement loop extraction for:
  - lines,
  - arcs,
  - circles,
  - nested loops,
  - holes.
- Add explicit fragmentation for intersections and T-junctions where practical.
- Track entity lineage for split or derived segments.
- Detect and reject:
  - open loops,
  - self-intersections,
  - overlapping segments,
  - duplicate entities,
  - zero-length segments.
- Add stable profile IDs based on:
  - stable sketch entity IDs,
  - lineage,
  - connectivity,
  - loop role,
  - containment relationship.
- Treat winding as a validation/display attribute, not a primary identity key, because loop orientation can flip during legitimate solves.
- Add a persistent profile signature/hash derived from the topological graph, entity lineage, loop role, containment, and normalized local geometry. The hash is used as a stable matching aid, not as a silent rebinding guarantee.
- Use spatial heuristics only when topology and profile signature remain compatible and displacement is within configured tolerance.
- When edits alter topology enough that stable matching is ambiguous, keep dependent features in repair-required state rather than guessing. Do not depend on general-purpose kernel topological naming for profiles until a future spec explicitly adds it.
- Add profile selection UI.
- Add "profile reference lost" diagnostics and repair flow.

### Tests

- Unit tests for:
  - simple rectangle,
  - circle,
  - line-and-arc loop,
  - nested hole profile,
  - multiple profiles,
  - dirty geometry rejection.
- Stability tests across parameter edits.
- Regression tests for profile reference loss.

### Acceptance Criteria

- Users can select a specific profile when multiple profiles exist.
- Dependent features retain profile references across ordinary dimension edits.
- Ambiguous profile changes fail clearly instead of rebinding arbitrarily.

## 9. Phase 6 - Feature Graph and Body Model

### Goal

Turn the MVP rebuild pipeline into a body-aware feature graph that supports reliable additive and subtractive modeling.

### Tasks

- Add durable body declarations or stable body IDs where needed.
- Extend rebuild planning to track:
  - feature dependencies,
  - sketch dependencies,
  - target body scope,
  - generated body outputs,
  - downstream invalidation.
- Add feature suppression with downstream diagnostics.
- Add validated feature reordering:
  - reject cycles,
  - reject moves before required sketches,
  - reject broken references.
- Add incremental rebuild:
  - reuse valid upstream runtime outputs,
  - recompute from earliest changed dependency,
  - never depend on cache for correctness.
- Add body inspection:
  - body name,
  - source feature,
  - triangle count,
  - bounds,
  - visibility state.
- Keep body visibility as transient viewer/display metadata that does not trigger kernel rebuild.

### Tests

- Unit tests for graph validation and reorder rejection.
- Integration tests for suppression and unsuppression.
- Tests for target body reference loss.
- Tests proving stale worker responses cannot overwrite newer state.

### Acceptance Criteria

- Feature timeline behavior is deterministic.
- Broken dependencies are visible and repairable.
- Body identity remains stable across ordinary upstream edits.

## 10. Phase 7 - Extrude Cut, Join, and Termination Modes

### Goal

Expand extrude from new-body only into practical body modification workflows.

### Tasks

- Add extrude operations:
  - new body,
  - join,
  - cut.
- Add target scope:
  - selected body IDs,
  - bodies intersected at feature creation time.
- Persist target body IDs.
- Keep display state such as body visibility in a separate UI/display slice so toggles cannot trigger kernel rebuilds.
- Add through-all termination.
- Add extrude-to-stable-planar-face termination.
- Add explicit handling for missing targets.
- Add source-linked diagnostics for:
  - no target selected,
  - target reference lost,
  - no intersection for cut/join,
  - invalid profile,
  - invalid termination face.
- Add inspector controls for operation, direction, distance, target scope, and termination.

### Tests

- Kernel adapter tests for new body, join, and cut.
- Integration tests for cut holes or pockets through a body.
- Tests for through-all behavior with fixed target scope.
- Tests for target body disappearance.

### Acceptance Criteria

- At least one additive and one subtractive extrude workflow is reliable.
- Multi-body documents do not infer targets from document order.
- Failed booleans produce actionable diagnostics.

## 11. Phase 8 - Revolve and Hole Features

### Goal

Add the next practical feature types after extrude while preserving validation-first kernel use.

### Tasks

- Add revolve feature schema:
  - sketch ID,
  - profile ID,
  - axis reference,
  - operation,
  - angle,
  - target scope for cut/join.
- Support revolve axes:
  - origin axes,
  - stable sketch construction lines.
- Defer model-edge revolve axes until Phase 9 localized topological naming can provide stable edge references.
- Validate revolve profiles:
  - non-zero area,
  - at least one non-collinear vertex or segment,
  - profile does not cross axis,
  - profile does not self-intersect before or during revolution,
  - output will not collapse to zero volume.
- Add a kernel-level validation pass, such as OpenCascade shape checking where available, before accepting revolve results.
- Add revolve new body, cut, and join.
- Add simple cylindrical hole feature:
  - target body,
  - sketch center points,
  - orientation from the sketch plane normal or an explicit axis reference,
  - diameter,
  - blind depth,
  - through-all.
- Reject or defer holes on curved/non-planar targets unless an explicit stable orientation reference is provided.
- Add feature-specific inspector controls.
- Add previews only if they are accurate and cheap enough.

### Tests

- Unit tests for revolve validation.
- Kernel tests for revolve output.
- Integration tests for blind holes and through-all holes.
- Tests for invalid axis/profile combinations.

### Acceptance Criteria

- Revolve and hole features are usable from supported sketch references.
- Invalid geometry is rejected before kernel calls where possible.

## 12. Phase 9 - Localized Topological Naming and Edge Treatments

### Goal

Support fillet and chamfer only on stable, supported feature-owned edge roles.

### Tasks

- Define localized topological naming for:
  - profile-derived extrusion edges,
  - start-cap perimeter edges,
  - end-cap perimeter edges,
  - feature-owned planar faces.
- Store references using:
  - generating feature ID,
  - source sketch entity ID,
  - feature output role,
  - adjacent face role,
  - persistent lineage IDs and topological connectivity as primary identity,
  - deterministic local geometric sorting only as a fallback when candidates are separated by a configured stable epsilon.
- Add topology reference resolution during rebuild.
- Add repair-required state for ambiguous rebinding.
- Add fillet feature:
  - supported edge refs,
  - radius expression,
  - diagnostics.
- Add chamfer feature:
  - supported edge refs,
  - distance expression,
  - diagnostics.
- Prevent arbitrary transient kernel edge IDs from entering project files.

### Tests

- Unit tests for topology reference encoding and resolution.
- Rebuild tests across parameter edits.
- Tests for ambiguous edge remapping.
- Kernel tests for fillet and chamfer success/failure.

### Acceptance Criteria

- Users can fillet/chamfer supported stable edges.
- Unsupported edge selections are disabled or fail before serialization.
- Ambiguous references require user repair.

## 13. Phase 10 - Kernel Worker, Memory, and Performance Hardening

### Goal

Keep modeling responsive and prevent OpenCascade/WASM lifecycle failures during longer sessions.

### Tasks

- Add a shared disposable-scope utility for OpenCascade.js handles.
- Require per-operation and nested loop scopes for transient handles.
- Track cached handle ownership.
- Delete cached kernel objects on invalidation, eviction, replacement, and worker shutdown.
- Add worker request timeouts:
  - 500ms-1s for preview/interactive rebuild attempts where partial failure can fall back to queued full rebuild,
  - 5-10 seconds for explicit full rebuild actions,
  - longer explicit limits for export.
- Add main-thread elapsed-time monitoring.
- Use a single serialized kernel worker queue for ordinary rebuild operations initially. Cancellation should mark queued or obsolete requests as skipped; worker termination is reserved for operations that exceed timeout or stop responding.
- Use worker progress or heartbeat messages between kernel calls where possible. Use a main-thread watchdog timer to terminate/replace a worker only when it exceeds timeout without progress or becomes nonresponsive during a synchronous kernel call. All queued requests bound to that worker epoch must be rejected or rescheduled.
- Before terminating a worker, clear main-thread lifecycle state tied to that worker ID, including cached buffers, object URLs, pending request handles, and export blobs.
- Use monotonically increasing worker epochs and request IDs. Discard any worker message whose epoch or request ID does not match the current active rebuild/export state.
- Track WASM heap usage, operation count, cache size, and disposal failures.
- Add soft reset and periodic worker recycling thresholds.
- Add tessellation cache keys:
  - document revision,
  - body or feature output ID,
  - chordal deflection,
  - angular tolerance,
  - normal mode,
  - level-of-detail profile.
- Add viewer LOD profiles for interaction versus export.

### Tests

- Unit tests for disposable scope behavior, including thrown operation paths.
- Worker tests for stale response rejection.
- Timeout tests with simulated long-running operations.
- Cache invalidation tests.
- Performance reporting for parameter evaluation, sketch solving, and simple rebuilds.

### Acceptance Criteria

- Kernel objects do not leak across ordinary rebuilds.
- Hung operations do not permanently break the app.
- UI remains responsive during kernel initialization and rebuild queues.

## 14. Phase 11 - Viewer, Selection, Measurement, and Inspection

### Goal

Make the central viewer support practical CAD interaction rather than only passive rendering.

### Tasks

- Add body, feature, face, edge, and sketch entity selection where supported.
- Add selection highlight and hover highlight when performant.
- Add sketch overlays for active planes.
- Add section or clipping view if the rendering path is stable.
- Add named views if the document schema is ready.
- Add measurement tools:
  - point distance,
  - edge length,
  - radius/diameter where available,
  - bounds.
- Preserve session camera state across rebuilds.
- Add fit/reset commands that work with multi-body scenes.
- Add accessible names and keyboard paths for viewer-adjacent controls.

### Tests

- Component tests for inspector selection routing.
- Browser tests for selection and inspector updates.
- Unit tests for measurement calculations.
- Visual smoke checks for overlays on multiple planes.

### Acceptance Criteria

- Selecting visible model items leads to useful inspector information.
- Viewer state does not reset unexpectedly after parameter edits.
- Measurements are clearly labeled and unit-aware.

## 15. Phase 12 - Export Hardening

### Goal

Make fabrication export reliable for single-body and multi-body parts.

### Tasks

- Extend STL export modes:
  - separate STL files,
  - single STL with separate shells,
  - best-effort merged/manifold STL via kernel union.
- Preserve global document coordinates in every export mode.
- Normalize filenames to Unicode NFC, then sanitize with a strict linear-time allowlist such as `[A-Za-z0-9._-]`. Strip `/`, `\`, null bytes, non-printable characters, `.`/`..` traversal names, drive prefixes, trailing spaces/dots, and platform-reserved names such as Windows device names before ZIP generation or download.
- Deduplicate filenames with stable suffixes using case-insensitive comparison so `Part.stl` and `part.stl` cannot collide on Windows or macOS.
- Enforce filename length limits while preserving suffix and extension.
- Add multi-body ZIP export if separate files are generated in browser.
- Add optional overlap checks:
  - broad-phase bounds,
  - narrow checks only for candidates,
  - user skip path for expensive checks.
- Validate:
  - non-empty meshes,
  - manifoldness where selected,
  - normal consistency,
  - open boundaries,
  - self-intersections where practical.
- Compute STL normals with kernel surface orientation where available, and validate against triangle winding and BREP orientation so inverted or inconsistent boolean output is detected before export.
- Add export worker path for expensive validation.
- Add STEP export only if OpenCascade support proves reliable:
  - valid STEP header smoke test,
  - optional kernel round-trip import,
  - clear UI availability states.

### Tests

- Unit tests for filename sanitization and deduplication.
- STL tests for single-body and multi-body exports.
- Tests preserving global coordinates.
- Tests for empty/invalid mesh export failure.
- Browser smoke test for export enablement.
- STEP smoke tests only when exposed.

### Acceptance Criteria

- STL export works for typical modeled parts.
- Multi-body export does not lose alignment.
- Export failures are visible and actionable.

## 16. Phase 13 - Persistence, Autosave, and Recovery

### Goal

Make projects resilient to browser refreshes, crashes, migrations, and user mistakes.

### Tasks

- Add autosave to IndexedDB as the primary storage backend. Use local storage only for tiny recovery metadata or feature flags, not full CAD documents.
- Handle IndexedDB quota and private-browsing failures by notifying the user, preserving the current in-memory document, and offering manual export or old autosave purge.
- Store autosave metadata:
  - document ID,
  - document name,
  - schema version,
  - saved timestamp,
  - app version if available.
- Add recovery prompt on load when autosave is newer than the last explicit save.
- Add project metadata editor:
  - name,
  - description,
  - units,
  - author or notes if useful.
- Add deterministic manual save.
- Add import recovery behavior for partial failures:
  - show validation errors,
  - do not overwrite current document unless import succeeds.

### Tests

- Unit tests for autosave serialization.
- Integration tests for recovery prompt.
- Migration tests using autosaved fixtures.
- Import failure tests proving current document is preserved.

### Acceptance Criteria

- Users can recover recent unsaved work.
- Autosave never stores runtime-only objects.
- Recovery and import errors are clear.

## 17. Phase 14 - UI Completion, Accessibility, and Command Coverage

### Goal

Ensure the working CAD UI remains efficient, keyboard-accessible, and honest about available functionality.

### Tasks

- Audit the top ribbon, browser, timeline, viewer, and inspector.
- Keep model structure visible while preserving canvas space.
- Add or refine commands for every working feature.
- Ensure command enablement is shared across:
  - ribbon,
  - command palette,
  - timeline,
  - inspector actions.
- Add keyboard shortcuts for high-frequency actions.
- Add visible focus states.
- Add accessible names for toolbar buttons and editable fields.
- Add non-color-only error indicators.
- Add dirty state for uncommitted inspector edits.
- Add repair UI for:
  - lost profile,
  - missing target body,
  - lost sketch plane.
- Remove or disable controls for unimplemented features.

### Tests

- Component tests for command enablement.
- Browser tests for command palette filtering.
- Keyboard navigation smoke tests.
- Accessibility checks for labels, focus, and disabled states.

### Acceptance Criteria

- Users can discover and run every implemented command from keyboard or UI.
- Disabled commands explain or imply why they are unavailable.
- Error and repair workflows are navigable without hidden state.

## 18. Phase 15 - Release Quality, Performance, and Documentation

### Goal

Prepare the working CAD system for sustained use and future feature expansion.

### Tasks

- Add release smoke automation:
  - app load,
  - no framework overlay,
  - command palette opens and filters,
  - create sketch,
  - extrude,
  - parameter edit rebuild,
  - save/load,
  - STL export availability.
- Add performance reporting:
  - parameter evaluation,
  - sketch solving,
  - profile detection,
  - simple rebuild,
  - export validation.
- Add documentation:
  - setup,
  - development workflow,
  - project file format overview,
  - modeling limitations,
  - troubleshooting kernel loading,
  - release checklist.
- Add examples:
  - box,
  - mounting plate,
  - multi-plane bracket,
  - subtractive pocket or hole.
- Review Content Security Policy and DOM-sink safety.
- Audit package size and consider code splitting for OpenCascade and heavy worker paths.

### Tests

- Full `npm run release:check`.
- Browser smoke suite.
- Import/export regression suite.
- Performance report generation.

### Acceptance Criteria

- Working CAD Definition of Done from `SPEC.md` is satisfied.
- Known limitations are documented.
- Release checks are repeatable.
- The app can be used to create a non-template sketch-driven part from scratch.

## 19. Cross-Phase Engineering Rules

- Keep edits scoped to the phase objective.
- Do not expose UI for unsupported modeling operations.
- Add migrations in the same phase as durable schema changes.
- Keep kernel-specific objects out of React state and project JSON.
- Validate before kernel calls wherever possible.
- Prefer source-linked diagnostics over generic failure messages.
- Use stable IDs for durable references.
- Treat imported files as untrusted input.
- Run Prism review before committing each phase.

## 20. Suggested Commit Boundaries

Each phase should usually become one or more focused commits:

- schema and migration commit,
- core model/kernel commit,
- UI command/inspector commit,
- tests and documentation commit.

Small phases may be one commit. Large phases, especially sketch solver, profile detection, feature graph, and export hardening, should be split into reviewable vertical slices.

## 21. Working CAD Completion Gate

The implementation should be considered complete only when:

- users can create a non-template part from scratch,
- users can edit parameters and dimensions with predictable rebuilds,
- additive and subtractive features are reliable,
- failed sketches and features produce source-linked diagnostics,
- project save/load preserves design intent,
- STL export works for typical modeled parts,
- STEP export is either reliable or intentionally hidden,
- browser smoke tests pass,
- durable CAD model logic has unit and integration coverage,
- kernel code remains isolated and disposable,
- project files remain deterministic and migration-friendly.
