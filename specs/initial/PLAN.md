# PLAN.md - Phased Implementation Plan for Browser-First Parametric CAD MVP

## 1. Planning Assumptions

This plan implements the MVP described in `SPEC.md` as a browser-first, local-first parametric CAD application. The implementation should optimize for a reliable parametric core before breadth of CAD features.

Primary assumptions:

- The initial codebase is empty except for the specification.
- The MVP stack is React, TypeScript, Vite, Three.js, OpenCascade.js or equivalent OCCT WebAssembly package, Web Workers, and Vitest.
- The app remains local-first. No backend, account system, sync service, or cloud storage is included.
- The canonical source of truth is the serialized `CadDocument`; kernel shapes and render meshes are disposable rebuild artifacts.
- The first useful vertical slice is a parameter-driven box rebuilt in a worker and rendered in Three.js.
- Sketch solving is intentionally pragmatic. The MVP must handle helper-created rectangles, circles, dimensions, simple constraints, and mounting-plate workflows, not arbitrary professional sketch solving.
- STEP export is optional. STL export is required.

## 2. Implementation Strategy

Build the product in thin, testable vertical slices. Each phase should leave the app runnable and the core model more capable than before.

The implementation order is:

1. Establish the app shell, test tooling, and viewer baseline.
2. Define the document model and deterministic state mutation patterns.
3. Implement parameters, units, expressions, validation, and tests.
4. Prove the geometry pipeline with a worker-backed parametric box.
5. Add sketch entities and helper-created geometry.
6. Detect supported profiles and extrude them through the kernel adapter.
7. Implement the mounting plate workflow end to end.
8. Add persistence, STL export, command palette, undo/redo, and error-reporting polish.
9. Harden with integration, UI, and regression tests.

Avoid building broad UI scaffolding for unimplemented CAD features. Commands, toolbar items, and panels should only expose working behavior, except for clearly marked future items if needed.

## 3. Phase 0 - Project Skeleton and Tooling

### Goal

Create a strict, maintainable frontend foundation with a runnable Vite app, test setup, basic layout, and a functioning Three.js viewport.

### Tasks

- Initialize a Vite React TypeScript project.
- Enable TypeScript strict mode.
- Add baseline dependencies:
  - `react`
  - `react-dom`
  - `vite`
  - `typescript`
  - `three`
  - `zustand` or a minimal custom store
  - `vitest`
  - `@testing-library/react`
  - `@testing-library/user-event`
  - `jsdom`
- Add optional Playwright only when UI/browser tests are first implemented.
- Create the initial source layout:
  - `src/app`
  - `src/cad`
  - `src/viewer`
  - `src/ui`
  - `src/state`
  - `src/persistence`
  - `src/tests`
- Implement the main application layout:
  - top toolbar
  - left navigation/timeline area
  - central viewer
  - right or bottom inspector area
  - rebuild/error area placeholder
- Implement `CadViewer` with:
  - Three.js renderer lifecycle
  - perspective camera
  - orbit controls
  - XY grid
  - origin axes
  - resize handling
  - empty-scene state
- Add npm scripts:
  - `dev`
  - `build`
  - `test`
  - `test:watch`
  - `lint` if linting is configured
- Add a lightweight test proving the app renders.

### Acceptance Criteria

- `npm run dev` starts the app.
- `npm test` runs successfully.
- `npm run build` completes successfully.
- The browser shows the main layout and a viewer with grid and axes.
- No CAD feature buttons appear unless they are wired to real commands or clearly marked as unavailable.

### Key Risks

- Three.js lifecycle leaks can accumulate during React rerenders. Keep renderer, scene, camera, and controls ownership isolated inside viewer modules.
- Overbuilding the initial shell can slow the core CAD work. Keep this phase deliberately thin.

## 4. Phase 1 - Document Model, IDs, Validation, and State

### Goal

Create the durable parametric document model and deterministic state update layer that all later CAD behavior builds on.

### Tasks

