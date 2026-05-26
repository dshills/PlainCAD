# SPEC.md — Browser-First Parametric CAD MVP

## 1. Project Summary

Build a browser-first, local-first parametric CAD application focused on making simple mechanical parts easy to design, modify, and export.

The product should feel closer to “guided mechanical design” than traditional CAD. The first version must support a small but real workflow:

1. Create a new project.
2. Define named parameters with units.
3. Create simple 2D sketches on the XY plane.
4. Add constrained dimensions to sketch geometry.
5. Extrude closed profiles into 3D solids.
6. View, orbit, pan, zoom, and inspect the model.
7. Edit parameters and rebuild the model.
8. Save/load project files as JSON.
9. Export STL and, if feasible, STEP.

The application is not a Fusion 360 clone. The MVP should deliberately avoid full assemblies, CAM, simulation, sheet metal, generative design, collaboration, and advanced surfacing.

The design priority is: **make a small, reliable, understandable parametric CAD core before adding broad CAD features.**

---

## 2. Product Positioning

### 2.1 Working Product Description

A simple parametric CAD tool for makers, engineers, and developers who want design intent without the complexity cliff of traditional CAD.

### 2.2 Primary User

The primary user is someone designing practical mechanical parts such as:

- 3D printer brackets
- Motor mounts
- Linear rail adapters
- Belt clamps
- Electronics plates
- Jigs and fixtures
- Enclosures
- Simple CNC/printed mechanical parts

The user understands dimensions but may not be a professional CAD operator.

### 2.3 Design Philosophy

The application should make the parametric model obvious. Parameters, sketches, features, and rebuild errors should be visible and understandable.

The user should never need to think about low-level BREP data, triangulation, topology internals, or kernel objects.

---

## 3. Technology Stack

### 3.1 Required MVP Stack

Use the following stack for the initial implementation:

```text
Frontend:      React + TypeScript + Vite
3D Viewer:     Three.js
CAD Kernel:    OpenCascade.js / OCCT WebAssembly
State:         Zustand or a minimal custom store
Workers:       Web Workers for geometry rebuilds
Styling:       Tailwind CSS or plain CSS modules
Persistence:   Browser localStorage / IndexedDB + file import/export
Testing:       Vitest + React Testing Library + Playwright optional
```

### 3.2 Optional Later Stack

```text
Desktop Shell: Tauri
Backend:       Go API
Database:      PostgreSQL or SQLite for hosted project metadata
Blob Storage:  S3-compatible object storage for project/export artifacts
Sync:          REST + WebSocket/SSE for rebuild/export status
```

Do not implement the Go backend in the MVP unless explicitly requested later. The architecture should leave a seam for it.

---

## 4. Hard Scope Boundaries

### 4.1 MVP Must Include

- Single-part modeling only.
- One active document at a time.
- XY-plane sketches only for v1.
- Basic 2D sketch entities:
  - Point
  - Line
  - Rectangle helper
  - Circle
- Basic dimensions:
  - Length
  - Radius/diameter
  - Horizontal distance
  - Vertical distance
- Basic constraints:
  - Fixed
  - Horizontal
  - Vertical
  - Coincident
  - Equal length or equal radius, if feasible
- Named parameters with units.
- Expressions referencing parameters.
- Feature history graph.
- Extrude feature.
- Hole feature or circle-profile subtraction.
- Rebuild from parametric document model.
- Rendered 3D preview.
- Basic face/edge/feature selection.
- Save/load JSON project files.
- Export STL.

### 4.2 MVP Should Not Include

- Assemblies
- Mates/joints
- CAM/toolpaths
- Simulation
- Generative design
- Sheet metal
- Loft/sweep/surface modeling
- Multi-user collaboration
- Branching/version control
- Mobile support
- Plugin system
- AI generation
- Full constraint solver completeness
- Full topological naming solution

### 4.3 Avoid Fake Features

Do not add UI buttons for features that are not implemented. Disabled placeholders are acceptable only if clearly marked as “coming later.”

---

## 5. Core Architectural Principle

The canonical source of truth is the **parametric document model**, not the mesh and not the OpenCascade runtime objects.

```text
Project JSON
  -> parameter evaluation
  -> sketch solving
  -> feature graph evaluation
  -> OpenCascade shape generation
  -> mesh tessellation
  -> Three.js preview
```

The mesh is disposable. The kernel shape is disposable. The project document is durable.

---

## 6. High-Level Architecture

