# SPEC.md - Working Parametric CAD System

## 1. Purpose

This specification defines the next product target for PlainCAD after the completed browser-first MVP. The MVP proved the core loop:

1. durable parametric document,
2. parameter evaluation,
3. simple sketches,
4. profile detection,
5. extrude rebuild,
6. viewer interaction,
7. project import/export,
8. STL export.

The next target is a working CAD system: a reliable single-part parametric modeler that can create useful mechanical parts beyond guided templates while preserving the MVP's clarity, local-first behavior, and understandable model structure. "Single-part" may include multiple disjoint solid bodies inside one part document, such as tool bodies or multi-body printed components, but it does not include assemblies, mates, or separate part documents constrained together.

This is not a specification for a full Fusion 360 or SolidWorks replacement. The goal is a serious, practical CAD tool for makers, engineers, and developers who need controllable parametric modeling without an enterprise CAD complexity cliff.

## 2. Product Definition

PlainCAD should become a browser-first parametric CAD system for designing, editing, validating, and exporting single mechanical parts.

The system should support:

- explicit design intent through named parameters,
- sketch-driven modeling on multiple standard planes,
- a feature timeline with predictable rebuild behavior,
- robust error reporting and source-linked diagnostics,
- reliable export for fabrication workflows,
- durable project files that remain readable and migration-friendly,
- performance good enough for interactive modeling on ordinary desktop hardware.

## 3. Target Users

### 3.1 Primary Users

- Makers designing 3D printed brackets, mounts, adapters, and enclosures.
- Mechanical engineers making quick fixture or jig geometry.
- Developers who want CAD models that can be generated, inspected, and versioned as structured data.
- Educators teaching parametric modeling concepts.

### 3.2 User Expectations

Users should be able to:

- understand why a model rebuild failed,
- edit dimensions without hunting through hidden dialogs,
- recover from invalid sketches or feature failures,
- save and reopen projects without losing design intent,
- export valid STL reliably,
- trust that visible controls either work or clearly state why they are unavailable.

## 4. Design Principles

### 4.1 Document First

The durable source of truth is the project document. Meshes, BREP handles, viewer objects, worker state, and kernel objects are runtime artifacts.

### 4.2 Explicit Design Intent

Parameters, sketches, constraints, dimensions, features, and dependencies should be visible and inspectable.

### 4.3 Fail Clearly

Invalid expressions, overconstrained sketches, missing references, failed kernel operations, and export failures must produce structured user-facing diagnostics.

### 4.4 Prefer Reliable Scope Over Broad Scope

PlainCAD should add modeling capabilities only when they can be rebuilt, inspected, serialized, tested, and exported reliably.

### 4.5 Local-First By Default

Projects should be usable without accounts, servers, or cloud storage. Future hosted or desktop capabilities must not weaken local-first operation.

## 5. System Scope

### 5.1 Must Support

- Single-part modeling.
- One active document at a time.
- Named parameters with units and expressions.
- Multi-plane sketching on standard origin planes:
  - XY,
  - XZ,
  - YZ.
- Right-handed coordinate system with Z-up for mechanical CAD interoperability.
- Sketching on selected planar model faces after face references can be resolved to stable owning features.
- Offset construction planes from origin planes or stable planar faces.

The viewer should be configured to use Z-up coordinates directly. If a viewer library requires Y-up internally, the implementation must define one canonical 4x4 CAD-to-view transform, use its inverse for picking and overlays, and prove with tests that BREP geometry, rendered meshes, manipulators, section previews, and export previews share the same orientation.
- Sketch entities:
  - points,
  - lines,
  - circles,
  - arcs,
  - rectangles,
  - construction geometry.
- Sketch dimensions:
  - horizontal distance,
  - vertical distance,
  - point-to-point distance,
  - line length,
  - radius,
  - diameter,
  - angle.
- Sketch constraints:
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
- Profile detection for closed line, arc, and circle loops.
- Feature timeline.
- Core features:
  - extrude new body,
  - extrude cut,
  - extrude join,
  - extrude through all,
  - extrude to stable planar face,
  - revolve new body,
  - revolve cut,
  - revolve join,
  - fillet on explicitly supported stable edge references,
  - chamfer on explicitly supported stable edge references,
  - simple cylindrical hole feature with blind-depth and through-all termination.