- Define TypeScript models for:
  - `CadDocument`
  - `UnitSystem`
  - `UnitSettings`
  - `CadParameter`
  - `Sketch`
  - `SketchEntity`
  - `SketchConstraint`
  - `SketchDimension`
  - `Feature`
  - `ExtrudeFeature`
  - `HoleFeature`
  - `TopologyRef`
  - `ViewState`
- Add branded or structured ID helpers in `cad/document/ids.ts`.
- Implement `createEmptyDocument`.
- Implement deterministic document update helpers:
  - add/update/delete parameter
  - add/update/delete sketch
  - add/update/delete feature
  - update metadata and timestamps
- Implement schema validation for required document fields.
- Add initial migration scaffolding:
  - current `schemaVersion`
  - no-op migration path
  - future migration registry shape
- Implement app state:
  - current document
  - rebuild state
  - selection state
  - kernel loading state
  - history state placeholder
- Decide whether state uses Zustand or a minimal custom store. Prefer Zustand if it simplifies selectors and update ergonomics.
- Add selectors for common UI reads:
  - ordered parameters
  - ordered sketches
  - ordered features
  - selected object
  - current rebuild errors

### Acceptance Criteria

- A new empty document can be created from UI.
- The document has deterministic required fields and a valid schema version.
- State changes happen through named actions, not ad hoc component mutation.
- Unit tests cover empty document creation, ID generation, basic validation, and deterministic ordering where applicable.

### Key Risks

- If document and state models are mixed together, persistence and rebuild logic become fragile. Keep serialized document types separate from transient UI state.
- Avoid storing Three.js, OpenCascade, or mesh objects in `CadDocument`.

## 5. Phase 2 - Parameters, Units, Expressions, and Errors

### Goal

Implement a safe parameter system with units, references, dependency ordering, cycle detection, and structured error reporting.

### Tasks

- Implement unit parsing and conversion for MVP length units:
  - `mm`
  - `cm`
  - `m`
  - `in`
  - optionally `ft`
- Implement angle unit parsing only if needed by shared unit infrastructure:
  - `deg`
  - `rad`
- Create an expression tokenizer.
- Create a small parser for:
  - numeric literals
  - unit-suffixed literals
  - identifiers
  - unary `+` and `-`
  - binary `+`, `-`, `*`, `/`
  - parentheses
- Implement expression evaluation without `eval`.
- Track expression dependencies on named parameters.
- Implement topological ordering for parameter evaluation.
- Detect and report:
  - unknown parameter references
  - invalid tokens
  - invalid syntax
  - unit mismatch
  - division by zero
  - circular dependencies
- Implement structured errors compatible with `ExpressionError`.
- Implement the parameter panel:
  - list parameters
  - add parameter
  - rename parameter
  - edit expression
  - display resolved value and unit
  - display validation errors inline
- Enforce parameter name rules with `^[a-zA-Z_][a-zA-Z0-9_]*$`.
- Add commands:
  - `parameter.add`
  - `parameter.rename`
  - `parameter.editExpression`
- Add unit tests for:
  - literal parsing
  - unit conversion
  - arithmetic precedence
  - parameter references
  - dependency ordering
  - cycle detection
  - invalid expressions
  - unit mismatch
  - division by zero

### Acceptance Criteria

- Users can create and edit named parameters.
- Expressions can reference earlier or later parameters by name.
- Cycles are detected and shown as user-facing errors.
- Bad expressions do not crash the app.
- Parameter tests cover the main grammar and failure modes.

### Key Risks

- Unit semantics can expand quickly. Keep the MVP focused on length values needed for simple mechanical parts.
- Do not introduce a heavy symbolic math system unless the small parser proves insufficient.

## 6. Phase 3 - Command System and Undo/Redo Foundation

### Goal

Introduce a command registry early enough that UI actions, shortcuts, toolbar buttons, and the command palette share the same behavior.

### Tasks

- Define `CadCommand` and `CommandContext`.
- Implement `commandRegistry`.
- Register commands for existing working behavior:
  - `file.newProject`
  - `view.fit`
  - `view.resetCamera`
  - parameter commands from Phase 2
- Wire the top toolbar to commands.
- Add keyboard handling infrastructure.
- Implement immutable document snapshot history:
  - `past`
  - `present`
  - `future`
  - max depth of 50