```text
src/
  app/
    App.tsx
    routes.tsx
    layout/
  cad/
    document/
      CadDocument.ts
      ids.ts
      schema.ts
      migrations.ts
    parameters/
      ParameterStore.ts
      expressionEvaluator.ts
      units.ts
    sketch/
      SketchModel.ts
      SketchSolver.ts
      constraints.ts
      profileDetection.ts
    features/
      Feature.ts
      ExtrudeFeature.ts
      HoleFeature.ts
      FilletFeature.ts
      rebuildGraph.ts
    kernel/
      KernelAdapter.ts
      OpenCascadeKernel.ts
      meshConversion.ts
      stlExport.ts
      stepExport.ts
    worker/
      geometryWorker.ts
      workerProtocol.ts
  viewer/
    CadViewer.tsx
    scene.ts
    camera.ts
    controls.ts
    selection.ts
    overlays.ts
  ui/
    panels/
      ParameterPanel.tsx
      FeatureTimeline.tsx
      SketchPanel.tsx
      InspectorPanel.tsx
      RebuildErrorsPanel.tsx
    commands/
      CommandPalette.tsx
      commandRegistry.ts
    components/
  state/
    useCadStore.ts
    actions.ts
    selectors.ts
  persistence/
    saveProject.ts
    loadProject.ts
    exportProject.ts
    importProject.ts
  tests/
```

---

## 7. Document Model

### 7.1 CadDocument

The `CadDocument` is the complete serialized project.

```ts
export interface CadDocument {
  schemaVersion: number;
  id: string;
  name: string;
  units: UnitSystem;
  createdAt: string;
  updatedAt: string;
  parameters: Record<string, CadParameter>;
  sketches: Record<string, Sketch>;
  features: Feature[];
  viewState?: ViewState;
  metadata?: Record<string, unknown>;
}
```

### 7.2 UnitSystem

```ts
export type UnitSystem = "metric" | "imperial";

export interface UnitSettings {
  length: "mm" | "cm" | "m" | "in" | "ft";
  angle: "deg" | "rad";
  mass?: "g" | "kg" | "lb";
}
```

MVP default: metric, millimeters, degrees.

### 7.3 CadParameter

```ts
export interface CadParameter {
  id: string;
  name: string;
  expression: string;
  value: number;
  unit: string;
  description?: string;
  locked?: boolean;
}
```

Examples:

```json
{
  "plate_width": {
    "id": "param_001",
    "name": "plate_width",
    "expression": "80mm",
    "value": 80,
    "unit": "mm"
  },
  "hole_spacing": {
    "id": "param_002",
    "name": "hole_spacing",
    "expression": "plate_width - 20mm",
    "value": 60,
    "unit": "mm"
  }
}
```

---

## 8. Parameter and Expression System

### 8.1 Requirements

The parameter system must support:

- Numeric literals
- Units
- Basic arithmetic: `+`, `-`, `*`, `/`, parentheses
- References to named parameters
- Dependency ordering
- Cycle detection
- Error reporting

### 8.2 Example Valid Expressions

```text
80mm
plate_width - 20mm
rail_spacing / 2
2 * hole_radius
plate_thickness + 1.5mm
```

### 8.3 Invalid Expression Handling

Invalid expressions must not crash the app. They should produce structured errors:

```ts
export interface ExpressionError {
  parameterName: string;
  message: string;
  expression: string;
  span?: { start: number; end: number };
}
```

Examples:

- Unknown parameter: `foo_width`
- Unit mismatch: `10mm + 2deg`
- Division by zero
- Circular dependency: `a = b + 1`, `b = a + 1`

### 8.4 Implementation Guidance

For the MVP, prefer a small expression parser rather than a heavy symbolic math system.

Acceptable approaches:

1. Use a lightweight expression parser library.
2. Implement a recursive descent parser for the supported grammar.

Do not use `eval`.

---

## 9. Sketch Model

### 9.1 Sketch

```ts
export interface Sketch {
  id: string;
  name: string;
  plane: SketchPlane;
  entities: Record<string, SketchEntity>;
  constraints: SketchConstraint[];
  dimensions: SketchDimension[];
}

export type SketchPlane = "XY";
```

Only XY plane is required for the MVP.

### 9.2 Sketch Entities