- Body and feature inspection.
- Project save/load with migrations.
- Export:
  - STL,
  - STEP when kernel support is reliable,
  - project JSON.
- Undo/redo for document edits.
- Command palette and keyboard-driven command discovery.
- Automated tests for all durable model operations.

Revolve features require an explicit 1D axis reference. The first supported axis types are origin axes and sketch line entities, preferably construction lines, referenced by stable ID in the same sketch as the revolved profile. Before kernel execution, the system must validate that the selected profile has non-zero area, contains at least one vertex or segment not collinear with the axis, and lies entirely on one side of the axis, allowing only intentional collinearity on the axis where the resulting solid is valid. Profiles that cross the axis, collapse to zero volume, or would create non-manifold revolve output must fail with a source-linked diagnostic. Arbitrary transient model edges must not be accepted as durable revolve axes until they are covered by the localized topological naming strategy.

Boolean or body-modifying features must include an explicit target scope. The minimum supported scopes are selected body IDs and all bodies intersected at feature-creation time. In multi-body part documents, `cut`, `join`, `hole`, and `through all` operations must not infer targets silently from document order. The selected or initially intersected target set is persisted by stable body ID; newly added upstream bodies are not automatically included unless the user explicitly retargets the feature or chooses a future "dynamic all intersected bodies" scope with clear rebuild diagnostics. If selected target bodies disappear after upstream edits, the feature must fail with a "target reference lost" diagnostic and offer a reselect-target repair workflow.

Localized topological naming is in scope for the working CAD system. Stable references may name outputs of the feature that created them, such as owned planar faces, cap loops, profile-derived edges, and extrusion-direction edge groups. Face references for supported planar-face sketching and stable edge references for supported edge treatments are part of this minimum viable localized naming scope. Cross-feature arbitrary topological naming remains out of scope.

### 5.2 Should Support

- Sketch grid snapping.
- Measurement tools.
- Section or clipping view.
- Named views.
- Simple body visibility toggles.
- Feature suppression and validated reordering.
- Parameter groups and descriptions.
- Project autosave to local storage or IndexedDB.
- Browser-based smoke tests for critical workflows.
- Import of previous PlainCAD schema versions.

Body visibility is a transient viewer and interaction property unless explicitly saved as display metadata. Toggling visibility must not invalidate geometry caches or trigger kernel recomputation.

### 5.3 Out of Scope Until Later

- Assemblies and mates.
- CAM and toolpath generation.
- Simulation.
- Sheet metal.
- Generative design.
- Multi-user collaboration.
- Cloud sync as a requirement.
- Mobile-first UI.
- Plugin system.
- Cross-feature general-purpose topological naming solution beyond the explicitly supported feature-owned planar faces and edge roles.

## 6. Core Workflows

### 6.1 Create a Parametric Part

1. User creates a new project.
2. User adds named parameters.
3. User creates a sketch on XY, XZ, or YZ.
4. User draws geometry and applies dimensions/constraints.
5. System solves the sketch and identifies profiles.
6. User creates a feature from a selected profile.
7. System rebuilds the model and updates the viewer.
8. User saves the project.
9. User exports STL or STEP.

### 6.2 Edit Design Intent

1. User edits a parameter expression.
2. System validates expression and unit compatibility.
3. System rebuilds dependent sketches and features.
4. Viewer updates only when the rebuild result belongs to the current document revision.
5. Errors are source-linked to the parameter, sketch, dimension, constraint, or feature.

### 6.3 Diagnose Rebuild Failure

1. User sees failed rebuild status.
2. Rebuild panel lists errors and warnings.
3. Clicking an error selects the source object.
4. Inspector explains the relevant editable fields.
5. User fixes the issue and rebuild resumes.

### 6.4 Save, Load, and Migrate

1. User saves a `.pcaddoc` file.
2. Project serializes deterministically.
3. User reopens the file later.
4. System validates schema version and migrations.
5. System rebuilds and shows any migration or rebuild warnings.

## 7. Architecture

### 7.1 High-Level Pipeline

```text
Project Document
  -> migration and validation
  -> parameter evaluation
  -> sketch solving
  -> profile detection
  -> feature graph planning
  -> kernel shape operations
  -> tessellation
  -> viewer mesh conversion
  -> export
```