- Implement commands:
  - `history.undo`
  - `history.redo`
- Ensure transient UI state is not captured in document snapshots except when explicitly part of the saved document.
- Add tests for:
  - command enabled/disabled behavior
  - undo/redo after parameter edits
  - history depth limit

### Acceptance Criteria

- Toolbar actions call commands rather than directly mutating app state.
- Undo and redo work for parameter document changes.
- Command enabled states reflect current app state.
- History does not capture kernel objects, meshes, workers, or viewer runtime state.

### Key Risks

- Adding command infrastructure too late causes duplicate behavior paths. Add it before sketches and features.
- Snapshot history is acceptable for MVP but should be bounded to avoid memory growth.

## 7. Phase 4 - Worker Rebuild Protocol and Kernel Proof

### Goal

Prove the full rebuild path with a simple parameter-driven box generated by the CAD kernel in a Web Worker, tessellated, and rendered in the viewer.

### Tasks

- Add `cad/worker/workerProtocol.ts` with request/response messages:
  - initialize kernel
  - rebuild document
  - export STL
  - report progress or status
- Add `geometryWorker.ts`.
- Add kernel loading state:
  - idle
  - loading
  - ready
  - failed
- Show `Loading CAD kernel...` while WASM initializes.
- Add `KernelAdapter` interface.
- Add `OpenCascadeKernel` implementation.
- Keep all OpenCascade.js types inside `cad/kernel`.
- Implement minimal kernel operations:
  - `createBox`
  - `tessellate`
  - `exportStl` stub or later implementation point
- Implement render mesh model independent of Three.js.
- Implement mesh conversion from rebuild output to Three.js geometry.
- Add a built-in parametric box document/template with:
  - `width`
  - `height`
  - `depth`
- Implement a temporary real command:
  - `template.createBox`
- Add rebuild request scheduling when document parameters change.
- Add stale rebuild protection:
  - request IDs
  - ignore old worker responses after newer requests complete
- Add structured rebuild result:
  - success
  - bodies
  - meshes
  - errors
  - warnings
  - duration
- Add tests for worker protocol message shapes and rebuild ordering where practical.

### Acceptance Criteria

- The app initializes the CAD kernel in a worker.
- Users can create a parameter-driven box from a template or command.
- Editing width, height, or depth rebuilds the mesh.
- The viewer updates without blocking the UI thread.
- OpenCascade.js types do not leak outside `cad/kernel`.

### Key Risks

- OpenCascade.js package APIs vary by distribution. Isolate package-specific calls tightly so the adapter can be replaced if needed.
- WASM initialization may require Vite configuration. Resolve this in the kernel phase before building features on top.
- Worker rebuild race conditions can show stale geometry. Use request IDs from the start.

## 8. Phase 5 - Viewer Interaction, Selection, and Inspection

### Goal

Make generated geometry usable in the viewer with fit, selection, highlighting, and inspection hooks.

### Tasks

- Implement viewer scene helpers:
  - grid
  - axes
  - lights
  - model material
  - edge outlines if feasible
- Implement camera helpers:
  - fit model
  - reset camera
  - maintain view state
- Implement `SelectionState`.
- Implement body and feature selection.
- Add transient face/edge selection only if mesh topology metadata is available without overcomplicating the rebuild output.
- Add hover highlighting if feasible.
- Implement inspector display for selected:
  - body
  - feature
  - parameter
- Wire `F` to fit selected or fit model.
- Wire `Esc` to cancel active command or clear selection.
- Add tests for selection state and inspector routing.

### Acceptance Criteria

- Users can orbit, pan, zoom, and fit the generated model.
- Users can select a body or feature and see basic properties.
- Selection data remains app-level/transient and does not corrupt the serialized document.

### Key Risks

- Durable face/edge references are intentionally out of scope. Avoid promising stable topology selection in the MVP.
- Viewer interactions should not modify the document unless explicitly invoked through commands.

## 9. Phase 6 - Sketch Model and Helper-Created Geometry

### Goal

