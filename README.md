# PlainCAD

Menus, tools and dialogs route through one discoverable command registry. Use
`window.plaincadCommands` or `npm run cad` to drive the same guarded actions from
scripts and agents. See [shared commands and CLI examples](docs/COMMANDS.md).

Browser-first, local-first parametric CAD for mechanical parts. Draw sketches,
create native solids, edit dimensions, and save an editable project or export STL.
Optional AI assistance supports Anthropic, OpenAI, and Google.

PlainCAD uses React 19, TypeScript, Vite, Zustand, Three.js, and OpenCascade.js.
CAD runs locally in the browser through a geometry worker. An optional local Node
gateway handles AI requests and keeps provider credentials out of the browser.

![ORBIT drive housing in PlainCAD's Saturn Command workbench, showing its recessed chamber, bearing bore, mounting counterbores, relief slots, and feature timeline](docs/images/orbit-drive-housing.png)

**ORBIT drive housing** — a real OpenCascade model with 16 features, 14 sketches,
and six editable parameters, shown in Saturn Command. The part includes a rounded
flange, fillet/chamfer treatments, a recessed chamber, bearing bore, counterbored
mounting and cover holes, and relief slots. [Open the editable example](docs/examples/orbit-drive-housing.pcaddoc)
with **File → Open**, or drop the project file onto the workspace.

Explore the [ten-project example gallery](docs/examples/README.md), from a two-part
cable guide to a 40-part rotary fixture, with editable files, native PNG previews,
[geometry validation](docs/examples/VALIDATION.json), and a
[workflow usability audit](docs/examples/WORKFLOW_AUDIT.md).

Successful builds show underconstrained-sketch freedom as optional guidance in
Issues. Kernel, profile, parameter, and worker problems remain prominent.
Parameters show their full names with a deliberate Rename action. While a rebuild
is pending, a previous value is explicitly labeled stale; invalid values show
Unavailable and cannot authorize export.

Parts use their component name in the browser, inspector, selected-part PNG, and
separate-part STL filenames. Multiple bodies in one component include their body name; duplicate
and unsafe filename collisions receive stable suffixes. Root-component projects
retain their existing part labels. Exit isolation restores component/part visibility
without revealing hidden source sketches.

The Parts browser uses compact rows with separate expand, activate and visibility
controls. Each part's menu offers isolation and rename; empty root folders stay
out of the way. Search includes matching descendants.

The main Rectangle command opens the drawing tool with explicit Corner or Center
creation modes and optional typed width/height in the sketch properties panel,
leaving the canvas clear for mouse drawing. Driving dimensions stay visible
and editable by default; reference measurements appear for selected geometry or when Show
reference measurements is enabled. Finish Sketch returns the header to Solid tools. Existing fixed rectangle presets
remain in advanced commands. Newly drawn Center rectangles retain their chosen center
when width or height changes, using saved construction geometry and constraints.
A parameter-bound snapped center remains associative. Older saved rectangles keep
their existing constraints; free Corner rectangles retain their positional freedom.

## Features

- One local project file containing components, sketches, parameters, and a feature timeline.
- Mouse drawing, box/Shift selection, whole-shape deletion, and dimensions shown by default.
- Points, lines, circles, arcs, construction geometry, supported constraints, and driving dimensions.
- XY/XZ/YZ, offset, and supported feature-owned face sketch planes.
- Native Extrude, Revolve, Cut/Join, Hole, Fillet, and Chamfer with preview, Apply, and Cancel.
- Sketch Trim/Extend, Mirror, linear patterns, and bounded outline Offset.
- Linked projection of complete supported cap boundaries into parallel sketches.
- Associative linear/circular patterns of single-center Holes and distance Cut Extrudes.
- Guided face holes and pockets, extrusion distance handles, and supported operation drag-and-drop.
- Unit-aware parameter expressions, stable bindings, undo/redo, timeline ordering, and explicit reference repair.
- Docked Workbench, Minimal and Full layouts, and Light, Dark, and Saturn Command themes.
- Body visibility, named camera views, section previews, sketch measurements, and linked diagnostics.
- Click-to-measure supported model edges, endpoints and planar faces, with analytic values.
- Editable `.pcaddoc`/JSON files, autosave/recovery, validated STL, and native STEP export.
- Reusable-part insertion with independent parameters and safe reference remapping.
- PNG downloads of the current 3D view, an isolated selected body, or a sketch with its visible dimensions.
- AI part creation, bounded existing-part edits/additions, and conversational sketch refinement.

Supported geometry is bounded. The [capability matrix](specs/working-cad/CAPABILITY_MATRIX.md)
records working behavior and limits; the [roadmap](specs/working-cad/PLAN.md) records
planned work. Unsupported or invalid operations produce diagnostics. Native
booleans and edge treatments must change actual geometry before they succeed.

## Quick Start

Requirements: Node.js `^20.19.0` or `>=22.12.0`, npm, and a modern desktop browser
with WebAssembly and WebGL support.

```sh
git clone https://github.com/dshills/PlainCAD.git
cd PlainCAD
npm ci
npm run dev
```

Open <http://localhost:5278>. Vite uses a strict port and reports a collision
instead of silently choosing another port. To override it:

```sh
npm run dev -- --host 127.0.0.1 --port 5288
```

Keep port 5279 free for the development browser tests.

To build and serve the production app locally:

```sh
npm run build
npm run preview
```

Preview uses strict port 5280. Static deployment, CSP, worker, and WebAssembly
hosting requirements are documented in [deployment/README.md](deployment/README.md).

## Canvas shortcuts

Select a native part for contextual Edit base feature, Hide, Isolate and Draw on
face controls. Right-click or focus the canvas and press Shift+F10 for a menu;
double-click an eligible Extrude/Revolve part to edit its base feature. Deleting
the base feature asks for confirmation, keeps its sketch, and supports Undo.
Selected sketch geometry has Offset, Mirror, Pattern and Delete shortcuts.
See [canvas action scope](specs/working-cad/CANVAS_ACTIONS.md).

Offset, Mirror/Pattern, Trim/Extend and projection preview automatically after a short pause. Apply stays disabled for unfinished, invalid or stale inputs; Preview remains available for explicit retries. Less common settings are under Details. These previews are local native CAD operations and make no AI provider calls. See [local task previews](specs/working-cad/LOCAL_TASK_PREVIEWS.md).

Move component guides two picks: source, then destination. Destination, Gap and Flip update its native preview; exact numeric poses remain under Details. Supported geometry markers and named lists remain available. Placement only saves one static pose in one Undo step. Keep connected creates rigid, hinge or slider joints from two supported flat faces; Assembly motion previews motion and highlights native collisions before Apply. See [guided alignment](specs/working-cad/GUIDED_COMPONENT_ALIGNMENT.md).

Linked curves have dashed styling and badges. Source provenance, Show/Edit source, Repair link and Make independent explain where geometry comes from. Showing a source preserves the destination component/sketch; opening its drawing protects unfinished mouse input. See [linked sketch controls](specs/working-cad/LINKED_SKETCH_USABILITY.md).

## Project → Component → Sketch

A **project** is one local CAD file. A **component** organizes a part's sketches,
bodies, and features. A **sketch** contains editable geometry and design intent on
a plane. Parameters and timeline ordering belong to the whole project.

Components have optional saved rigid placement. Activate a component, then choose
**Parts → component actions → Move component** or the command palette. Drag an axis
or rotation handle, or enter exact position in mm and rotation in degrees. Apply
requires a current native preview and saves one undo step. Rotation uses the design
origin in X, then Y, then Z order. Sketch and feature geometry remain in authored
design coordinates; the finished component, measurements and exports use its
placement. Nested project hierarchies and linked external designs remain planned. Schema-18 joints connect local components.

**New part → Insert a reusable part** copies all components or a selected component
from a local project into the open project at its original coordinates. Imported
parameters are independent; conflicting names receive suffixes. Single-component
insertion rejects dependencies outside that component. The task checks portable
file/resource limits and creates one Undo step. It preserves the open project's
identity and saved views; overlapping parts stay separate solids. See
[insertion limits](specs/working-cad/REUSABLE_PARTS.md).

In a sketch, **Project edges** previews a complete surviving authored extrusion
cap boundary on a parallel plane. Linked geometry follows upstream dimensions;
repair, break-link and remove controls make ownership explicit. New boolean
boundaries, fragmented profiles and oblique projections remain unavailable.
See [projection limits](specs/working-cad/SKETCH_PROJECTION.md).

Select a single-center Hole or distance Cut Extrude in History and choose
**Pattern** to repeat it with editable count (2–32 including the original), linear
spacing or circular sweep/center. Each additional instance must remove native
material; overlapping or off-part instances diagnose before Apply. Source size,
profile and depth stay linked. See [pattern limits](specs/working-cad/FEATURE_PATTERNS.md).

Open **Measure → Pick in model** to click supported native authored edges,
endpoints or planar faces. Values are analytic; pair measurements support point
distance, straight-edge angles and planar-face angle/separation. A keyboard target
list and advanced sketch selectors remain available. Pending edits invalidate
old picks. See [measurement limits](specs/working-cad/CLICK_MEASURE.md).

### Make your first part

1. Open **New part** above the canvas, enter **Part name**, and choose **Draw a shape**.
2. Confirm a plane. PlainCAD creates the component and its first sketch together.
3. Choose **Rectangle**, **Circle**, or another drawing tool. Click or drag to draw;
   enter precise sizes or edit the drawing's dimension labels.
4. Choose **Finish Sketch**. A single closed region on an origin/offset plane
   opens thickness preview directly. With several regions, select one and choose
   **Make solid**; face sketches keep the Add/Remove material choice explicit.
5. Inspect the Extrude preview, choose thickness and direction, then **Apply extrusion**.
6. Add holes or a pocket on a supported face, or create another sketch and cut/join it.
7. Edit a driving dimension or parameter, inspect the rebuilt geometry, then use
   **File → Save or export…** to download an editable project or printable STL.

The startup question card no longer covers the canvas. **New part** keeps drawing,
AI description, editable examples and opening a project in a collapsed menu.
For another part, use **New part**, or choose **New Component**, activate it, and **Create Sketch**.
Selecting a sketch, body, or timeline feature activates its owner. Double-click a
sketch to edit it. **Mount Plate** and **Box** provide editable examples.

Feature tasks publish edits only after Apply. Cancel discards the preview; Apply
creates an undoable edit. New settings, project replacement, or a stale native
result invalidate Apply. Finish or cancel an active task before starting another.

### Workspace and themes

Open **File → Project gallery** to browse ten editable examples with real model
images, part/feature counts and complexity labels. Enable live previews, then hover or focus a card to
inspect a bounded native rotation; reduced-motion settings keep it still. Recently
saved projects are the last five local manual-save copies in browser recovery
storage, with native cover images where available. Opening a card uses the same
unsaved-project protection as dropping a project file. The gallery stays out of
the modeling canvas until you open it.

The default **Docked Workbench** places Project/Parameters on the left,
Task/Properties on the right, and History/AI/Issues in a shared resizable bottom dock. AI input and responses stay in that dock; proposed geometry appears in the main canvas. **Draw**, **Solid**,
and **Inspect** change the context toolbar. **Project** and **Details** reopen docks;
drag their boundaries or use focused arrow-key controls to resize them.

**Settings → Workspace** also offers Minimal and Full layouts. Minimal keeps
Parts/History/Details behind disclosures; Full exposes the complete ribbon and
panels. Open the command palette with `Cmd/Ctrl+K` to find commands and see why
an unavailable action is disabled.

Choose Light, Dark, or Saturn Command with **Theme**. Saturn Command uses dark
instrument panels, cyan readouts, monospaced labels, restrained machining details
and illuminated active controls. Its live rebuild readout distinguishes valid,
rebuilding and failed geometry; themes keep the same control positions.
Layout, theme, visibility, and isolation are browser/session preferences rather
than CAD geometry. Named camera poses are saved explicitly in the project.

Hover or focus a modeling step in **History** to see its real before/after build
story with changed parts, solid counts and exact material-volume changes. These
isolated previews use current parameters at that timeline step and leave the
project and camera unchanged. Escape dismisses the preview; edits cancel stale
results. See [Build stories](specs/working-cad/TIMELINE_BUILD_STORY.md) for preview limits.

Dock and selection feedback uses short transitions, disabled by the system's
reduced-motion preference. “Model updated” appears briefly only after changed,
validated native geometry reaches the model, including undo/redo; failed rebuilds
and draft previews never show it.

Save/export keeps its completion buttons visible while options scroll. For STL,
**Output files → One file per part** produces separate STL files (a ZIP for multiple
parts). Advanced checks explain whether they validate individual parts or overlaps
in a combined file; separate-file checks do not certify assembled fit.

### Draw and dimension

Use points, lines, rectangles, circles, arcs, and construction geometry in the
plane-local canvas. Dimensions are on by default. Sized rectangles/circles create
driving dimensions; click an existing D label to edit its expression. Constraints
and diagnostics remain available through sketch controls.

Shift-click toggles selection. Box-select left-to-right for containment or
right-to-left for crossings. Delete/Backspace or the visible delete control removes
selected geometry and dependent intent in one Undo edit. Unused endpoints/centers
are cleaned up; shared points and surviving references remain.

Space-drag or middle-drag pans the sketch. Geometry snaps offer points, midpoints,
centers, alignment, and bounded intersection/tangent suggestions. Alt temporarily
bypasses snapping. Snaps do not automatically create constraints. Move, Translate,
and Deform provide supported edits with preview and cancellation.

**Trim** supports finite line/arc/circle intersections; trimming a circle produces
an arc. **Extend** supports lines and arcs; circles have no endpoints to extend.
Ambiguous overlaps and edits that would break protected intent are diagnosed.
**Mirror** copies selected geometry around a line/construction-line axis.
**Pattern** makes 2–16 total instances with a direction and spacing expression.
Copies preserve supported internal constraints, dimensions, and parameter bindings,
but are independently editable rather than associative pattern features.

**Offset** supports analytic circles, simple concave or convex straight-line
outlines, and mixed line/arc outlines with tangent joins involving arcs. Circle
copies can retain supported expressions; other copies capture literal distances
and solved geometry, with exact analytic arcs and mitered line corners. Open,
fragmented, self-intersecting or collapsed outlines and nonsmooth arc joins produce
diagnostics. Existing openings require explicit **Outer boundary only**. Copies
are ordinary editable sketch geometry; see [offset limits](specs/working-cad/SKETCH_OUTLINE_OFFSET.md).

### Edit parameters

Open **Parameters**, edit a name or expression, and press Enter or leave the
input to commit; Escape cancels the draft. With `width` defined, expressions can
reuse it:

```text
100mm
width - 20mm
width / 2
```

**Unit defaults** sets length/angle units for new or edited bare numbers. Each
expression retains its authored units, so changing defaults does not resize
existing geometry. Explicit units override defaults; mixed sums need compatible
units, such as `width + 10mm`. Scalar parameters support counts and ratios.
Parameter renames retain stable bindings; missing bindings require explicit repair.

### Navigate and inspect

Drag to orbit, right-drag or middle-drag to pan, and scroll to zoom in the 3D
viewer. Press **F** or choose **Fit** to frame visible bodies. The **Views** panel
offers Top, Front, Right, and Isometric views, plus saved named camera poses.
Body/component visibility and isolation change the view, not the export scope.

Use **Measure** for distances between solved sketch points or analytic line/arc/
circle measurements; choose display units without resizing geometry. Measurements
use authored sketch entities rather than arbitrary BRep surface picks. A section
preview clips along global X/Y/Z with an offset and retained side; it is an uncapped
visual view and leaves saved geometry and STL complete. Pending or failed rebuilds
hide stale measurements.

### Model and edit solids

| Operation | Supported workflow and main limits |
| --- | --- |
| Extrude | Closed line/arc/circle regions with holes; positive/negative/symmetric distance, New Body/Cut/Join, and through-all. Symmetric distance is the total span. |
| To Face | Positive extrusion to an upstream unmodified feature-owned planar cap/straight side; the full end section must fit the finite face, including openings. |
| Revolve | Closed analytic regions around a coplanar world X/Y/Z or same-sketch line axis; angles greater than 0 through 360 degrees; New Body/Cut/Join. Crossing the axis is rejected. |
| Cut/Join | Explicit saved upstream target IDs. Cuts must remove material from every target; joins must add material and produce one connected solid. Capture intersected targets is an explicit action. |
| Hole | Up to 64 explicit centers and target bodies, blind or through-all, in either sketch-normal direction. Every center must cut a target and every target must lose volume. |
| Fillet/Chamfer | Supported authored extrusion cap perimeters, complete line/arc/circle cap edges, and source-line side corners. Retained authored edges can work after supported booleans; lost/trimmed edges require repair. |

Create/Edit Feature uses native preview and separate downstream checks where
applicable. Select an authored solid dimension to edit its expression; for a bound
field, explicitly choose a shared parameter or replace only that feature's formula.
Formula-bound extrusion values keep their bindings and disable distance dragging
until an explicit replacement is chosen.

**Place holes on face** and **Draw here → Remove material** guide inward holes and
pockets on supported retained planar extrusion faces. Placement must clear the
actual face boundary and existing openings. Sampled curved boundaries use a
conservative clearance allowance. Extrude/Fillet/Chamfer operation tokens also
support drag, click, and keyboard target cards. The edge token picker is limited
to native distance/New Body Extrude caps and unchanged authored cap edges,
including retained edges after supported Cut/Join. Whole-perimeter groups require
every original edge; individual picks cannot spread onto other contour edges.
Arbitrary BRep edges, vertical sides, and boolean-created topology are unavailable.

Use source-linked Issues and the Inspector to repair references. Timeline moves
preserve IDs and reject dependency violations. Failed operations retain upstream
previews while blocking dependent modeling and STL until repaired or suppressed.

### Stable modeling commands

UI drawing and parameter edits share typed `cad.*` commands with scripts and
agents. Discover argument schemas through `commands.list`: create/place components,
create/draw/dimension sketches, edit parameters, extrude/revolve, make scoped holes,
and add native fillets/chamfers. Generated UI interaction commands still cover
advanced tools whose semantic adapters are not yet available. No runtime geometry
proofs or arbitrary document patches are accepted as command arguments. See
[stable command catalog](docs/STABLE_COMMANDS.md).

## AI Assistance

AI is optional; ordinary drawing, modeling, and file commands work without a
provider. Open the bottom **AI** tab. Its descriptions, input and responses stay inside the resizable bottom dock in every layout. In Workbench, AI shares the dock with History and Issues; switching tabs or closing the dock cancels pending proposals and retains descriptions. Review native geometry before applying
any proposal; clarifications and failed previews do not edit the document.

| Mode/scope | What it can do |
| --- | --- |
| New part | Create an editable component from bounded parametric recipes, including supported analytic profiles, openings, extrudes, revolves, holes, and cap treatments. |
| This part | Change eligible independent length/angle parameters used exclusively by the active component. Shared, locked, derived, and unused values are excluded. |
| Selected feature | Change supported Hole dimensions, distance Extrude thickness, or Revolve angle while preserving the feature's other settings. Changed fields explicitly replace their old binding. |
| Sketch editing | Local numeric/relation edits, or consent-based provider proposals for bounded dimensions, parameters, relations, and analytic Trim/Extend actions. |
| Add features to this part | Add up to four bounded hole, rectangular/circular pocket, or listed cap-edge Fillet/Chamfer operations on one explicit supported native face/body. |

The docked assistant follows one selected part, supported feature, sketch, or planar face. A part selection limits edits to dimensions that affect that part alone. **Choose face on model** picks a supported native plane for holes, pockets, and edge treatments; curved, split, lost, or ambiguous targets produce diagnostics. You can choose an explicit scope or return to **Follow selection**. A selected sketch offers its drawing editor.

AI part proposals appear as real native geometry in the existing 3D viewport. **Before model** and **After model** keep the same camera; new and changed bodies are highlighted. Sketch proposals appear in cyan directly over the drawing canvas with their own Before/After controls. Cancel restores the accepted model. Proposal geometry is temporary; exports and model picking require Apply or Cancel first. See [canvas proposal behavior](specs/working-cad/AI_CANVAS_PREVIEW.md).

Each successful AI Apply creates one ordinary project history step. AI dock controls offer project Undo/Redo and a guarded latest-AI action. Exact requests such as **undo that** and **redo that** run locally without provider calls or new sharing consent. An intervening manual edit blocks the guarded AI action and explains how to use project history; opening another project clears AI action provenance.

After Apply, the assistant keeps recent complete conversation turns and refreshes
its editable target. When following selection, a single created or edited body
becomes the next target; an explicit scope remains explicit. Exact requests such as **halve thickness**, **double width**,
or **increase width by 10%** resolve current allowed dimensions locally and still
require native preview and Apply. Ambiguous dimensions ask for a choice. **Fix that**
uses the original failed request and latest diagnostic; changing projects or targets
clears that repair context. Sketch and same-face feature follow-ups require fresh
sharing consent and updated native context; a lost face requires a new target.
See [relative edit limits](specs/working-cad/AI_RELATIVE_EDITS.md).

Existing-part feature additions preserve existing IDs, parameters, and features.
Each proposed operation and the complete project must pass private native checks
before **Apply AI feature plan** creates one Undo edit. Mode changes preserve
descriptions/conversations, cancel pending previews, and reset feature-addition
sharing consent. New-part generation and feature-field edits retain their own
bounded scope and invalidation rules.

### Configure providers

```sh
cp .env.example .env.local
```

Fill the desired keys in the ignored `.env.local` and restart the server. Never
prefix API keys with `VITE_`, put them in project files, or commit them.

| Provider | Key | Model override |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` |
| Google | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | `GOOGLE_MODEL` or `GEMINI_MODEL` |

Configured defaults live in [.env.example](.env.example) and
[the gateway configuration](server/aiProvider.ts). Use a model override above or
choose a model identifier in AI settings. Provider access and availability depend
on your account.

The gateway works with development and local Vite preview, accepts only loopback
same-origin requests, and keeps credentials on the Node server. Static-only hosting
has no AI endpoint. Shared/public AI requires a separate authenticated service.

Requests send your description and bounded recent conversation. Existing-part
parameter/feature modes also send their eligible edit context. Sketch and
feature-addition modes require explicit sharing consent and disclose the bounded
context: solved sketch intent or face bounds/IDs, eligible cap-edge choices, and
listed parameter names/expressions/values. Full project JSON and full meshes are
not sent. Chat and unapplied proposals stay out of project files. Provider requests
are bounded and use validated data, rather than generated executable CAD code.
See [AI feature additions](specs/working-cad/AI_FEATURE_ADDITIONS.md) and the
[capability matrix's AI sections](specs/working-cad/CAPABILITY_MATRIX.md#ai-component-generation)
for per-mode limits.

## Save, Recovery, STL, STEP, and Images

**Save** downloads one deterministic `.pcaddoc` with durable CAD intent. **Export
Project JSON** creates a `.json` copy. **Open** or a single project-file drop uses
bounded validation and supported migrations before replacement. Nonempty projects
get keep/save/replace choices when dropping a file.

Edited projects autosave to IndexedDB after 500 ms idle. Recovery retains up to
five projects with latest, previous, and last manually saved snapshots; startup
recovery is explicit. Storage/quota errors leave the in-memory project intact.
Download project files regularly: termination can lose edits before a completed
storage transaction. Current schema is 19, with checked-in schema 1–19 regression
fixtures and migrations.

**File → Save or export…** brings editable projects, printing STL, other-CAD
STEP, PNG images and local library backup together. Each goal explains its scope
and opens the existing validated workflow. A selected saved sketch opens its
drawing, where Download sketch PNG captures its annotations; opening the drawing
does not itself download a file. Library backup opens the saved local parts and
its complete backup action. Finish/cancel active drawing before opening the hub.
See [export hub scope](specs/working-cad/EXPORT_HUB.md).

STL
requires a successful current rebuild with exportable geometry. Select bodies
explicitly; visibility does not silently change the export scope. Multi-body
export defaults to separate STL files in a ZIP. One STL with separate shells and
best-effort native union are also available. Exports retain global millimeter
coordinates. Disjoint unions remain separate solids and are reported.

The cancellable export worker validates coordinates, indices, degeneracy,
manifoldness, winding, shell/native volume, and bounded intersections. Combined
modes require acknowledgement of applicable warnings. Expensive checks may be
skipped outside union with a diagnostic. These checks cover supported meshes and
numerical tolerances; changed or stale results cannot be downloaded.

**Export STEP** lets you select current native bodies, **Generate validated STEP**,
then **Download STEP file**. The native writer exports separate solids at their
saved world positions in millimetres. A native reader verifies the actual output's
BRep validity, solid counts, exact volumes and bounds before download becomes
available. Cancellation or a changed model invalidates prepared output. STEP
contains geometric solids; editable history and component hierarchy stay in the
project file. Exports are limited to 64 bodies, 32 MiB and 60 seconds. See
[STEP export](specs/working-cad/STEP_EXPORT.md) for binding and geometry limits.

The viewport and native previews expose **Fit model** / **Fit preview** at compact
widths. Fitted views keep the complete model visible when docks or the canvas
resize; manual camera gestures and restored camera poses preserve their framing
until Fit is requested again. Fit uses both viewport dimensions.

Use the viewport **Model / Render** controls or the matching **Views** presets.
Model shows modeling overlays; Render uses smooth native shading and fixed studio
lighting, with grid, axes, edges, sketch overlays, dimensions, and selection highlights
hidden by default. **Show ground grid** and **Show model edges** are independent
preferences for each preset during the current project session. Opening a project
restores Model defaults. Camera poses, part visibility, and CAD geometry are preserved;
project and selected-part PNG downloads match the current preset. Render is a lightweight
raster view with no ray tracing or shadow passes and retains demand rendering and
movement optimization.

Render also opens a collapsible **Photo studio** with metal and powder-coat display
finishes, theme/neutral/warm/midnight backdrops, and Hero/Top/Front/Right camera
compositions. **Download studio PNG** captures the actual model at full resolution.
Finishes are visual approximations; the metal preset uses rough metallic shading
without directional brush textures. Settings last for the project session and
preserve native geometry and idle rendering. See [Photo studio](specs/working-cad/PHOTO_STUDIO.md).

The 3D view defaults to **Optimize while moving**: orbit, pan and zoom use at most
1× pixel density and hide model edge lines, then schedule sharp detail after 50 ms of idle input, without waiting for the damping tail. Actual restoration also includes the full-resolution frame time. Turn this off in **Views** to keep full detail during
movement. **Show model edges** controls solid edge lines independently. These
choices are temporary view settings and reset when a project opens. Unchanged
bodies reuse viewer buffers and cached edge lines across rebuilds; changed or
removed bodies replace/dispose their own resources. The 3D view redraws for scene
changes and while the camera settles, then stops scheduling frames while idle.
Solid dimension labels follow the same updates. Visible sketch points share
instanced sphere batches (one each for normal/error colors) rather than issuing
a draw call per point; point identities, sizes, plane positions, and visibility
stay available.

Use **File → Download project view PNG** for the current 3D camera, visible bodies,
and section preview, without sketch overlays, selection highlights, or inspection
lines. Sketches used by unsuppressed modeling features start hidden in 3D when a
project opens; unused sketches stay visible. Use a sketch’s **3D** checkbox to
show it, or **Edit Sketch** to open its complete drawing. Component isolation and
**Show all bodies** preserve these sketch choices; **Show all components** also
shows every sketch. Select a body, then choose **Download selected
part PNG** for a fitted image of that body alone, without selection highlights or
section clipping. Open a sketch and choose **Download sketch PNG** in File or the
sketch header to include its visible dimensions and constraint annotations.
Images use the current theme, omit application controls and 3D dimension buttons,
and are capped at 4096 pixels per side. Sketch drawings render at twice their
display size; 3D captures always use the viewer's full display resolution, even
during movement. Project/part images
require a successful current native rebuild; sketch images require a valid solved
drawing. Downloads do not change the project, camera, visibility, or Undo history.

Project files contain components, parameters/bindings, sketches, planes, timeline
features, saved unit preferences, and explicit named camera poses. Kernel handles,
Three.js objects, meshes, rebuild results, transient camera/selection, and AI chat
remain runtime data.

### Resource limits

| Resource | Default limit |
| --- | --- |
| Project import | 5 MiB UTF-8 JSON, depth 64, 500,000 JSON nodes |
| Components / parameters / sketches / features | 100 / 500 / 100 / 1,000 |
| Sketch entities | 750 per sketch; 10,000 total |
| Constraints and dimensions, combined | 512 per sketch; 20,000 total |
| Feature dependency depth / bodies | 100 / 64 |
| Centers per Hole feature | 64 |
| Tessellation per body | 100,000 triangles; 300,000 vertices |
| Total tessellation / export intersection tests | 250,000 triangles / 2,000,000 tests |

## Development and Validation

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server, strict port 5278. |
| `npm run lint` | TypeScript application and browser-test checks; not an ESLint/style check. |
| `npm test` / `npm run test:watch` | Vitest unit/component tests, once or in watch mode. |
| `npm run build` | TypeScript checks and production output in `dist/`. |
| `npm run preview` | Local production preview, strict port 5280. |
| `npm run check:item` | Per-item reduced gate: type checks, all unit/component tests, build/bundle budget, development native modeling/stale-result smoke tests, and focused production modeling/AI/CSP tests. |
| `npm run release:check` | Type checking, unit/component tests, build, development Chromium acceptance, and built-app production CSP acceptance. |
| `npm run test:browser` | Native development Chromium suite, strict port 5279. |
| `npm run test:browser:smoke` | Development non-template modeling and stale-worker-result smoke tests, strict port 5279. |
| `npm run test:production` | Built-app Chromium CSP suite, strict port 5280; build first. |
| `npm run test:production:smoke` | Production CSP, Focused workspace, Workbench, and AI drawer smoke tests, strict port 5280; build first. |
| `npm run test:cross-browser` | Build plus production Chromium/Firefox/WebKit workflow and compact-layout checks, strict port 5281. |
| `npm run test:ai:browser` | Controlled AI corpus and Focused workflows on all three engines, development server on strict port 5281. |
| `npm run test:ai:live` | Opt-in live provider checks, strict port 5291. |

Every completed item requires Prism review with Anthropic `claude-sonnet-5-5`
and `npm run check:item`, plus focused tests for affected behavior outside the
smoke set. After every **five completed items**, run `npm run release:check`
before committing or handing off the fifth item. Count requested changes rather
than fixup commits, and record the count and check results in
[the validation log](specs/working-cad/VALIDATION_LOG.md). Reset the count only
after a successful full gate. A missing or uncertain count requires a full gate
to establish a baseline; failed checks must be fixed before moving on. The full
gate already includes the reduced checks, so item five needs one full run and
Prism review rather than two test runs.

Install Chromium before the per-item gate:

```sh
npx playwright install chromium
npm run check:item
```

For the additional three-engine suites:

```sh
npx playwright install chromium firefox webkit
npm run test:cross-browser
npm run test:ai:browser
```

Run focused tests with `npm test -- src/tests/document.test.ts`. Test suites own
their server ports and do not reuse an already-running server. Stop `npm run preview`
on 5280 before production tests, `check:item`, or `release:check`; the two suites on 5281 must run
separately. Screenshots/downloads/traces go to ignored `test-results/`;
use `npx playwright show-trace <trace.zip>` for a retained failure trace.

Native browser acceptance checks BRep validity, solid count, exact volume,
orientation, parameter edits, undo/redo, save/open, STL, and stale-result rejection
across supported workflows. jsdom and fallback meshes alone do not establish
native modeling. Cross-engine checks cover their named workflows; human usability,
complete accessibility, screen-reader speech, and actual browser/OS zoom evaluation
remain pending. Controlled performance reports are described in
[PERFORMANCE.md](specs/working-cad/PERFORMANCE.md).

CI runs the release gate plus separate AI and Workbench cross-engine jobs. Live
provider generation stays outside ordinary release checks and CI. To opt in:

```sh
PLAINCAD_LIVE_AI=1 npm run test:ai:live
```

This makes at most six requests for the checked-in sleeve and face-boss prompts,
with no automatic retries. Missing keys skip their provider; without the opt-in
flag, generation tests skip. Live calls incur provider charges and responses are
nondeterministic. See [review and validation evidence](specs/working-cad/NEXT_FIVE_REVIEW.md)
for the latest feature batch's reproducible checks and separate live smoke results.

## Repository Map

| Path | Purpose |
| --- | --- |
| `src/app/`, `src/ui/` | App shell, design system, panels, commands, and interaction tasks. |
| `src/cad/document/`, `src/state/` | Durable schema, validation/migrations, immutable history, and rebuild scheduling. |
| `src/cad/parameters/`, `src/cad/sketch/` | Units/expressions, sketch solving, profiles, and editing planners. |
| `src/cad/features/`, `src/cad/kernel/`, `src/cad/worker/` | Dependencies, OpenCascade, tessellation/STL, and worker lifecycle. |
| `src/viewer/`, `src/templates/` | Three.js rendering and editable example models. |
| `src/persistence/` | Import safety, deterministic project files, and recovery. |
| `src/ai/`, `server/` | Bounded AI plans and local provider gateway. |
| `src/tests/`, `e2e/`, `production-e2e/`, `cross-browser-e2e/`, `live-e2e/` | Unit, native browser, production, cross-engine, and live acceptance. |

See [AGENTS.md](AGENTS.md) for architectural rules and the contributor review,
validation, and commit workflow.

## Limits and Troubleshooting

Dynamic simulation, CAM, sheet metal, loft/sweep/shell/thread modeling,
general surface modeling, and arbitrary topological naming remain unavailable. Existing constraints, face/edge references, and AI recipes have the
supported scopes documented in the capability matrix. Native failures report
the source and preserve upstream previews for repair.

- **Port collision:** stop the conflicting server or choose a different explicit port.
- **Kernel/WebAssembly load failure:** check browser console, network requests,
  and deployment worker/WASM MIME and security headers. Modeling tasks require native geometry.
- **STL unavailable:** finish/cancel tasks, wait for the current rebuild, then repair
  or suppress failing features and select exportable bodies.
- **Import failure:** inspect the visible error for malformed/unsupported data or
  resource limits. The current project remains intact after a failed import.
- **AI unavailable:** configure server-side keys, restart Vite, and check the chosen
  model's account access. Static hosting has no local gateway.
- **Bundle size:** React, Three.js core/renderer, CAD logic, and the OpenCascade
  loader use separate production chunks. In the default Workbench, the sketch
  editor and expanded AI assistant load when first opened and retain drafts when hidden.
  The compact canvas launcher works in all layouts. `npm run build` enforces a
  500 kB uncompressed budget for every JavaScript bundle, including workers;
  Vite's default warning threshold remains unchanged. The kernel's separate
  WebAssembly asset is outside this JavaScript budget.

## Further Reading

- [Capability matrix](specs/working-cad/CAPABILITY_MATRIX.md), [working-CAD specification](specs/working-cad/SPEC.md), and [roadmap](specs/working-cad/PLAN.md).
- [Design system](DESIGN_SYSTEM.md), [first-part workflow](specs/working-cad/FIRST_PART.md), and [simplified workflow proposal](specs/working-cad/SIMPLIFIED_WORKFLOW.md).
- [Sketch handoff](specs/working-cad/SKETCH_SOLID_HANDOFF.md), [mouse tools](specs/working-cad/SKETCH_MOUSE.md), and [sketch refinement](specs/working-cad/SKETCH_REFINEMENT.md).
- [Trim/Extend](specs/working-cad/SKETCH_TRIM_EXTEND.md), [contextual constraints](specs/working-cad/CONTEXTUAL_SKETCH_CONSTRAINTS.md), [Mirror/Pattern](specs/working-cad/SKETCH_MIRROR_PATTERNS.md), and [Offset](specs/working-cad/SKETCH_OUTLINE_OFFSET.md).
- [Modeling tasks](specs/working-cad/MODELING_TASKS.md), [face pockets](specs/working-cad/FACE_POCKET.md), [solid dimensions](specs/working-cad/SOLID_DIMENSIONS.md), [inline editing](specs/working-cad/INLINE_SOLID_DIMENSIONS.md), and [individual cap-edge picking](specs/working-cad/INDIVIDUAL_CAP_EDGE_PICKING.md).
- [AI feature additions](specs/working-cad/AI_FEATURE_ADDITIONS.md), [readiness guidance](specs/working-cad/READINESS_GUIDANCE.md), and [latest batch review](specs/working-cad/NEXT_FIVE_REVIEW.md).
- [Workbench validation](specs/working-cad/WORKBENCH_VALIDATION.md), [cross-engine usability checks](specs/working-cad/WORKBENCH_USABILITY_CHECKS.md), and [editing usability audit](specs/working-cad/EDITING_USABILITY_AUDIT.md).
- [Original MVP specification](specs/initial/SPEC.md), [completion review](specs/initial/MVP_COMPLETION.md), and [deployment guide](deployment/README.md).

Native rebuilds reuse validated feature outputs within bounded worker-owned caches. Changed solved geometry and dependent body versions invalidate reuse; failed rebuilds never admit partial results. See [incremental native rebuilds](specs/working-cad/INCREMENTAL_NATIVE.md).

**Project sketch edges** offers mouse/touch/keyboard picks of complete supported cap boundaries in a native source preview. A named chooser remains available. Pick, inspect the native projection preview, then Apply. Oblique or incompatible placed components show explicit reasons. See [projection limits](specs/working-cad/SKETCH_PROJECTION.md).

**Repeat a hole or pocket** includes a source-plane diagram with draggable spacing, center and sweep handles. Exact fields remain available. Formula fields require explicit consent before a drag replaces the formula with a literal; Escape cancels a gesture. Native validation runs after release. See [pattern controls](specs/working-cad/PATTERN_CONTROLS.md).

**New part → Local part library** saves one self-contained editable component with a native thumbnail in this browser. Drag a card onto the XY ground plane or choose Insert at origin, inspect the full native candidate preview, then Apply. Inserted copies have independent parameters and one-step undo. Rename/delete affects saved copies. Storage is bounded to 50 parts/25 MiB; download project files for portable backups. Cross-component dependencies must be repaired before saving one component. See [library limits](specs/working-cad/PART_LIBRARY.md).

- **Component alignment:** Move component can match native endpoints, straight-edge midpoints/directions, or supported planar face planes with signed clearance. Preview/Apply saves a static rigid pose in one Undo step; curved/general boolean topology and automatic collision avoidance remain unavailable; supported rigid/hinge/slider joints provide native collision feedback. See [alignment scope](specs/working-cad/COMPONENT_ALIGNMENT.md).
- **Placed-component projections:** New schema-17 links project retained native cap boundaries in world coordinates into parallel placed sketch planes. Source/target movement updates linked geometry; legacy links preserve their authored-coordinate behavior. Oblique, lost or unsupported references diagnose and block Apply. See [projection scope](specs/working-cad/SKETCH_PROJECTION.md).
- **Portable part library:** Back up the complete local library as a bounded .pcadlib pack, preview/import it as independent saved copies, or download one editable .pcaddoc. Imports validate every entry and commit atomically; failures/cancellation preserve existing copies and the open project. See [library transfer](specs/working-cad/PART_LIBRARY.md).

### Assembly joints and motion

Activate a moving component and choose Move component. Set Keep connected to Rigid, Hinge or Slider, pick its source flat face and a parent flat face, then Apply the native preview. Assembly motion is available in component settings and the command palette. Drag its motion slider or enter an exact value; Apply saves one Undo step. Detach joint keeps the accepted world position. A component with a joint uses Assembly motion rather than free placement.

Schema 18 saves at most 32 joints in an acyclic graph, with one parent per moving component. Parents may themselves have joints. Rigid joints follow the parent; hinge angles use degrees around the parent face origin/normal; sliders move in millimeters along that normal. Parent placement and mating-plane changes rebuild the children. Missing, absorbed or unsupported mating faces require deleting and recreating the joint. World-space sketch projection links cannot coexist with joints yet.

Collision checks use native OpenCascade common volume, with a 256 overlapping body-pair budget. Colliding bodies turn orange and produce diagnostics. Touching faces are not volumetric collisions. These checks examine the current position; swept-path simulation, contact dynamics, arbitrary cylindrical mates and joint export in STEP remain future work. STL/STEP exports contain actual positioned solids.

Remove joint in component settings also repairs a broken mating reference: a current native pose is retained; after a failed rebuild the component returns to its authored pose. Undo restores the removed joint.

Collision analysis exceeding its probe budget or failing native intersection is explicitly incomplete, with a warning. Modeling and export remain available; the UI does not report verified clearance for an incomplete analysis.

### Build a fitted part

Select a native part and use **Build a fitted part** in the command palette or active component settings. Choose an open enclosure, L bracket or open adapter sleeve, clearance and wall thickness (values or parameter expressions). Apply requires a validated native preview and creates a separate linked component with one Undo step. **Edit fitted part** repairs references or changes settings. Source size edits rebuild the fit; Follow source position follows its resolved component pose. Turn this off to move the fit independently, use assembly joints or world-space sketch projections.

These styles use the source’s exact native rectangular envelope in local coordinates: enclosure opens along +Z, bracket back is −Y, sleeve is open at both Z ends. Contoured shells, fastener detection and cylindrical adapters are not supplied by this command. If a new source operation comes later in History, move the fitted feature after it; missing or absorbed sources diagnose instead of producing an outdated fit.

### Manufacturing coach

Use **Manufacturing coach** in the command palette or active component settings.
Choose FDM, CNC or laser and adjust screening thresholds. Findings highlight their
bodies in the main model view, temporarily revealing hidden parts and restoring
the prior view on close. Supported thickness, fitted-clearance and hole-size
corrections preview actual native geometry before one-step Apply; Cancel leaves
the project unchanged and Undo restores it. Corrections replace a single feature
expression; they do not silently change shared parameters.

This is bounded screening, not certification. Wall checks cover fitted-wall
settings and unmodified extrusion depth, not general local wall thickness. CNC
checks authored Hole diameter against a chosen tool and explicit drilling-depth
ratios; arbitrary pockets, through-hole reach and complete tool access are manual.
FDM checks downward facet slopes above each body's lowest world Z (up to 250,000
triangles); bridges, support spans and strength are not simulated. Laser screening
requires retained axial extrusion caps and only axial through-cuts, and does not
convert solids to sheet parts. Assembly interference uses native solid common
volume. Resource/collision limits explicitly mark analysis incomplete.


### Product configurations

Open **Product configurations** from the command palette or active component
settings. Save the current editable parameter expressions with a unique name;
**Edit** changes a saved variant without changing the current model. Select up to
eight variants and **Compare** to rebuild each with OpenCascade, inspect body
size/volume, and preview it. **Apply** changes the current model in one Undo step.
**Download configuration STL archive** validates each part and creates an archive
with configuration/part filenames plus a manifest of native volumes and bounds.
Canceling or replacing the project invalidates pending results and downloads.

Configurations persist in schema 20 and keep stable parameter references and
derived formulas through renames. Unitless edits use the parameter's current
dimension and project unit defaults; explicit units retain their meaning. Locked
parameters are excluded; newly added
parameters inherit current values. A deleted or newly locked target requires
recapture; a broken inactive variant remains diagnosable without breaking the
current model. Projects store at most 16 configurations with 500 expressions each.
Comparison retains at most 250,000 total triangles / 64 MiB; the final archive is
limited to 64 MiB. Separate part STL files preserve component placement and are
not unions or print-bed arrangements. Inserting a reusable part copies its current
authored design, not the source project's configuration collection.


### Associative shop drawings

Open **Shop drawing** in the command palette or active component settings. Choose
an actual native part to generate Top, Front and Right views, native overall
X/Y/Z dimensions, verified complete internal cylindrical bore callouts, a
horizontal section and the project's current-body parts list. Change the world-Z
section height or leave it blank for the middle. **Download drawing SVG** saves
an editable vector sheet; **Download parts list CSV** includes complete part
names, stable body IDs, quantities and exact native volumes. Geometry edits
regenerate the sheet. Closing or replacing the project cancels pending work and
invalidates exports; drawings do not add document data or Undo steps.

Views use world coordinates and fit independently. Outlines, hidden-edge
visibility and sections use the native tessellation; they are illustrations, not
exact BRep curves. Dimensions describe the native bounding box, and bore lengths
describe complete cylindrical walls rather than drilling depths. Trimmed
cylinders require manual dimensions. The BOM has one row per current body with
quantity one; it does not infer repeated part identities or materials. Add
machining details, tolerances and GD&T separately. PDF/DXF export is not included.
Limits are 20,000 triangles per selected part, 4,096 inspected native faces,
64 bore callouts, an 8 MiB SVG and a 128 KiB CSV. Ambiguous/coplanar sections and
resource limits produce diagnostics rather than an incomplete downloadable sheet.