### 7.2 Frontend

- React and TypeScript remain the UI foundation.
- Zustand or an equivalent small store remains acceptable for local state.
- Document state, selection state, rebuild state, file/import state, and UI state must stay separated.
- Long-running geometry work must remain outside the main UI thread.

### 7.3 CAD Document

The document model must remain:

- serializable,
- deterministic,
- schema-versioned,
- migration-friendly,
- independent of kernel runtime objects.

Core document sections:

```text
CadDocument
  schemaVersion
  id
  name
  units
  displayUnits
  metadata
  parameters
  sketches
  features
  bodies or body declarations
```

Runtime rebuild results may refer to document IDs and feature IDs but must not become durable project state unless explicitly promoted into the document schema.

Changing `displayUnits` changes presentation defaults only. Existing expressions must preserve physical dimensions because explicit unit tokens, raw expression text, and normalized internal values remain unchanged. Unitless numeric expressions are interpreted under the document unit defaults active when they were authored or migrated; changing display units must not reinterpret `10` from `10mm` to `10in` unless the user explicitly edits the expression.

### 7.4 Parameters

The parameter system must support:

- numeric values with units,
- references to other parameters,
- dependency ordering,
- circular dependency diagnostics,
- unit mismatch diagnostics,
- stable parameter identity independent of display name,
- safe rename handling,
- parameter descriptions.

Parameter names remain user-facing expression symbols. Parameter IDs remain stable object identifiers.

Durable project files preserve raw expression strings, per-expression unit intent, and display-unit metadata so user intent is not lost. During evaluation, length values are normalized to millimeters and angle values are normalized to radians for geometry. UI display values must be derived from the raw expressions and display-unit metadata, not from reserialized normalized kernel values. Expressions may mix compatible units only when the evaluator can convert them deterministically; incompatible dimensions must fail with unit diagnostics.

Parameter evaluation must topologically sort the parameter dependency graph. Circular dependencies must block parameter evaluation and downstream rebuilds with source-linked diagnostics.

The expression evaluator must implement dimensional analysis. Scalars may multiply or divide dimensional values, dimensional values may divide compatible dimensional values to produce scalars, and dimensional multiplication may produce derived units such as area (`mm^2`) or volume (`mm^3`). Every parameter-bound field must declare the exact dimension it accepts, such as length, area, volume, angle, scalar, count, or boolean-like option. Geometry fields that require length or angle values must reject derived units that do not match the field dimension. Adding or subtracting a scalar and a length, angle, or other dimension is invalid.

Parameter expressions should use a tokenized internal representation where parameter references point to stable parameter IDs while preserving user-facing source text for display and editing. Parameter renames must update display text without relying on fragile raw string replacement.

The expression evaluator should support standard mathematical functions required for CAD parameters, including `sin`, `cos`, `tan`, inverse trigonometric functions, square root, exponentiation through `pow(a, b)`, absolute value, min/max, and parentheses. Forward trigonometric functions must accept unit-bearing angle arguments such as `sin(90deg)` and return scalars. Dimensionless arguments to forward trigonometric functions must be rejected rather than interpreted as implicit radians. Inverse trigonometric functions must accept dimensionless scalar ratios and return unit-bearing angles.

Parameters are dependency roots. They may reference constants and other parameters, but they must not depend on measured geometry, feature outputs, or transient kernel properties until a unified document dependency graph explicitly supports that behavior.

Expression evaluation must use an auditable formal math parser, preferably a custom Pratt parser or iterative parser. Any third-party parser must be verified not to use JavaScript `eval`, `Function`, dynamic import, or other general code execution paths for project-provided expressions. The tokenizer must avoid ReDoS-prone regular expressions; a state-machine tokenizer or proven linear-time lexer is preferred. The parser must enforce a separate expression-depth limit for nested parentheses and function calls. The initial default limit is 64 expression nodes of nesting depth, and the implementation must check the limit before recursive descent or use an iterative parser so rejected expressions cannot overflow the JavaScript call stack.

### 7.5 Sketch Solver

The sketch solver should evolve from helper-oriented solving into a small but real 2D constraint system.

Required behavior:

- solve supported constraints deterministically,
- use previous valid solved geometry as the initial seed for iterative solving when available,
- support reset or canonical re-solve behavior to escape bad seed states and reduce edit-history-dependent flips,
- provide anti-flip constraints or diagnostics where supported constraints can converge to mirrored valid solutions,
- detect underconstrained, overconstrained, and conflicting sketches using a documented degrees-of-freedom heuristic for the supported entity and constraint set,
- preserve explicit dimensions as design intent,
- produce solved geometry and diagnostics,
- avoid silent geometry changes that make design intent unclear.

Conflicting or overconstrained sketches must enter a failed solved state. Dependent profile detection and feature rebuilds must halt for that sketch and report source-linked errors instead of generating stale or guessed geometry.

Solved entities that become degenerate after parameter evaluation or constraint solving must fail validation before profile detection or kernel calls. Examples include lines shorter than a configured minimum entity size above the active kernel linear tolerance, circles or arcs with non-positive radius, arcs with effectively zero sweep, and coincident points that violate a required distance dimension. The solver may continue iterating toward a non-degenerate solution within its iteration and time budgets, but it must not heal by silently snapping design geometry or filtering degenerate entities into a different profile. Remaining degenerate entities must produce source-linked diagnostics.

Iterative solving must enforce both an iteration limit and an elapsed-time limit. Initial default targets should be conservative, such as 100 iterations or 50ms for ordinary interactive sketch solves, with failure reported as a non-converged sketch diagnostic rather than blocking the worker indefinitely.

The solver does not need to match commercial CAD completeness, but it must be reliable within the supported constraint set.

### 7.6 Profile Detection

Profile detection must support:

- closed loops made of lines and arcs,
- circles,
- nested profiles and holes,
- profile selection,
- diagnostics for open, ambiguous, or self-intersecting profiles.

Detection must reject or warn on dirty sketch geometry such as zero-length segments, overlapping segments, and duplicate entities. T-junctions and intersections should be handled by an explicit fragmentation step before loop extraction where practical; if fragmentation cannot produce unambiguous loops, the sketch must fail with source-linked diagnostics.

Profiles must have stable identifiers that can survive ordinary parameter edits and sketch re-solves. The primary matching strategy must use the graph of stable sketch entity IDs, entity lineage/provenance for split or derived segments, connectivity, winding, loop role, and containment relationship. Spatial heuristics may be used only when the topological graph is identical and the displacement is within a small configured epsilon relative to model size. If a sketch edit changes the underlying entity graph enough that rebinding is ambiguous, dependent features must fail with a source-linked "profile reference lost" diagnostic instead of binding to an arbitrary profile.

Profile validation must detect self-intersecting loops before kernel operations. Self-intersections must fail profile detection with source-linked diagnostics rather than being passed to OpenCascade.

### 7.7 Feature Graph

The feature graph must:

- rebuild features in timeline order,
- support suppression,
- validate feature references before kernel operations,
- isolate failed features and report downstream impact,
- prevent stale rebuild results from replacing newer results,
- expose user-facing diagnostics,
- validate feature dependency ordering after reorder operations,
- run directed acyclic graph validation after every feature reorder or reference change,
- reject reorders that create cycles, move features before required sketches/profiles, or break existing references.

Fillet and chamfer are allowed only after a minimum viable topological naming strategy exists. The first supported strategy may be deliberately narrow, such as stable references to edges derived from a sketch profile or from a feature-defined edge role. The UI must not allow arbitrary transient kernel edge selections to become durable fillet/chamfer references.

Minimum viable topological naming is not a full commercial-CAD naming solution. For edge treatments, it means references in the generating feature's local coordinate system keyed by stable sketch entity IDs and feature-output roles, such as "edge derived from sketch line ID 42 on the end cap," "start-cap perimeter edges of this extrude," or "end-cap perimeter edges of this extrude." Pure geometric labels, arbitrary kernel edge IDs, and global-axis labels are not durable references and must not be stored in project files.

When one parent sketch entity maps to multiple output edges, references must include a disambiguator derived from local topology traversal, adjacent face roles, neighboring source entity IDs, owning feature role, and deterministic geometric sorting in local feature coordinates, such as midpoint projected onto the source entity or feature axis. Sequence indexes may be stored only as diagnostic hints, not as primary durable identifiers. If the split mapping changes after upstream edits and no unique disambiguation remains, the feature must enter repair-required state rather than guessing.