```ts
export type SketchEntity = SketchPoint | SketchLine | SketchCircle;

export interface SketchPoint {
  id: string;
  type: "point";
  x: ExpressionRef;
  y: ExpressionRef;
}

export interface SketchLine {
  id: string;
  type: "line";
  startPointId: string;
  endPointId: string;
}

export interface SketchCircle {
  id: string;
  type: "circle";
  centerPointId: string;
  radius: ExpressionRef;
}
```

### 9.3 ExpressionRef

```ts
export interface ExpressionRef {
  expression: string;
  resolvedValue?: number;
  unit: string;
}
```

### 9.4 Sketch Helpers

The UI should expose helper tools that create multiple sketch entities at once:

- Center rectangle
- Corner rectangle
- Circle
- Two-point line

A rectangle should be stored as four lines and four points, not as a special permanent primitive, unless explicitly wrapped as a helper feature.

---

## 10. Sketch Constraints

### 10.1 Constraint Types

```ts
export type ConstraintType =
  | "fixed"
  | "horizontal"
  | "vertical"
  | "coincident"
  | "equalLength"
  | "equalRadius";

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  entityIds: string[];
  pointIds?: string[];
}
```

### 10.2 MVP Solver Strategy

Do not attempt a perfect general-purpose constraint solver in the first version.

Use a pragmatic staged approach:

1. Dimensions and expressions resolve first.
2. Helper-created geometry should already be valid and constrained.
3. Horizontal/vertical constraints adjust line endpoints.
4. Coincident constraints merge or synchronize point positions.
5. Fixed constraints lock points.
6. Solver reports conflicts instead of trying to be clever.

The MVP should support reliable editing of generated/simple sketches rather than arbitrary professional sketch solving.

### 10.3 Solver Errors

```ts
export interface SketchSolveError {
  sketchId: string;
  constraintId?: string;
  entityId?: string;
  message: string;
  severity: "warning" | "error";
}
```

Examples:

- Over-constrained sketch
- Cannot satisfy horizontal constraint
- Missing referenced point
- Invalid circle radius
- Open profile cannot be extruded

---

## 11. Profile Detection

### 11.1 MVP Profile Rules

For MVP, support these profile types:

1. Closed rectangle from four connected lines.
2. Circle profile.
3. Rectangle with circular holes.

Generic arbitrary profile detection may be deferred.

### 11.2 Profile Model

```ts
export interface SketchProfile {
  id: string;
  sketchId: string;
  outerLoop: ProfileLoop;
  innerLoops: ProfileLoop[];
}

export interface ProfileLoop {
  entityIds: string[];
  type: "polygon" | "circle";
}
```

### 11.3 Hole Handling

If a sketch contains a rectangle and one or more circles fully inside it, extrusion should create a plate with holes.

---

## 12. Feature System

### 12.1 Feature Base

```ts
export type Feature = ExtrudeFeature | HoleFeature | FilletFeature | ChamferFeature;

export interface FeatureBase {
  id: string;
  name: string;
  type: string;
  suppressed?: boolean;
  createdAt: string;
}
```

### 12.2 ExtrudeFeature

```ts
export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  sketchId: string;
  profileId: string;
  operation: "newBody" | "join" | "cut";
  distance: ExpressionRef;
  direction: "positive" | "negative" | "symmetric";
}
```

MVP must support:

- `newBody`
- `cut` if using circular holes through a plate
- positive direction

### 12.3 HoleFeature

A separate hole feature is optional for MVP if circle-profile subtraction works.

If implemented:

```ts
export interface HoleFeature extends FeatureBase {
  type: "hole";
  targetFeatureId: string;
  sketchId: string;
  centerPointIds: string[];
  diameter: ExpressionRef;
  depth: ExpressionRef | "throughAll";
}
```

### 12.4 FilletFeature and ChamferFeature

Fillet/chamfer are Phase 2, not MVP, unless the kernel adapter makes them trivial.

```ts
export interface FilletFeature extends FeatureBase {
  type: "fillet";
  targetEdgeRefs: TopologyRef[];
  radius: ExpressionRef;
}

export interface ChamferFeature extends FeatureBase {
  type: "chamfer";
  targetEdgeRefs: TopologyRef[];
  distance: ExpressionRef;
}
```

---

## 13. Topology References

### 13.1 MVP Reality

Robust topological naming is hard. The MVP should not pretend otherwise.

Use simple topology references only for current-session selection, not durable long-term references, unless they are stable enough for the selected feature type.