Implement XY sketches with points, lines, circles, helper-created rectangles, simple dimensions, and simple constraints sufficient for mounting plate workflows.

### Tasks

- Implement sketch models:
  - `Sketch`
  - `SketchPoint`
  - `SketchLine`
  - `SketchCircle`
  - `ExpressionRef`
  - `SketchConstraint`
  - `SketchDimension`
- Implement sketch creation command:
  - `sketch.createXY`
- Implement helper commands:
  - `sketch.addLine`
  - `sketch.addCenterRectangle`
  - `sketch.addCornerRectangle`
  - `sketch.addCircle`
- Store rectangles as four lines and four points.
- Implement expression resolution for point coordinates and circle radii.
- Implement simple constraint handling:
  - fixed
  - horizontal
  - vertical
  - coincident
  - equal length if feasible
  - equal radius if feasible
- Implement conflict reporting instead of complex solve attempts.
- Implement sketch overlay rendering in the viewer:
  - points
  - lines
  - circles
  - selected sketch entities
  - optional dimension labels
- Implement sketch panel:
  - list sketches
  - create sketch
  - select sketch
  - list entities
  - show constraints and dimensions
- Implement inspector editing for sketch entity expressions.
- Add tests for:
  - sketch creation
  - line helper
  - center rectangle helper
  - corner rectangle helper
  - circle helper
  - missing point references
  - invalid circle radius
  - horizontal and vertical constraints
  - coincident point handling

### Acceptance Criteria

- Users can create an XY sketch.
- Users can add a center rectangle driven by parameter expressions.
- Users can add circles driven by parameter expressions.
- Sketch geometry displays in the viewer.
- Invalid sketch expressions and references appear as sketch errors.

### Key Risks

- A general constraint solver is not an MVP requirement. Keep the solver deterministic, limited, and honest about conflicts.
- Sketch UI can become complex quickly. Favor helper-created geometry and inspector editing over freeform professional sketching in the first version.

## 10. Phase 7 - Profile Detection

### Goal

Detect the limited set of profiles needed for extrusion and the mounting plate example.

### Tasks

- Define resolved sketch geometry types.
- Implement profile detection for:
  - closed rectangle from four connected lines
  - circle profile
  - rectangle with one or more circle inner loops
- Validate that circular holes are fully inside the rectangle.
- Reject unsupported open or ambiguous profiles with clear errors.
- Assign stable profile IDs derived from sketch/entity IDs where practical.
- Add UI feedback for detected profiles:
  - highlight selectable profiles
  - show profile count in sketch panel or inspector
- Add tests for:
  - rectangle profile detection
  - circle profile detection
  - rectangle with circular holes
  - open rectangle rejection
  - circle outside rectangle rejection
  - ambiguous unsupported geometry rejection

### Acceptance Criteria

- A helper-created rectangle is detected as a closed profile.
- A circle is detected as a circular profile.
- A rectangle with inner circles is detected as one profile with holes.
- Open profiles cannot be extruded and produce a useful error.

### Key Risks

- Generic graph-based profile detection is likely too expensive for MVP. Implement only the shapes in scope.
- Profile IDs must be stable enough for feature references when the user edits parameter values.

## 11. Phase 8 - Feature Graph and Extrude

### Goal

Implement timeline-ordered feature rebuild with extrude support and enough boolean subtraction to create plates with holes.

### Tasks

- Implement `Feature` base behavior:
  - ordered timeline
  - suppress/unsuppress
  - rename
  - delete
- Implement `rebuildGraph`.
- Implement feature commands:
  - `feature.extrude`
  - `feature.suppress`
  - `feature.delete`
- Implement `ExtrudeFeature`:
  - `newBody`
  - positive direction
  - distance expression
- Implement rectangle extrusion through `KernelAdapter.extrudeProfile`.
- Implement circle extrusion if needed for simple cylinders/spacers.
- Implement hole handling using one of these MVP paths:
  - preferred: extrude rectangle profile with inner circular loops into one kernel shape
  - fallback: extrude rectangle body, extrude circle tools, then `cut`