When a local feature-output reference cannot be resolved exactly, the system may offer a heuristic rebind candidate based on topology-compatible edges, local proximity, length, and role. Heuristic rebinding must never happen silently; the feature should remain in a repair-required state until the user accepts the suggested target.

Runtime rebuilds may cache intermediate kernel shapes and tessellated meshes by document revision and feature ID. The cache is disposable, must never be serialized, and must be invalidated from the earliest changed dependency. Incremental rebuild should reuse valid cached outputs for every feature upstream of the first modified or invalidated dependency, then recompute downstream features in timeline order. Undo/redo may reuse valid cached runtime artifacts but correctness must not depend on cache presence.

Tessellation should be cached per body or feature output so unchanged bodies are not re-tessellated after unrelated edits. Tessellation cache keys must include document revision, body or feature output ID, chordal deflection, angular tolerance, normal-generation mode, level-of-detail profile, and any other quality parameter that affects generated mesh output. The viewer should support configurable mesh quality or multiple levels of detail so interaction can use lower-cost meshes while export and inspection can request higher-quality tessellation.

Any cache that owns OpenCascade.js/WASM objects must define explicit ownership and disposal rules. Cached kernel objects must be registered with a lifecycle manager at creation time and deleted or released when invalidated, evicted, replaced, or when a rebuild scope exits. Prefer arena or generation-based ownership where all objects for a document revision can be swept together; shared cached objects require an explicit owner and must avoid ad hoc manual reference counting in async flows.

Kernel operations must use a shared RAII-style disposable scope utility for transient OpenCascade.js handles. The project must not rely on scattered manual `.delete()` calls inside feature code. A fresh disposable scope must be instantiated per rebuild request or per nested kernel operation; scopes must not be shared across concurrent or overlapping worker requests. Iterative loops over topology, patterns, body sets, or repeated edge operations must create nested short-lived scopes so transient handles are released during the high-water phase rather than only at the end of the feature rebuild. Every wrapper created during a rebuild, including shapes, builders, explorers, arrays, adaptors, topology iterators, and temporary results, must be registered through that scope at creation time and disposed by one `finally` block when the scope exits, even if a kernel call throws. A boolean or modeling operation may promote only an explicitly detached final result handle into the runtime cache; promoted handles must become owned by the cache and deleted when the cached body is replaced or the worker shuts down. Tests must cover thrown kernel-operation paths to prove transient handles are still deleted and promoted handles are not double-freed.

The kernel worker should monitor WASM heap usage, cache size, operation count, and failed-disposal diagnostics. Long-running sessions must support periodic worker recycling and a soft reset that drains work, disposes cached handles, recreates the OpenCascade instance if heap usage, fragmentation indicators, or operation count exceed configured thresholds, and resumes from the durable document.

### 7.8 Kernel Boundary

OpenCascade.js remains behind a `KernelAdapter` boundary.

Application code must not depend directly on OpenCascade types. Kernel operations should expose domain-level inputs and outputs:

- sketch profiles,
- operation parameters,
- bodies,
- meshes,
- export buffers,
- structured errors.

The kernel boundary must define shared geometric tolerances used by sketch solving, profile detection, and kernel operations. Initial tolerances should include a linear tolerance in millimeters and an angular tolerance in radians. Tolerances may scale within bounded ranges based on model bounding-box size to handle very small and very large models without excessive fuzzy matching. The 2D sketch solver's coincidence and closure tolerances must be compatible with, and preferably stricter than, the 3D kernel tolerance so solved profiles remain valid for BREP construction. The solver must account for kernel precision during solving; any final projection or snapping step must validate that it does not change topology, create self-intersections, or introduce micro-gaps before BREP construction. Boolean operations and profile cleanup must use these tolerances consistently instead of hardcoded per-call values.

### 7.9 Worker Boundary

Geometry rebuild must run in a worker or worker-like isolated execution context.

The protocol must include:

- request ID,
- document ID,
- document revision or equivalent stale-result guard,
- cancellation token, abort signal, or monotonically increasing epoch that lets the UI ignore and/or stop obsolete rebuild work,
- operation type,
- structured success/failure payload,
- duration,
- warnings.