```ts
export interface TopologyRef {
  featureId: string;
  kind: "face" | "edge" | "vertex";
  transientId: string;
  stableHint?: string;
}
```

### 13.2 Durable Modeling Rule

For MVP, features should primarily reference sketches and profiles, not arbitrary faces/edges.

This avoids the classic CAD problem where changing one earlier feature renames half the model and the timeline collapses into soup.

---

## 14. Rebuild Engine

### 14.1 Rebuild Pipeline

```text
1. Load CadDocument
2. Validate schema
3. Evaluate parameters
4. Resolve sketch expressions
5. Solve sketch constraints
6. Detect sketch profiles
7. Evaluate features in timeline order
8. Generate kernel shapes
9. Tessellate shapes into render meshes
10. Return RebuildResult
```

### 14.2 RebuildResult

```ts
export interface RebuildResult {
  documentId: string;
  success: boolean;
  bodies: CadBody[];
  meshes: RenderMesh[];
  errors: RebuildError[];
  warnings: RebuildWarning[];
  durationMs: number;
}
```

### 14.3 RebuildError

```ts
export interface RebuildError {
  id: string;
  source: "parameter" | "sketch" | "feature" | "kernel" | "export";
  sourceId?: string;
  message: string;
  details?: unknown;
}
```

### 14.4 Worker Requirement

Geometry rebuilds must run in a Web Worker.

The UI thread should remain responsive while rebuilding.

---

## 15. Kernel Adapter

### 15.1 Do Not Leak Kernel Types

OpenCascade.js types should be isolated inside `cad/kernel/`.

Application code should call a stable internal interface:

```ts
export interface KernelAdapter {
  createBox(width: number, height: number, depth: number): KernelShape;
  extrudeProfile(profile: ResolvedProfile, distance: number): KernelShape;
  cut(base: KernelShape, tool: KernelShape): KernelShape;
  fuse(a: KernelShape, b: KernelShape): KernelShape;
  fillet?(shape: KernelShape, edgeRefs: TopologyRef[], radius: number): KernelShape;
  tessellate(shape: KernelShape, options: TessellationOptions): RenderMesh;
  exportStl(shape: KernelShape): ArrayBuffer;
  exportStep?(shape: KernelShape): ArrayBuffer;
}
```

### 15.2 KernelShape

```ts
export interface KernelShape {
  id: string;
  kernelHandle: unknown;
  metadata?: Record<string, unknown>;
}
```

Only kernel adapter implementations may inspect `kernelHandle`.

### 15.3 TessellationOptions

```ts
export interface TessellationOptions {
  linearDeflection: number;
  angularDeflection: number;
}
```

Default MVP values should prioritize interactive speed over perfect smoothness.

---

## 16. Viewer

### 16.1 Viewer Requirements

The 3D viewer must support:

- Orbit
- Pan
- Zoom
- Fit to view
- Perspective camera
- Optional orthographic camera later
- Grid on XY plane
- Origin axes
- Model shading
- Edge outlines if feasible
- Selection highlighting
- Hover highlighting if feasible

### 16.2 Viewer Interaction

Basic mouse controls:

```text
Left click: select
Middle mouse or right drag: orbit/pan depending convention
Scroll: zoom
Shift + drag: pan
F: fit selected or fit model
Esc: cancel active command
```

Exact mappings can be adjusted, but they must be documented in the app.

### 16.3 Selection Model

```ts
export interface SelectionState {
  selectedIds: SelectionRef[];
  hoveredId?: SelectionRef;
}

export interface SelectionRef {
  kind: "sketchEntity" | "feature" | "body" | "face" | "edge" | "vertex";
  id: string;
  documentId: string;
}
```

For MVP, selection may focus on sketches, features, and bodies. Face/edge selection can be transient.

---

## 17. User Interface Layout

### 17.1 Main Layout

```text
+-------------------------------------------------------------+
| Top Toolbar: New | Open | Save | Export | Undo | Redo       |
+----------------------+--------------------------------------+
| Left Panel            | 3D Viewer                            |
| - Sketches            |                                      |
| - Features timeline   |                                      |
| - Bodies              |                                      |
+----------------------+-----------------------------+--------+
| Bottom/Right Panel                                  Inspector |
| - Parameters                                             |
| - Selected object properties                             |
| - Rebuild errors                                         |
+-------------------------------------------------------------+
```

### 17.2 Required Panels

#### Parameter Panel

- List parameters.
- Add parameter.
- Rename parameter.
- Edit expression.
- Show resolved value.
- Show unit.
- Show validation errors.