- Implement `cut` in the kernel adapter if fallback hole handling is used.
- Defer separate `HoleFeature` unless circle-profile subtraction is not sufficient.
- Add rebuild errors for:
  - missing sketch
  - missing profile
  - unsupported profile
  - invalid distance
  - kernel failure
- Add feature timeline UI:
  - list features
  - select feature
  - rename feature
  - suppress/unsuppress
  - delete feature
  - show rebuild status
- Add tests for:
  - feature ordering
  - suppressed features
  - missing references
  - extrude rebuild success
  - parameter-driven extrusion distance
  - rectangular plate with circular holes if kernel test environment allows it

### Acceptance Criteria

- Users can create an extrude from a supported sketch profile.
- Editing a parameter referenced by sketch dimensions or extrude distance rebuilds the model.
- A rectangular mounting plate with holes can be generated.
- Feature errors are shown without crashing the app.

### Key Risks

- Boolean operations may fail for edge cases or OpenCascade.js API differences. Start with simple, clean profiles and add error reporting around kernel calls.
- Do not introduce fillet/chamfer in MVP unless this phase is complete and the implementation is trivial.

## 12. Phase 9 - Mounting Plate Template and End-to-End MVP Workflow

### Goal

Make the required mounting plate workflow easy to execute and reliable enough to serve as the MVP acceptance scenario.

### Tasks

- Implement built-in mounting plate template with parameters:
  - `plate_width`
  - `plate_height`
  - `plate_thickness`
  - `hole_diameter`
  - `hole_offset_x` or `hole_spacing_x`
  - `hole_offset_y` or `hole_spacing_y`
- Create an XY sketch with:
  - centered rectangle using `plate_width` and `plate_height`
  - four hole circles using `hole_diameter / 2`
  - hole positions expressed relative to center or edges
- Add an extrude feature using `plate_thickness`.
- Cut or subtract holes through the plate.
- Add command:
  - `template.createMountingPlate`
- Add template UI entry only once the template fully rebuilds.
- Ensure parameter edits update:
  - plate dimensions
  - hole positions
  - hole diameter
  - plate thickness
- Add an integration test that:
  - creates the mounting plate document from code
  - rebuilds it
  - verifies success
  - verifies one body exists
  - verifies the render mesh has vertices and triangles
  - changes `plate_width`
  - verifies the mesh bounding box changes

### Acceptance Criteria

- A user can create or load the mounting plate template.
- The 3D model shows a plate with four holes.
- Changing `plate_width` from `80mm` to `100mm` rebuilds the model and updates the visible plate.
- The holes remain positioned according to their expressions.
- The integration test proves the workflow without relying solely on manual UI testing.

### Key Risks

- The template should use the same document model and rebuild pipeline as user-created geometry. Avoid special rendering shortcuts.
- If hole booleans are unstable, narrow the supported geometry and add precise error messages rather than broadening scope.

## 13. Phase 10 - Persistence and Project Import/Export

### Goal

Implement durable project save/load with deterministic JSON and safe import validation.

### Tasks

- Implement deterministic project serialization:
  - pretty-printed JSON
  - `schemaVersion`
  - no kernel objects
  - no render meshes
  - stable ordering where practical
- Choose the initial extension:
  - `.pcaddoc`
- Implement persistence module:
  - `saveProject`
  - `loadProject`
  - `exportProject`
  - `importProject`
- Implement browser file operations:
  - download project JSON
  - open/import project JSON from file input
- Implement local storage or IndexedDB autosave if useful, but keep explicit file export/import as the required path.
- Validate imported files:
  - parse JSON safely
  - validate schema version
  - validate required fields
  - run migrations
  - validate references
  - rebuild after load
- Add commands:
  - `file.openProject`
  - `file.saveProject`
  - `file.exportJson`
- Show file errors in user-facing language.
- Add tests for:
  - save/load round trip
  - deterministic serialization
  - invalid JSON
  - unsupported schema version
  - missing required fields
  - imported document rebuild path

### Acceptance Criteria

- Users can save a project file.
- Users can reload the saved project and get the same document and rebuilt model.
- Invalid project files show understandable errors.
- JSON save/load tests pass.

### Key Risks

