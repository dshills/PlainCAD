# PlainCAD

PlainCAD is a browser-first, local-first parametric CAD MVP for simple mechanical parts. It keeps the durable source of truth in a serializable project document, rebuilds runtime geometry through a worker-backed CAD kernel boundary, previews meshes with Three.js, and exports project JSON plus STL.

The MVP is intentionally narrow: make parameters, sketches, rebuilds, inspection, save/load, and STL export reliable before adding broad CAD features.

## Features

- Single active part document.
- Named parameters with units and expressions.
- XY/XZ/YZ sketches with points, lines, arcs, circles, construction geometry, and driving dimensions.
- Closed line/arc/circle profiles with holes and stable entity-based identities.
- Bounded straight-line region partitioning at T-junctions and divider crossings;
  source entities remain intact and topology changes require explicit profile repair.
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

Vite uses `http://localhost:5278/`. Open that URL in a browser.

If port `5278` is already in use, Vite reports an error. Start on another port:

```sh
npm run dev -- --host 127.0.0.1 --port 5279
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

Runs TypeScript checks, unit/component tests, the production build, and Chromium
browser acceptance tests. Install the test browser once with
`npx playwright install chromium`. Use this before commits or release handoff.

```sh
npx playwright install chromium
npm run test:browser
```

Runs Playwright against a dedicated Vite server on `127.0.0.1:5279`; leave that
port free. Your normal development server remains on port 5278. Tests start from
an empty document and use the UI to create a rectangle, extrude it, cut a circular
through-hole, edit thickness, save/reopen the project, and download STL on XY,
XZ, and YZ planes. They require real OpenCascade extrusion/boolean meshes and
check signed volume, outward STL normals, world coordinates, Z-up camera/grid,
and rendered mesh/sketch alignment. A controlled-delivery test holds a real
worker response to verify newer edits, request IDs, and epochs reject stale results;
it also verifies a failed old worker reinitializes before rebuilding the latest edit.

Browser screenshots and downloaded project/STL files are written to ignored
`test-results/`; failures also retain Playwright traces. Run
`npx playwright show-trace <trace.zip>` to inspect a failure. CI installs Chromium
with OS dependencies and runs the same release gate. These tests cover the stated
rectangle/through-hole workflow, not general CAD completeness or other browsers.

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

Inspector fields show an uncommitted-change indicator and accessible commit/cancel
guidance while their value differs from the document. Drafts do not rebuild or
autosave; undo and other external value changes replace them without a blur overwrite.

Examples of parameter expressions:

```text
100mm
plate_width - 20mm
hole_diameter / 2
```

The app reports expression, unit, sketch, feature, import, and export errors in user-facing language.

Schema 10 saves authoring defaults, display units and parameter groups. Open **Unit
defaults** in Parameters to choose length/angle defaults for new or edited bare-number
expressions. Each expression captures its units: changing defaults does not resize
existing geometry, and parameter renames preserve them. Explicit units override the
default; scalar multipliers remain scalar and dimensional ratios remain dimensionless.
Choose **Scalar (no units)** in a parameter's inspector for counts/ratios. Mixed sums
such as `width + 10` still need `width + 10mm`. Older expressions retain their strict
explicit-unit behavior until edited. Computed readouts use the current evaluated
quantities; unavailable or pending results never display the persisted value cache.
Display units affect readouts and measurements, and are saved undoable preferences.
The parameter inspector also edits descriptions and groups (up to 80 characters).


Schema 8 persists parameter token bindings by stable ID. Renaming a parameter
updates dependent display expressions while preserving design intent, including
sketch coordinates, dimensions, plane offsets, and feature sizes. Unit literals
and function names are unchanged. Older files bind their existing symbols during
migration/import. Missing ID bindings remain editable and saveable but block
rebuild until their expressions are repaired; reused names cannot retarget them.

### Work With Sketches

1. Create an XY, XZ, or YZ sketch and select it in the Browser.
2. Use Edit Sketch Canvas to draw points, connected lines, rectangles, circles and
   center/start/end arcs in a plane-local view. The canvas previews unfinished
   gestures, snaps to existing solved points and an optional millimeter grid, and
   saves complete primitives as undoable edits. Escape cancels a draft before closing.
   Zoom, pan, Fit, keyboard coordinate entry and construction geometry controls are available.
   Drawing dimensions show solved lengths/radii in display units. Add a driving
   length, radius/diameter, point distance or line angle in the canvas dimension
   controls; click a D label to edit its expression. Pending or failed solves show
   unavailable values. Adding a canvas dimension explicitly enables driving mode
   for legacy sketches. Undo/redo and save/open preserve dimension IDs and intent.
   Choose the move tool to drag free numeric points, or move a selected point with
   exact coordinate entry. The preview stays transient until release; Escape,
   pointer cancellation and project edits discard it. Moves preserve shared IDs.
   Parameter-bound, constrained, driving distance/angle and arc points require
   expression or constraint edits; a clear diagnostic explains the restriction.
   Moves onto another point are rejected; movement never merges point IDs.
   Choose translate to move a connected group of lines, circles, arcs and related
   construction geometry rigidly, retaining dimensions, constraints and profile IDs.
   Pointer and exact-coordinate moves preview the whole group and commit once.
   Groups are limited to 80 points; fixed geometry or parameter-bound coordinates
   block translation. Parameter-driven lengths and radii remain supported. Solver
   deformation, new point collisions and changes to valid profile topology reject
   the move with a diagnostic. General constraint-driven deformation is unavailable.
   The **deform** tool changes linked X/Y coordinates in point-and-line sketches
   with horizontal, vertical, coincident and fixed constraints. Orthogonal point
   distances and lengths on horizontal/vertical-constrained lines retain their
   dimensions. Fixed and parameter-bound axes block incompatible moves. Drag a
   point or use Deform sketch to coordinate; release validates the solve and
   profile topology before one undoable edit. Escape cancels. This is bounded to
   80 points and rejects curves, nonlinear constraints, general distance/angle
   dimensions, new coincidences, reversed edges and topology changes. Use existing
   geometry/dimension controls for those cases.
   C markers show the current constraint status and locate referenced geometry.
   Select a marker or constraint list entry to inspect, repair ordered references,
   or remove intent through undoable edits. Lost references stay in the list;
   pending solves hide markers. Create new constraints in Sketch tools.
   Dimension and constraint labels use automatic bounded placement to avoid one
   another and point handles. Leaders follow their original geometry and allow
   drawing gestures to pass through. Layout stays transient during zoom/pan and
   does not edit the document. Each family shows at most 128 labels; all intent
   remains in its selection/list controls. Crowded views report when placement
   cannot separate labels. Dimension and constraint labels can be dragged or moved
   with arrow keys (Shift for larger steps). Home or the respective Reset label
   placement button restores automatic layout. Enable Position reference labels
   to move reference measurements; they otherwise allow drawing clicks through.
   Escape cancels a drag. Placement lasts only in the open canvas and does not
   alter geometry or project JSON. Hide references or zoom in when crowded;
   guaranteed collision-free placement remains unavailable.
   Use the rectangle/circle helpers or Sketch tools to add points, lines, circles,
   and center/start/end arcs. Construction curves appear dashed and are excluded
   from solid profiles.
   Straight dividers through circles and mixed arc/line profiles create selectable
   curved regions. End a divider on a boundary or connect it into a closed line
   network. Open tails, interior tangent contacts and authored self-intersections
   report diagnostics; ordinary shared arc-endpoint joins remain supported.
   Fragments keep analytic kernel arcs and authored entity IDs. Radius and winding
   edits retain region IDs while topology is unchanged; removing a divider requires
   explicit feature-profile repair. Crossing circles produce crescent and lens
   regions with analytic boundaries; tangencies and duplicate circles remain
   diagnostic. Circle/arc crossings also form selectable analytic regions; contacts
   outside the authored arc sweep are ignored. Partial arc dividers may end on a
   circle boundary. Arc/arc crossings also create selectable regions in closed
   networks, including arc-only loops. Coincident sweeps, interior tangencies and
   authored self-crossings require sketch repair; ordinary shared endpoints retain
   their legacy profile IDs.
3. Add constraints and driving dimensions in Sketch tools; dimension expressions
   can reference parameters. Coordinate expressions supply initial geometry;
   fixed constraints lock coordinates when that is the intended design intent.
4. Inspect solve status, remaining degrees of freedom, and source-linked errors.
   Conflicts, redundant intent, degeneracy, and non-convergence block modeling.
   Reset sketch solve restores the authored seed instead of the previous solution.
5. Choose an origin plane, a supported upstream extrusion cap/straight side face,
   or an expression-driven offset of either. If a reference is lost, explicitly
   select a replacement plane and apply it; geometry and IDs are preserved.

Schema 7 introduces driving solves for new sketches. Older projects retain their
validation-only dimensions until you choose Enable driving dimensions. The solver
uses a local Jacobian-rank DOF heuristic and bounded iteration/time budgets; it
is intended for small sketches. See the capability matrix for precise limits.

### Autosave and Fabrication

Edited projects autosave to IndexedDB after a 500ms idle period. Recovery keeps up
to five projects, with the latest snapshot, previous snapshot, and last downloaded
save for each. On startup, explicitly recover unsaved work or start without it.
Corrupt latest snapshots can be replaced by the previous snapshot. Storage/quota
failures preserve the in-memory project and offer manual download or clearing old
recovery data. Browser termination can still lose edits made before the last completed
IndexedDB transaction; autosave does not replace manual project files.

STL defaults to separate files in a ZIP for multiple bodies. Choose one STL with
separate shells or a best-effort native union in the export dialog. All modes keep
global coordinates in millimeters. Connected unions remove overlap; disjoint unions
remain separate solids and report that fact. Warnings require an explicit download
choice for combined modes. Changes after validation invalidate a pending download.
Choose explicit bodies in the export dialog, or select a body in Browser and use
`Export selected body`. Native union uses only those selected bodies. Visibility
is independent: `Select visible bodies` explicitly copies visible bodies into
the export selection. Empty or lost selections block export.

Export runs in a cancellable worker with a 60-second limit. It checks finite float32
coordinates, indices, degeneracy, welded edge/vertex manifoldness, winding, shell
volume and native-volume agreement. A 1e-7mm seam weld closes duplicated native face
vertices. Bounded non-adjacent triangle checks detect intersections and body
containment/contact. Expensive checks can be skipped for separate/shell modes, with
a diagnostic; union requires full checks. These numerical checks are not a proof
of absence of every near-degenerate or adjacent-face intersection.

Imports check raw UTF-8 bytes before parsing, preflight nesting before the reviver,
then migrate and validate in a cancellable worker. Checked-in schema 1–11 fixtures
verify IDs, rebuilds, edits, save/open, and recovery. The production Chromium suite
also imports every released fixture under CSP, verifies native BRep volume/solid count,
edits thickness, saves/reopens with stable IDs, and checks STL volume and global bounds.
These fixtures cover a rectangular body with a through-hole, not every historical
modeling workload. Default limits: 5 MiB JSON,
depth 64, 500 parameters, 100 sketches, 750 entities/512 constraints and dimensions
per sketch, 10,000 total entities, 20,000 total constraints/dimensions, 1,000 features,
100 feature dependency steps, 64 bodies, 100,000 triangles/300,000 vertices per body,
250,000 total triangles, and 2,000,000 intersection tests per export. Resource errors
fail clearly; native triangle budgets are checked before tessellation buffers grow.
Each hole feature is limited to 64 explicit centers.

### Work With Features

1. Select a sketch with a detected profile.
2. Click `Extrude` in the Feature Timeline.
3. Select a feature to inspect or rename it.
4. Use `Suppress` or `Delete` on selected features.

Use `Move earlier` / `Move later` on a selected sketch or feature to reorder it
across independent timeline items. The same checks apply in the command palette.
Moves preserve IDs and creation timestamps and reject dependency violations for
sketches, body owners, face planes, termination faces, and edge owners. Modifiers
on the same body keep their existing order. Disabled moves show the reason;
accepted edits rebuild normally and support undo/redo and save/open.

The Inspector offers explicit source sketch, profile and upstream target-body
replacement for extrusion/revolve features, and source/target repair for holes.
Broken references remain saved and structurally valid damaged projects can open
or recover for repair. Profiles wait for current worker analysis; target choices
come from durable upstream body owners. Nothing is rebound automatically.

The Inspector supports positive, negative and symmetric distance extrudes, cuts
and joins with explicit saved body scopes,
through-all, and termination on an upstream finite planar face. To-face termination
supports sloped planes and verifies that the entire end cap fits inside the selected
face, including its holes. To-face remains positive-only. Through-all supports
all three directions; symmetric distance is the total span split equally across
the sketch plane.

Extrude and revolve cuts can target up to 64 upstream bodies. Use **Cut target
scope** checkboxes to include or remove bodies; the **Target body** selector replaces
the scope with one body. The saved stable-ID set never includes new bodies silently.
Every selected body must lose volume. If any target is lost, disjoint, empty, invalid,
or exceeds resource limits, the entire cut fails and retains upstream previews.
Lost scope entries can be unchecked for explicit repair. Through-all extrude tools
cover the furthest selected target along the chosen direction.

Use **Join target scope** to merge up to 64 selected bodies with an extrude or
revolve tool. The final union must be one connected solid and the tool must add
volume beyond the union of targets. The first selected target retains its stable
ID and name; the other selected bodies are absorbed only when the whole operation
succeeds. Saved order chooses that surviving identity, while intermediate unions
may be disconnected before the tool bridges them. Downstream references to
absorbed bodies require explicit repair to the surviving body. Suppressing the
join restores the original bodies.

Hole features accept up to 64 explicit targets and 64 centers. Use **Hole target
scope** in the creation dialog or Inspector. Each center must remove volume from
at least one selected body, and every selected body must lose volume. Different
centers can drill separate bodies; overlapping tools are combined before cutting.
Any missing reference, unused center, no-op target, invalid geometry, tessellation
failure or resource failure retains all upstream bodies and blocks STL export.
Through-all reaches the furthest selected body along the positive sketch normal;
blind depth is measured from the sketch plane. Schema 11 stores the target array
and migrates older single-target holes without changing their target IDs.

Use **Capture intersected targets** on a cut, join, or hole to save the current
native body/tool intersections as explicit target IDs. Capture probes only the
feature's upstream history and never changes the scope during later rebuilds.
Use it when first choosing the operation or explicitly retargeting a feature.
It preserves a join's current primary ID if that body still intersects. Bodies
added upstream later remain excluded until selected or explicitly recaptured.
Capture uses positive common solid volume; face-only joins require manual target
selection. Document edits or replacement cancel in-flight probes, and an empty,
failed or stale probe retains the previous scope. The operation's usual modeling
validation still applies after capture.

Use `Revolve` for a closed profile around a coplanar origin axis or a stable line
in its sketch. The Inspector edits the axis, 0–360 degree angle (exclusive of 0),
and new-body/cut/join operation. Profiles crossing the axis fail with a diagnostic.

Select a supported positive, negative, or symmetric distance extrusion and use
`Fillet` or `Chamfer`. The Inspector
edits size expressions and selects an entire cap perimeter, a cap edge derived from
a line/arc, or the two side corners at a source line's endpoints. Native operations
validate BRep geometry, solid count, and exact volume/surface-area changes. Invalid sizes,
no-op cuts/joins, disconnected joins, and lost references fail rebuild and block STL
export; suppress or repair the feature to recover. Failed modifiers block subsequent
operations on the same body while retaining upstream previews.

Feature-owned face references require an unmodified positive, negative, or symmetric distance new-body
extrusion. Caps follow the shifted start/end of the sweep with outward normals;
straight-side planes share that shifted origin. Cap/side references are explicit roles, with reselection for repair;
arbitrary post-boolean face/edge naming remains unsupported. Hole features use
transformed cylindrical tools. Select a sketch or point and use `Hole` to choose
explicit centers and one native target body. The modal validates positive length
expressions before creating a feature. Its Inspector edits diameter, blind-depth/
through-all termination, centers, source sketch and target body. Holes cut along
the sketch's positive normal. Empty/lost centers and unchanged cuts fail rebuild.

The **Dependencies** panel traces the selected parameter, sketch/entity, feature or
body. **Inputs** and **Affected outputs** show direct and transitive authored
references with shortest-path distances. Each entry describes one link along that
path; click an existing item to inspect it.
Body selection traces its latest unsuppressed writer. Target chains include
preceding modifiers, and suppressed/downstream owners have explicit labels.
Missing references remain visible with disabled navigation. Cycles returning to
the selection are diagnosed without recursive traversal. Lists show 50 items at a
time; **Show more** expands them. This is structural inspection; the Rebuild panel
reports whether the geometry and references are valid.

See `specs/working-cad/CAPABILITY_MATRIX.md` for current capability limits. Schema
support alone does not imply a working modeling operation.

### Navigate the Viewer

- Orbit: drag in the viewer.
- Pan: right-drag or middle-drag.
- Zoom: scroll over the viewer.
- Fit: press `F` or click `Fit` to frame visible bodies.
- Reset camera: click `Reset`.
- Views panel: Top (+Y screen-up), Front (looking +Y), Right (looking -X),
  and Isometric. Fit preserves the current view direction.
- Save named camera views with a name; restore or delete them after save/open.
  Named camera poses are durable and undoable, with at most 20 per project.
- Section preview: choose global X/Y/Z, an offset in millimeters, and the retained
  side. Clipping affects bodies, sketch overlays, measurement lines, and picking;
  it has no caps and does not change geometry, measurements, or STL export.
  New/open projects clear clipping.
- Clear selection: press `Escape`.
- Browser lists actual rebuilt bodies with visibility checkboxes and `Show all bodies`.
  Hidden bodies cannot be picked. Visibility persists during edits and undo/redo
  in the current project session, and resets on new/open/recovery. These runtime
  preferences are not saved in project JSON.

The Measure panel reads the current worker's solved sketch geometry. Choose two
sketch points (including points on different planes) for world-space distance and
X/Y/Z delta, or a line, circle, or arc for analytic length, radius and diameter.
Choose mm/cm/m/in/ft without changing the model. A magenta world-space line shows
the point pair. Pending or failed rebuilds hide measurements and overlays;
removed references remain explicit until reselected. Measurements are transient
and refer to authored sketch entities; arbitrary BRep edge/face measurements are
not available.

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
npm run dev -- --host 127.0.0.1 --port 5279
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
- `specs/working-cad/SPEC.md`: next-stage specification for a working parametric CAD system.

Production build headers, CSP, cache/MIME requirements, and the built-app browser
check are documented in [deployment/README.md](deployment/README.md).


The Inspector exposes line/arc endpoints and circle/arc centers. Inspect a linked
point to edit its coordinates, or choose another point in the same sketch to repair
the reference. Arc direction is editable with undo/redo. Well-typed lost point
references survive project open for explicit repair; malformed IDs remain rejected.
Invalid references or inconsistent arc geometry block rebuilding and STL export.


The Chromium suite includes a six-operation native chain: extrusion, cap fillet,
cap chamfer, through-hole, through-pocket, and connected boss join. It checks exact
BRep volume after every operation and depth/radius edits, stable body identity and
bounds, undo/redo, blocked downstream operations after a middle-feature failure,
suppression/repair, save/open, and STL volume/winding. This is one bounded XY part;
it does not establish arbitrary topology naming or every complex model workload.


The release gate records controlled native performance reports for both Vite
development and the production build under CSP. The shared rectangle/through-cut
workload verifies current geometry across twenty measured edits and ten STL
exports. Production reports UI edit/export timings; detailed phase and resource
counters remain development-only. See [measurement scope and commands](specs/working-cad/PERFORMANCE.md).