#### Feature Timeline

- List features in order.
- Select feature.
- Rename feature.
- Suppress/unsuppress feature.
- Delete feature.
- Rebuild indicator.

#### Sketch Panel

- List sketches.
- Create sketch.
- Edit sketch.
- Show sketch entities.
- Show sketch constraints/dimensions.

#### Inspector Panel

- Shows properties for selected parameter, sketch entity, feature, or body.
- Allows editing relevant values.

#### Rebuild Errors Panel

- Shows errors and warnings.
- Clicking an error selects the source object if possible.

---

## 18. Commands

### 18.1 Command Registry

Implement a command registry rather than wiring every button directly to state.

```ts
export interface CadCommand {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  enabled: (state: CadAppState) => boolean;
  run: (ctx: CommandContext) => Promise<void> | void;
}
```

### 18.2 Required Commands

```text
file.newProject
file.openProject
file.saveProject
file.exportJson
file.exportStl
view.fit
view.resetCamera
parameter.add
parameter.rename
parameter.editExpression
sketch.createXY
sketch.addLine
sketch.addCenterRectangle
sketch.addCircle
feature.extrude
feature.suppress
feature.delete
history.undo
history.redo
```

### 18.3 Command Palette

Implement a simple command palette accessible with `Cmd/Ctrl+K`.

It should list available commands and allow filtering by text.

---

## 19. Undo/Redo

### 19.1 MVP Approach

Use immutable document snapshots for undo/redo.

```ts
export interface HistoryState {
  past: CadDocument[];
  present: CadDocument;
  future: CadDocument[];
}
```

Limit history depth to a reasonable number, such as 50 snapshots.

### 19.2 Later Optimization

Later versions can use command-based patches or structural sharing.

---

## 20. Persistence

### 20.1 Project File Format

Use a deterministic JSON format.

File extension:

```text
.pcaddoc
```

or, if a real name is chosen later:

```text
.<product>.json
```

### 20.2 Save Format Requirements

- Pretty-printed JSON.
- Include `schemaVersion`.
- Deterministic ordering where practical.
- No kernel object serialization.
- No mesh serialization required for MVP.

### 20.3 Import Validation

Loading a file must:

1. Parse JSON.
2. Validate schema version.
3. Validate required fields.
4. Run migrations if needed.
5. Rebuild geometry.
6. Show errors without crashing.

---

## 21. Exports

### 21.1 STL Export

MVP must support STL export for 3D printing.

The STL export should export the current visible/rebuilt body or all bodies if multiple bodies exist.

### 21.2 STEP Export

STEP export is desirable but optional for MVP. Implement if OpenCascade.js support is straightforward.

### 21.3 Export UI

Export controls:

- Export STL
- Export Project JSON
- Export STEP if available

If export fails, show a useful error.

---

## 22. MVP Example Workflow

The application must support this exact workflow before the MVP is considered complete:

### 22.1 Create a Mounting Plate

1. User creates new project.
2. User creates parameters:

```text
plate_width = 80mm
plate_height = 50mm
plate_thickness = 5mm
hole_diameter = 3.2mm
hole_offset_x = 10mm
hole_offset_y = 10mm
```

3. User creates XY sketch.
4. User adds centered rectangle using `plate_width` and `plate_height`.
5. User adds four circles as holes using `hole_diameter / 2`.
6. User extrudes the rectangle by `plate_thickness`.
7. User cuts holes through the plate.
8. User sees a 3D plate with four holes.
9. User changes `plate_width` from `80mm` to `100mm`.
10. Model rebuilds and the holes remain positioned relative to the edges or center according to the expressions.
11. User exports STL.
12. User saves project JSON.
13. User reloads project JSON and gets the same model.

---

## 23. Initial Built-In Templates

Implement one or more built-in templates to prove the parametric system.

### 23.1 Mounting Plate Template

Parameters:

```text
plate_width
plate_height
plate_thickness
corner_radius optional later
hole_diameter
hole_spacing_x
hole_spacing_y
```

### 23.2 Simple Spacer Template

Parameters:

```text
outer_diameter
inner_diameter
height
```

### 23.3 Motor Mount Template — Later

Useful later, but not required for MVP.

---

## 24. Error Handling

### 24.1 User-Facing Rule

Never show raw stack traces as normal UI. Stack traces may be logged to the console, but the UI must show understandable errors.