- Browser file APIs vary slightly by browser. Use conservative download and file input flows for MVP.
- Deterministic ordering is easier if serialization is centralized rather than distributed through UI code.

## 14. Phase 11 - STL Export and Optional STEP Export

### Goal

Allow the user to export printable geometry from the current rebuilt model.

### Tasks

- Implement `KernelAdapter.exportStl`.
- Decide whether STL export should use:
  - kernel-native STL writer if available
  - tessellated mesh writer if kernel-native support is awkward
- Export current visible/rebuilt body or all bodies if multiple bodies naturally exist.
- Add export status and user-facing errors.
- Add command:
  - `file.exportStl`
- Add toolbar/menu entry for STL export.
- Disable STL export when:
  - kernel is not ready
  - no successful rebuild exists
  - there are no bodies
- Add STL smoke test if practical:
  - create simple body
  - export STL
  - verify non-empty output
  - verify expected STL header or binary size
- Investigate STEP export only after STL works:
  - if straightforward, implement `exportStep`
  - if not, leave it out of MVP UI

### Acceptance Criteria

- Users can export STL for the mounting plate.
- Export failures show useful messages.
- STEP is either implemented and exposed, or omitted from the UI.

### Key Risks

- Kernel-native export APIs may be inconsistent in WebAssembly builds. A mesh-based STL exporter is acceptable for MVP if geometry is already tessellated correctly.
- Do not show STEP controls unless STEP actually works.

## 15. Phase 12 - Command Palette, Inspector, Errors, and Usability Pass

### Goal

Make the MVP coherent and usable without exposing raw JSON or internal kernel details.

### Tasks

- Implement command palette opened with `Cmd/Ctrl+K`.
- Show available commands with filtering.
- Respect command `enabled` predicates.
- Add tooltips for toolbar buttons.
- Improve inspector behavior for:
  - parameter
  - sketch entity
  - sketch
  - feature
  - body
- Implement rebuild errors panel:
  - parameter errors
  - sketch errors
  - feature errors
  - kernel errors
  - export errors
  - file errors
- Make errors clickable when source selection is possible.
- Ensure raw stack traces are not shown in normal UI.
- Add visible rebuild status:
  - idle
  - queued
  - rebuilding
  - succeeded
  - failed
- Add accessible labels and focus states:
  - form fields
  - command palette
  - toolbar buttons
  - error text association
- Document interaction mappings inside the app in a concise help area or command list:
  - select
  - orbit
  - pan
  - zoom
  - fit
  - cancel
- Remove or hide unimplemented feature controls.

### Acceptance Criteria

- A user can find working commands through the command palette.
- Rebuild errors are visible, understandable, and source-linked where possible.
- Inspector editing covers the MVP objects.
- The app does not show stack traces as normal UI errors.
- All visible controls either work or are explicitly marked unavailable.

### Key Risks

- Usability work can expand endlessly. Limit this phase to clarity, discoverability, and required MVP workflows.
- Avoid modal-heavy flows; prefer inline editing and inspector controls.

## 16. Phase 13 - Testing, Performance, and Release Hardening

### Goal

Close gaps before MVP completion with targeted tests, browser checks, and performance validation against the spec.

### Tasks

- Expand unit test coverage for:
  - unit parsing
  - expression parsing
  - parameter dependency ordering
  - circular dependency detection
  - sketch entity creation
  - rectangle helper creation
  - circle helper creation
  - profile detection
  - feature graph rebuild ordering
  - JSON save/load round trip
  - STL export smoke test
- Add integration tests for:
  - mounting plate create/rebuild/edit workflow
  - parametric box create/rebuild/edit workflow
  - imported project rebuild
- Add UI tests for:
  - app loads
  - create project
  - add/edit parameter
  - create mounting plate template
  - visible geometry after template creation
  - export project JSON
- Validate performance targets on simple parts:
  - parameter evaluation under 20ms
  - sketch solve under 50ms
  - simple plate rebuild under 500ms after WASM initialization where feasible
  - viewer stays responsive during rebuilds
- Add basic browser smoke checks:
  - Chromium
  - Firefox
  - Safari best effort