Some OpenCascade operations are synchronous and cannot be interrupted once started. Workers should check cancellation between kernel operations where possible and use epoch checks so obsolete results are ignored. Worker termination is a last-resort recovery path for hung workers, not the normal flow for obsolete rebuilds, because recreating an OpenCascade worker is expensive. Long-running kernel calls must be guarded by a main-thread request timeout that observes elapsed time for each worker request; do not depend on a worker heartbeat during synchronous WASM calls because the worker cannot post heartbeats while blocked. A timed-out operation must mark the rebuild failed, terminate and replace the affected worker, and discard any late responses before new rebuild work is accepted. The initial interactive timeout target should be 5-10 seconds; longer export-only limits require explicit progress state and user cancellation. If shared mutable WASM memory or cross-worker kernel state is active, recovery must destroy the entire affected worker/WASM group and create a fresh isolated Web Worker and OpenCascade instance before accepting new rebuild work.

### 7.10 Viewer

The viewer must support:

- model rendering,
- grid and axes,
- camera fit and reset,
- selection highlight,
- hover highlight if performant,
- body/feature selection,
- sketch overlay,
- measurement or inspection overlays.

Viewer state should be transient unless named views are explicitly added to the document.

Session camera state must be preserved across rebuilds and parameter edits unless the user explicitly invokes fit, reset, or a named view command.

## 8. Data Model Requirements

### 8.1 Stable IDs

Every durable object must have a stable ID:

- document,
- parameter,
- sketch,
- sketch entity,
- dimension,
- constraint,
- feature,
- body declaration where durable bodies are introduced.

User-facing names may change. Internal references should use stable IDs where practical.

### 8.2 Schema Versioning

Every project file must include `schemaVersion`.

Rules:

- New app versions must load supported older schemas.
- Unsupported future schemas must fail with a clear message.
- Migrations must be tested.
- A persistent regression corpus of project JSON files must be maintained for every released schema version and loaded in automated migration tests.
- Migration should never require kernel initialization.

### 8.3 Deterministic Serialization

Project serialization must be deterministic enough for:

- meaningful Git diffs,
- repeatable tests,
- stable project file round trips.

Floating-point values in durable project JSON should be avoided when source expressions can represent the same intent. When durable floats are unavoidable, they must use a canonical rounding and stringification policy. Runtime evaluated floats should not be written back into the document merely because a rebuild occurred.

Runtime-only fields must not be serialized.

The viewer coordinate policy from Section 5.1 must be applied consistently in all interaction code. Selection rays, sketch overlays, manipulators, grids, named views, section previews, measurement readouts, and export previews must all use the same CAD-to-view transform and inverse transform.

## 9. User Interface Requirements

### 9.1 Main Layout

The working CAD system should retain the MVP layout pattern:

- top toolbar for high-frequency commands,
- left panel for sketches and feature timeline,
- central viewer,
- right panel for parameters, inspector, rebuild/errors, and help.

The layout may evolve, but it must keep the model structure visible.

### 9.2 Inspector

The Inspector must support:

- parameter editing,
- sketch editing,
- sketch entity editing,
- dimension editing,
- constraint inspection,
- feature editing,
- body inspection,
- rebuild source diagnostics,
- repair workflows for broken references such as lost profiles, missing target bodies, and lost sketch planes.

Edits should commit intentionally, not on every keystroke when they trigger expensive rebuilds. Text fields that affect rebuilds should commit on Enter or explicit apply, preserve drafts on blur when possible, and show a clear dirty state for uncommitted values so navigation does not silently lose work.

### 9.3 Command System

Commands must have:

- stable IDs,
- labels,
- optional shortcuts,
- enablement predicates,
- command palette visibility,
- consistent execution guards.

The UI and execution path must share command enablement logic.

### 9.4 Error UI

Errors must be:

- visible,
- actionable,
- source-linked when possible,
- expressed in user language,
- free of raw stack traces during normal use.

Broken references must remain editable rather than causing data loss. A sketch whose planar face reference disappears must enter a lost-plane state, keep its sketch entities, block dependent rebuilds, and offer a reselect-plane repair path.

Developer diagnostics may exist behind logs or debug modes.

## 10. Export Requirements

### 10.1 STL

STL export must:

- export current successful rebuild meshes,
- fail clearly if no valid rebuilt mesh exists,
- include all visible/exportable bodies,
- produce non-empty binary STL for single-body exports,
- provide explicit multi-body export modes: separate STL files, single STL with separate shells, and best-effort merged/manifold STL via kernel boolean union,
- preserve the document global coordinate system for all STL vertices in every export mode so separately exported bodies retain their relative alignment in slicers and downstream CAD tools,
- default to separate STL files for multiple bodies when body identity matters,
- warn before exporting a single STL with separate shells when optional overlap checks find candidate intersections,
- perform overlap checks asynchronously with broad-phase bounding volumes first, then narrower checks only for candidate overlaps; users must be able to skip expensive narrow checks,
- treat merged/manifold STL union as best-effort because kernel booleans may fail on tangential contacts, near-coincident faces, or very large body sets; when supported, fuzzy boolean tolerances must be explicit, bounded, and reported in export diagnostics,
- sanitize all generated export filenames derived from project, body, feature, or user-provided names with a proven filename sanitizer or equivalent linear-time allowlist character scan; path separators, null bytes, control characters, platform-reserved characters, `.`/`..` traversal names, trailing spaces/dots, and Windows reserved device names such as `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, and `LPT1`-`LPT9` must be rejected or safely prefixed,
- deduplicate generated export filenames with stable numeric suffixes and enforce a conservative maximum filename length, initially 255 characters including extension; truncate the base name before appending suffixes and extensions so uniqueness and extensions are preserved,
- validate manifoldness and normal consistency for print-oriented STL export modes; non-manifold meshes, inconsistent shell orientation, open boundaries, self-intersections, empty triangle sets, and other fabrication risks must produce warnings or blocking errors depending on the selected export mode,
- compute STL facet normals consistently from tessellated triangle winding and BREP face orientation using the right-hand rule,
- run expensive STL generation and validation in a worker or worker-like background path,
- be tested with smoke coverage.

### 10.2 STEP

STEP export should be added only when:

- OpenCascade.js support is reliable in the deployed environment,
- the exporter can operate from rebuilt kernel shapes,
- output can be validated with at least a smoke test, such as non-empty file output with a valid STEP header and, where feasible, kernel round-trip import,
- UI states can accurately communicate availability.

Do not expose STEP controls before the implementation is reliable.

## 11. Performance Requirements

Targets for ordinary desktop hardware:

- parameter dependency evaluation: under 20ms for typical documents,
- sketch solve: under 50ms for typical MVP-scale sketches,
- simple feature rebuild after kernel readiness: under 500ms for MVP-scale sketches and basic boolean operations,
- UI remains responsive during kernel initialization and rebuild,
- stale worker responses never overwrite newer document states.

Kernel initialization may take substantially longer than ordinary rebuilds. The UI must expose a loading or initializing state, disable geometry commands until the worker is ready, and keep non-geometry UI interactions responsive.

Performance tests should record metrics in CI and may enforce thresholds in controlled release environments. Avoid brittle shared-CI timing failures.

## 12. Accessibility Requirements

The app must support:

- keyboard access to the command palette,
- visible focus states,
- accessible names for toolbar buttons,
- accessible labels for editable fields,
- non-color-only error indications,
- clear disabled/unavailable command states.

The app should remain usable at common desktop and tablet-width breakpoints.

## 13. Testing Requirements

### 13.1 Unit Tests

Required unit coverage:

- document validation,
- migrations,
- parameter evaluation,
- unit conversion and mismatch errors,
- dependency ordering,
- circular dependency detection,
- sketch entity operations,
- sketch constraints,
- sketch solving,
- profile detection,
- feature planning,
- rebuild diagnostics,
- serialization,
- import validation,
- STL export.

### 13.2 Integration Tests

Required integration coverage:

- create and edit mounting plate,
- create and edit box,
- create sketch and extrude,
- failed rebuild source-linking,
- project save/load/rebuild,
- import invalid project,
- command enablement and command palette.

### 13.3 Browser Smoke Tests

At release time, verify:

- app loads,
- no framework error overlay,
- command palette opens and filters,
- template creation works,
- parameter edit commits and rebuilds,
- export controls match rebuild state,
- no relevant app console errors.

## 14. Security and Safety

PlainCAD is local-first, but imported project files are untrusted input.

Requirements:

- parse JSON safely with schema validation and prototype-pollution defense,
- reject files above a configured raw byte-size limit before parsing, or use a streaming parser that enforces limits during parse,
- validate schema before use,
- use schema-based validation or a `JSON.parse` reviver with a strict allowlist of accepted object properties before data reaches application state; blacklist-only stripping of keys such as `__proto__`, `prototype`, and `constructor` is insufficient,
- reject malformed documents,
- enforce maximum document size and entity-count limits before expensive validation or rebuild,
- enforce maximum nesting or recursion depth during parsing, schema validation, migration, dependency-graph traversal, and any recursive document traversal; initial default targets are depth 64 for project JSON, depth 64 for parameter expressions, and depth 100 for feature dependency chains,
- enforce configured maximum counts for parameters, sketches, sketch entities, constraints, dimensions, features, bodies, and generated mesh triangles; initial default targets should be conservative, such as 500 parameters, 100 sketches, 10,000 sketch entities across the document, 750 sketch entities per individual sketch, 20,000 constraints/dimensions, 1,000 features, 100 bodies, 500,000 generated triangles per body for ordinary modeling, and 5,000,000 generated triangles across the document; high-resolution export may use a higher explicit quality profile only after warning about memory and time cost,
- avoid executing project-provided code,
- do not embed arbitrary HTML from project files,
- render user-provided strings as text by default and sanitize any content used in tooltips, labels, inspector fields, metadata views, or other DOM sinks,
- forbid `dangerouslySetInnerHTML` for project-provided content unless the content has been sanitized with an approved HTML sanitizer such as DOMPurify and covered by tests,
- ship with a restrictive Content Security Policy that limits script sources, blocks inline script execution where practical, and reduces data-exfiltration impact if a rendering bug escapes sanitization,
- use Trusted Types where browser support permits to enforce sanitizer-created values for dangerous DOM sinks,
- parse, validate, and migrate project files in a worker by default so the UI remains responsive,
- keep worker messages structured and validated.

## 15. Milestones

### Milestone 1 - Multi-Plane Sketching

- Add localized topological naming for stable feature-owned planar faces.
- Add XZ and YZ sketch planes.
- Add offset construction planes.
- Add planar-face sketching for stable feature-owned planar faces.
- Add plane-aware sketch overlays.
- Add tests for plane transforms and profile rebuilds.

### Milestone 2 - Sketch Solver Expansion

- Add arcs, dimensions, and additional constraints.
- Add conflict diagnostics.
- Add underconstrained/overconstrained reporting.

### Milestone 3 - Feature Expansion

- Add extrude cut and join.
- Add revolve.
- Add hole feature.
- Add feature-specific inspector controls.

### Milestone 4 - Edge Treatments

- Add minimum viable topological naming for supported feature-owned edge roles.
- Add chamfer.
- Add fillet.
- Add robust failure diagnostics for invalid edge selections.

### Milestone 5 - Export Hardening

- Harden STL export for multi-body output.
- Add STEP export if kernel support is reliable.
- Add export validation smoke tests.

### Milestone 6 - Project Durability

- Add autosave.
- Add migration tests.
- Add project recovery flow.
- Add better project metadata.

### Milestone 7 - Release Quality

- Add browser smoke automation.
- Add accessibility audit.
- Add performance reporting.
- Add production deployment documentation.

## 16. Definition of Done

The working CAD system is complete when:

- users can create a non-template sketch-driven part from scratch,
- users can edit dimensions and parameters with predictable rebuilds,
- at least one additive and one subtractive feature workflow are reliable,
- failed sketches and features produce actionable diagnostics,
- project save/load preserves design intent,
- STL export works for typical modeled parts,
- STEP export is either reliable and exposed or intentionally omitted,
- tests cover the durable CAD model and critical workflows,
- browser smoke tests pass,
- kernel-specific code remains isolated,
- project files remain deterministic and migration-friendly.

## 17. Non-Goals

This specification does not require:

- assembly modeling,
- CAM,
- simulation,
- multi-user cloud collaboration,
- mobile-first editing,
- full commercial-CAD constraint solver completeness,
- perfect topological naming,
- plugin APIs,
- AI model generation.

These may become future product lines, but they should not block the working single-part CAD system.