### 24.2 Error Categories

```text
Parameter error
Sketch error
Feature error
Kernel error
Export error
File error
```

### 24.3 Error Example

Bad:

```text
TypeError: Cannot read properties of undefined
```

Good:

```text
Extrude failed: Sketch “Base Plate” does not contain a closed profile.
```

---

## 25. Validation

### 25.1 Document Validation

Validate:

- Unique IDs
- Parameter names are unique
- Parameter names match allowed identifier pattern
- Features reference existing sketches/profiles
- Sketch entities reference existing points
- Expressions are valid
- Units are compatible

### 25.2 Parameter Name Pattern

```regex
^[a-zA-Z_][a-zA-Z0-9_]*$
```

---

## 26. Testing Requirements

### 26.1 Unit Tests

Required test coverage areas:

- Unit parsing
- Expression parsing
- Parameter dependency ordering
- Circular parameter detection
- Sketch entity creation
- Rectangle helper creation
- Circle helper creation
- Basic profile detection
- Feature graph rebuild ordering
- JSON save/load round trip
- STL export smoke test if practical

### 26.2 Integration Tests

At least one integration test should create the mounting plate example from code, rebuild it, and verify:

- Rebuild succeeds.
- One body is generated.
- Mesh has vertices/triangles.
- Changing `plate_width` causes a different mesh bounding box.

### 26.3 UI Tests

At minimum:

- App loads.
- Create project works.
- Add/edit parameter works.
- Template creates visible geometry.
- Export project JSON works.

---

## 27. Performance Requirements

### 27.1 MVP Targets

For simple parts:

- Parameter evaluation: under 20ms
- Sketch solve: under 50ms
- Rebuild simple plate: under 500ms after WASM is initialized
- Viewer interaction: responsive at 30+ FPS
- UI remains responsive during rebuilds

### 27.2 WASM Initialization

OpenCascade.js initialization may take noticeable time. Show a loading state.

```text
Loading CAD kernel…
```

Do not allow geometry commands until the kernel is ready.

---

## 28. Accessibility and Usability

### 28.1 Basic Accessibility

- Keyboard-accessible command palette.
- Visible focus states.
- Tooltips for toolbar buttons.
- Labels for form fields.
- Error text associated with invalid fields.

### 28.2 Usability Priorities

- Parameter table must be obvious.
- Rebuild errors must be obvious.
- The user should understand what changed after editing a parameter.
- Avoid modal-heavy workflows where possible.
- Prefer inline editing and inspector-based editing.

---

## 29. Development Milestones

### Milestone 0 — Project Skeleton

Deliver:

- Vite + React + TypeScript app.
- Basic layout.
- Three.js viewer with grid and orbit controls.
- Empty document model.
- Unit test setup.

Acceptance:

- App starts with `npm run dev`.
- Viewer renders a grid and axes.
- Tests run with `npm test`.

### Milestone 1 — Parameter System

Deliver:

- Parameter model.
- Parameter panel.
- Expression parser/evaluator.
- Unit support for mm/in at minimum.
- Dependency ordering and cycle detection.

Acceptance:

- User can add/edit parameters.
- Expressions can reference other parameters.
- Invalid expressions show errors.

### Milestone 2 — Kernel Proof

Deliver:

- OpenCascade.js initialized in worker.
- Kernel adapter abstraction.
- Generate simple box from dimensions.
- Tessellate and render box in Three.js.

Acceptance:

- User can click a command to create a parametric box.
- Changing width/height/depth rebuilds the rendered box.

### Milestone 3 — Sketch Model

Deliver:

- XY sketches.
- Points, lines, circles.
- Center rectangle helper.
- Simple sketch display overlay in viewer.
- Basic constraints/dimensions.

Acceptance:

- User can create a rectangle sketch driven by parameters.
- User can create circles driven by parameters.

### Milestone 4 — Extrude

Deliver:

- Profile detection for rectangle and circle.
- Extrude feature.
- Plate extrusion.
- Rectangle with circular holes if feasible.

Acceptance:

- User can create a mounting plate with holes.
- Editing parameters rebuilds the solid.

### Milestone 5 — Persistence and Export

Deliver:

- Save/load JSON project.
- Export STL.
- Import project JSON.

Acceptance:

- Mounting plate project can be saved, reloaded, rebuilt, and exported.

### Milestone 6 — Usability Pass

Deliver:

- Command palette.
- Rebuild errors panel.
- Inspector improvements.
- Undo/redo snapshots.
- Built-in mounting plate template.

Acceptance:

- A new user can create or load the template, edit parameters, rebuild, and export without touching raw JSON.

---

## 30. Non-Functional Requirements

### 30.1 Code Quality

- TypeScript strict mode enabled.
- No `any` unless justified near kernel boundaries.
- Kernel-specific code isolated.
- Deterministic document updates.
- Pure functions for parameter evaluation and validation where possible.
- Avoid large god-components.

### 30.2 Dependency Discipline

Keep dependencies minimal.

Expected dependencies:

```text
react
react-dom
vite
typescript
three
opencascade.js or equivalent package
zustand or small custom state store
vitest
```

Avoid adding large UI frameworks unless explicitly requested.

### 30.3 Browser Support

Target current versions of:

- Chrome
- Edge
- Firefox
- Safari, best effort

MVP may prioritize Chromium if OpenCascade.js/WASM support creates issues, but the architecture should not intentionally block other modern browsers.

---

## 31. Security Considerations

Even local-first apps need basic safety.

- Do not use `eval` for expressions.
- Validate imported project JSON.
- Avoid executing scripts embedded in project files.
- Treat project files as untrusted input.
- Avoid leaking local file contents.
- Avoid sending project data to any server in MVP.

---

## 32. Future Architecture Seams

### 32.1 Desktop Packaging

The web app should be packageable later with Tauri.

Do not depend on browser APIs that make desktop packaging impossible unless wrapped behind interfaces.

### 32.2 Backend Sync

Prepare a future backend seam:

```ts
export interface ProjectRepository {
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<CadDocument>;
  saveProject(doc: CadDocument): Promise<void>;
  exportProject(doc: CadDocument, format: ExportFormat): Promise<ArrayBuffer>;
}
```

MVP implementation:

```text
LocalProjectRepository
```

Future implementation:

```text
RemoteProjectRepository backed by Go API
```

### 32.3 AI-Assisted CAD Later

The parametric JSON model should eventually allow AI tools to create or modify designs safely.

Do not implement AI in the MVP, but keep the document model clean, explicit, and deterministic.

---

## 33. Suggested Initial Coding Order for Codex

Codex should implement in this order:

1. Project skeleton.
2. Viewer with grid and orbit controls.
3. CadDocument types.
4. Parameter system and tests.
5. Kernel adapter with simple box generation.
6. Worker rebuild protocol.
7. Render mesh conversion.
8. Built-in parametric box template.
9. Sketch model.
10. Rectangle and circle sketch helpers.
11. Profile detection.
12. Extrude feature.
13. Mounting plate template.
14. Save/load project JSON.
15. STL export.
16. UI polish and rebuild error reporting.

Do not start with advanced UI. Do not start with full sketch constraints. Do not start with assemblies. Those are traps wearing fake mustaches.

---

## 34. Definition of Done for MVP

The MVP is done when all of the following are true:

1. The app runs locally from a clean checkout.
2. The app creates a new CAD document.
3. The user can add and edit parameters.
4. The user can create or load a mounting plate template.
5. The model rebuilds when parameters change.
6. The 3D viewer updates after rebuild.
7. The user can save the project as JSON.
8. The user can reload the project JSON.
9. The user can export STL.
10. Rebuild errors are shown clearly in the UI.
11. Core parameter and rebuild logic has unit tests.
12. Kernel-specific code is isolated behind `KernelAdapter`.

---

## 35. Anti-Goals

These are explicitly not goals for the first implementation:

- Perfect CAD kernel abstraction.
- Professional-grade constraint solver.
- Full topological naming.
- Sketching every possible closed profile.
- Multi-body design beyond what naturally falls out of extrusion.
- Assembly constraints.
- Cloud collaboration.
- Photorealistic rendering.
- Mobile UI.
- Marketplace/plugins.
- Replacing Fusion 360 in v1.

---

## 36. Notes for Codex

When implementing, prefer small vertical slices over broad incomplete scaffolding.

A good first vertical slice is:

```text
Parameter width/height/depth
  -> rebuild box in worker
  -> tessellate
  -> render in viewer
  -> edit parameter
  -> rebuild updated box
```

Only after that works should the app move toward sketches and extrusions.

The project will succeed if the core document model, parameter system, rebuild pipeline, and viewer are boringly reliable.

The project will fail if it tries to become a complete CAD system before the first parametric plate works.