- Run accessibility checks manually for:
  - keyboard command palette
  - focus visibility
  - labels on editable fields
  - error messaging
- Run final build and test commands.

### Acceptance Criteria

- Unit, integration, and UI tests pass.
- The mounting plate workflow passes manually and through integration tests.
- `npm run build` passes.
- The app remains responsive during rebuilds.
- Core MVP definition of done from the spec is satisfied.

### Key Risks

- Automated tests around WebAssembly workers may require environment-specific handling. Keep pure logic tests separate from kernel integration tests so failures are easy to diagnose.
- Performance targets depend on machine and browser; measure and record practical values rather than hardcoding brittle assertions.

## 17. Cross-Cutting Technical Guidelines

### Document Model

- Treat `CadDocument` as the only durable source of truth.
- Store only serializable, deterministic data in documents.
- Keep mesh, worker, viewer, and kernel runtime objects outside the document.
- Prefer pure functions for validation, expression evaluation, sketch solving, profile detection, and feature graph planning.

### Kernel Boundary

- Keep OpenCascade.js imports and types inside `src/cad/kernel`.
- Application code should only depend on `KernelAdapter`.
- Convert kernel errors into `RebuildError` objects with user-facing messages.
- Avoid durable feature references to arbitrary transient face or edge IDs.

### Worker Boundary

- Rebuild geometry in the worker.
- Use structured clone-friendly messages.
- Add request IDs to avoid stale worker responses.
- Keep UI responsive during kernel initialization and rebuilds.

### UI Behavior

- Expose only working commands.
- Show unavailable behavior only when clearly marked as future work.
- Prefer inline editing and inspector controls.
- Keep rebuild errors visible and actionable.
- Do not show raw stack traces in the main UI.

### Testing

- Test pure CAD logic heavily.
- Keep kernel integration tests focused and few.
- Add at least one true end-to-end mounting plate workflow test.
- Use browser/UI tests for critical user workflows, not every small visual state.

## 18. Suggested Milestone Mapping

The phases map to the spec milestones as follows:

| Spec Milestone | Plan Phases |
| --- | --- |
| Milestone 0 - Project Skeleton | Phase 0 |
| Milestone 1 - Parameter System | Phases 1-3 |
| Milestone 2 - Kernel Proof | Phases 4-5 |
| Milestone 3 - Sketch Model | Phases 6-7 |
| Milestone 4 - Extrude | Phases 8-9 |
| Milestone 5 - Persistence and Export | Phases 10-11 |
| Milestone 6 - Usability Pass | Phases 12-13 |

## 19. MVP Completion Checklist

The MVP is complete when all of these are true:

- The app runs locally from a clean checkout.
- The app creates a new CAD document.
- Users can add and edit parameters.
- Expressions can reference parameters and report structured errors.
- The CAD kernel initializes in a worker.
- Geometry rebuilds happen off the UI thread.
- The viewer renders rebuilt meshes.
- Users can orbit, pan, zoom, select, and fit the model.
- Users can create or load a mounting plate template.
- The mounting plate has a rectangular body and four holes.
- Editing mounting plate parameters rebuilds the model.
- Users can save project JSON.
- Users can reload project JSON and get the same rebuilt model.
- Users can export STL.
- Rebuild errors are shown clearly in the UI.
- Core parameter, sketch, profile, rebuild, persistence, and export logic has tests.
- Kernel-specific code is isolated behind `KernelAdapter`.
- Unimplemented future features are not exposed as working controls.

## 20. Deferred Until After MVP

These items should remain out of scope until the MVP workflow is complete:

- Assemblies, mates, and joints.
- CAM or toolpath generation.
- Simulation.
- Generative design.
- Sheet metal tools.
- Loft, sweep, and advanced surface modeling.
- General-purpose sketch constraint solving.
- Robust topological naming.
- Fillet and chamfer unless trivial after extrude is complete.
- Multi-user collaboration.
- Cloud sync.
- Plugin system.
- AI-assisted CAD generation.
- Mobile-specific UI.
- Go backend or hosted API.
- Tauri desktop packaging.

