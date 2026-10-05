# Working CAD Capability Matrix

Reviewed against source and automated tests on 2026-10-04. This is the current
implementation status, not a declaration that the working-CAD spec is complete.
Unit/component tests exercise fallback geometry and jsdom. Chromium acceptance
coverage now verifies native OpenCascade rectangle extrusion and circular through-cut
on XY/XZ/YZ, parameter edits, save/open, binary STL normals/volume/coordinates,
Z-up camera/grid, rendered mesh/sketch alignment, stale worker delivery, and
reinitialization after an old worker fails. A second native workflow covers
hand-authored arc/line extrusion with construction geometry, driving radius edits,
face offsets and upstream edits, conflict/export gating, save/open/STL, and explicit
repair after suppressing a plane owner. This
bounded workflow does not establish unrestricted OpenCascade modeling support.
Native-WASM unit tests additionally check exact volumes, BRep validity, solid counts,
positive tessellation winding, boolean failure paths, scoped disposal, partial
revolves/world axes/offset line axes, fillet/chamfer volume and surface-area changes, and flat/sloped
finite-face termination. Chromium modeling-operation workflows cover creation,
size/angle/axis edits, parameter edits, save/open/STL, and diagnostic/export recovery.
Additional Chromium workflows verify negative/symmetric extents and STL winding
on XY/XZ/YZ, directional through-all cuts, and explicit hole creation, blind-depth
edits, parameter-driven diameter, empty-center failure and save/open/STL recovery.

## Implemented foundations

- React/Vite/TypeScript UI, Three.js viewer, Zustand document history and undo/redo.
- Serializable document with stable IDs, deterministic JSON, schema migrations
  through version 12, and validation before imported state is accepted.
- Import unsafe-key rejection, nesting/node limits, and component/parameter/sketch/entity/
  constraint/feature count limits; unknown and runtime fields stripped by migration.
- Local project files contain a root component and up to 99 additional internal
  components with stable ownership of sketches/features/bodies. Browser activation,
  component naming, Create Sketch → origin plane → canvas → Finish Sketch → Extrude,
  undo/redo, legacy migration and native save/open/STL are covered. Modeling targets
  and source sketch choices are scoped to the owning component. All components
  share the project origin; the parameter table and timeline remain project-wide.
  Nested assemblies, placements, joints and linked external components are unavailable.
- Parameter expressions, dependency ordering/cycle errors, compatible unit
  conversion, dimensional arithmetic, CAD math functions, and expression limits.
- Schema 10 captures per-expression bare-number length/angle defaults, saved display
  units, parameter groups and descriptions. Readouts use current evaluated quantities;
  pending/invalid values report unavailable. Defaults affect newly authored or edited
  expressions; explicit units, scalar multipliers and dimensional ratios keep their
  semantics. Legacy expressions remain strict until edited. Display settings are
  undoable document preferences; mixed scalar/dimensional sums require explicit units.
  Chromium verifies native dimensions/offsets, scalar parameters, groups, undo,
  save/open and STL volume under inch/mm defaults.
- XY/XZ/YZ sketches with points, lines, circles, arcs, construction geometry, and
  rectangle helpers; geometry/dimension/constraint authoring controls.
- Driving dimensions and 11 constraint types, seeded/canonical reset solving,
  local Jacobian-rank DOF reporting, redundant/conflicting intent diagnostics,
  finite tangency contact checks, and mirrored angle/distance branch diagnostics.
- Origin offsets and feature-owned cap/straight-side planes with stable IDs,
  offset expressions, upstream-edit tracking, and explicit lost-reference repair.
- Mixed line/arc loops and circle profiles, nesting/holes, stable entity-based profile IDs,
  and duplicate/self-intersection diagnostics for supported geometry.
- Timeline steps with legacy ordering/migration fallbacks, suppression, stable
  feature-derived body IDs, reference/dependency planning and invalid-order errors.
- Shared dependency-validated earlier/later timeline moves across independent items,
  stable IDs/timestamps, undo/redo and save/open. Same-body modifier order is preserved.
- Explicit source sketch/profile/upstream body repair, lost-axis indication, and
  import/recovery of well-typed broken feature references; modeling/export stays blocked.
- Worker request IDs and epochs, stale-response protection, watchdog timeouts,
  progress messages, disposal helpers, tessellation cache helpers, and rebuild metrics.
- Camera navigation, fit/reset, body/feature selection, basic inspection,
  sketch overlays, and source-linked rebuild/import/export diagnostics.
- Mounting-plate and box templates, command palette, shared command enablement,
  save/open/project JSON, and current-successful-rebuild STL gating.

## Modeling availability and limits

| Capability | Current behavior | Availability |
| --- | --- | --- |
| Extrude new body | Positive/negative/symmetric distance native wire/face/prism extrusion of closed line/arc/circle loops and holes; symmetric distance is total span; fallback triangulates sampled boundaries | Creation dialog with native preview, explicit profile/distance/direction/operation and Apply/Cancel; inspector |
| Extrude cut | Up to 64 explicit saved target IDs; atomic updates of all targets; native world-coordinate tools; valid nonempty solid output with reduced exact volume; disjoint/no-op and empty cuts diagnosed; narrow rectangle/circular-through-hole fallback | Creation dialog with explicit targets and native preview; Inspector |
| Extrude join | Up to 64 ordered explicit targets; atomic native connected union; first target ID/name survives, secondary targets absorbed; tool must add exact volume beyond target union; disconnected/no-op joins diagnosed; no fallback | Creation dialog with explicit targets and native preview; Inspector |
| Through all | Projects all selected target bounds along the sketch normal for positive/negative directions or a symmetric total span; wrong-side targets diagnosed; subject to cut/join limits | Creation dialog with explicit targets, direction and native preview; Inspector |
| Extrude to face | Positive termination on an upstream unmodified feature-owned planar cap/straight side, including sloped faces; native half-space trimming; end-cap area/intersection checks enforce finite face and holes | Creation dialog with explicit face selection and native preview; Inspector with repair |
| Negative/symmetric extrude | Distance and through-all supported with a shifted start plane and unchanged coordinate basis; distance owners publish native-validated retained cap/straight-side sketch planes and authored edge treatments; to-face tools remain positive-only | Inspector; unsupported to-face combinations disabled and diagnosed |
| Revolve | Native analytic closed line/arc/circle profiles with holes; coplanar world X/Y/Z or same-sketch line axes; angles greater than 0 through 360 degrees; cross-axis/zero-volume/invalid output rejected | Native preview-and-Apply creation dialog with explicit profile/axis/angle; inspector; narrow full-Y/XY rectangular fallback for loaded documents without kernel |
| Revolve cut/join | Native cut on up to 64 explicit saved targets with atomic publication; join merges an ordered explicit scope into one connected solid; boolean validity/volume checks | Creation dialog with explicit native target previews; Inspector with cut/join scope checkboxes and lost-reference removal |
| Capture intersected targets | Native common-volume checks on current upstream solids and extrude/revolve/hole tools; saved IDs only; preserves an intersected join primary; ignores downstream bodies; empty/failed/stale probes leave the scope intact; face-only joins remain explicit | Shared command and Inspector button; dedicated worker with cancellation/time limit |
| Hole | Up to 64 explicit saved target IDs and 64 sketch point centers; native aggregate cylindrical tools; every center must cut some target, every target must lose exact volume; atomic output publication; positive blind-depth/through-all; empty/duplicate/lost centers/targets and no-op cuts diagnosed | Native preview-and-Apply creation and editing; fresh upstream choices, separate edited-operation/downstream checks, source/center/target repair, stable IDs and one undo; direct repair inspector |
| Fillet/chamfer | Real native geometry on feature-owned cap perimeters, individual line/arc cap edges, or a source line’s two extrusion-direction corners; BRep/solid-count/volume-or-surface-change checks; retained authored edges also work after native booleans; grouped perimeters require every original edge and exclude new Cut/Join edges; lost/trimmed/ambiguous edges fail | Native preview-and-Apply creation dialogs with size/role/source/owner choices; repair inspector |
| Offset/face sketch planes | Expression-driven origin/face offsets; upstream distance-extrusion caps and straight outer sides; retained native faces after Cut/Join supported at the sketch’s timeline position; removed/split/ambiguous/suppressed/missing faces require repair | Create Sketch with signed expression-driven origin/face offsets; Sketch tools with explicit replacement selection; lost planes fail rebuild |
| STEP | Optional adapter interface only; no implemented exporter | Hidden |

Failed operations retain upstream preview bodies but fail rebuild and disable STL.
Downstream modifiers on a failed body are blocked. Suppression permits recovery.
Native modeling results include runtime-only validity, exact volume/surface area, and solid-count
assertions; these are never saved in project JSON. Splitting a body by a cut may yield
multiple valid solids in one stable target-body compound. Empty cuts fail explicitly.
Edge references do not survive boolean modifications; treatment chains may select
remaining cap perimeters or unchanged source edges, while changed/missing individual
edges require explicit reselection. Arbitrary transient edge picks are unavailable.

## Measurement and inspection

- Current solved sketch points measure world-space distance and X/Y/Z delta across
  origin, offset and supported face planes. Lines use solved endpoints; circle and
  arc lengths, radii, diameters and arc sweep are analytic rather than sampled.
- Unit-aware mm/cm/m/in/ft readouts and a transient world-space distance overlay
  follow parameter edits. Pending/failed rebuilds hide stale results; lost references
  require explicit reselection. New/open projects clear measurement selection.
- Body Inspector reports native volume/solid count and tessellated global bounds.
  Arbitrary BRep edge/face measurements and surface picks remain unavailable.

- Standard Top/Front/Right/Isometric cameras share the CAD world frame; Fit
  preserves direction. Schema 9 stores up to 20 named camera poses with stable IDs,
  bounded/validated coordinates, save/open retention, deletion and undo.
- Transient global X/Y/Z section clipping with millimeter offsets, reversible side,
  clipped model/sketch/measurement previews and clipped-side picking exclusion.
  Sections are uncapped visual previews; geometry and exports remain complete.

## Durability and fabrication

- Schema 1–12 checked-in fixtures migrate, rebuild, retain IDs, edit dimensions,
  round-trip project files, and recover through the same import codec. Production
  Chromium imports the entire released corpus under CSP and verifies native BRep
  volume/solid count, thickness edits, saved feature/entity/parameter IDs, save/open
  intent and STL signed volume/global bounds. This corpus is a rectangular body
  with a through-hole; it does not cover every historical feature combination.
- IndexedDB autosave: 500ms debounce, latest/previous/manual snapshots, five-project
  retention, explicit startup recovery and previous-snapshot fallback. Quota and
  unavailable-storage errors preserve memory and offer manual save/purge.
- Actual rebuilt body list, transient per-project visibility, hidden-body picking
  exclusion and visible-body Fit View. Explicit STL body selection (including
  selected-body quick export and selected-body native union) is independent of
  visibility; lost/empty selections and replaced projects require reselection.
- Separate body STL files in a ZIP (multi-body default), one STL with separate
  shells, and native best-effort union. Global millimeter coordinates are retained.
  ASCII filenames are NFC-normalized, traversal/device-safe, length-bounded and
  deduplicated case-insensitively. Separate shells report overlap/containment/contact;
  warned combined downloads require explicit acknowledgement and current-model checks.
- Cancellable worker export checks finite float32 geometry, malformed indices,
  degeneracy, duplicate faces, edge/vertex manifoldness, winding, cavity orientation,
  native-volume agreement, and bounded non-adjacent triangle intersections.
  Native face seams weld within 1e-7mm. Expensive checks may be skipped outside union.
- Imports reject files over 5 MiB before reading, check UTF-8 byte size and nesting
  before JSON reviver recursion, then sanitize/migrate/validate in a cancellable worker.
  Rebuilds enforce document count, dependency depth, body and triangle limits;
  tessellation rejects oversized buffers before allocation growth. See README for values.

## Partial or missing working-CAD requirements

- Parameter expressions persist stable-ID token bindings with safe display-name
  updates across renames, edits, save/open, and old-name reuse. Missing bindings
  block rebuild without retargeting and remain saveable for explicit repair.
  These bindings are covered by rename/edit/save/open/browser geometry checks.
- The driving solver handles small sketches: 160 scalar variables, 512 residual
  equations, 100 iterations, and a 50ms iteration budget. DOF/rank is a local
  numerical heuristic, not proof of a globally unique solution. Distance/angle
  branch checks reject mirrored changes; canonical reset returns to authored
  coordinates. Previous valid seeds live in worker memory and are not serialized.
- A plane-local SVG sketch canvas draws points, connected lines, rectangles,
  circles and center/start/end arcs with previews, existing-point/grid snapping,
  construction curves, pan/zoom/Fit, primitive undo/redo and stale-gesture protection.
  Pointer-driven native Chromium workflows cover XY/XZ/YZ, an offset plane,
  non-template extrusion/cut, edits, save/open and STL. The canvas edits local
  millimeter coordinates on resolved origin/offset/supported face planes; lost
  planes block drawing. Reference lengths/radii and editable driving dimensions
  annotate current solved geometry with extension/leader lines and display units;
  labels and keyboard controls add/edit/delete supported dimensions. Pending,
  conflicting and lost dimensions show unavailable values; unanchored lost
  references remain in the repairable dimension list instead of attaching to
  unrelated geometry; failed solves block
  drawing and native export but keep dimension expressions repairable. Native
  Chromium covers parameter-driven diameter edits, conflict recovery, save/open
  and STL; production CSP covers keyboard drawing, diameter edits and native XZ
  volume/orientation. Free numeric points support direct dragging with transient
  connected-curve previews and exact keyboard moves, one edit on release,
  cancellation/stale-document protection, shared-ID retention and undo/redo.
  Parameter-bound, constrained, distance/angle-driven and arc points reject moves
  explicitly; lost point selections remain visible, and moves onto another point
  are rejected instead of merging IDs. The translate tool moves connected groups
  rigidly, including arcs, circles, construction geometry, constraints, dimensions
  and straight-line T-junction contacts. It preserves authored IDs and intent and
  rejects solver deformation, new coincidences and changes to valid profile topology.
  Fixed geometry and parameter-bound coordinates block translation; dimension/radius
  expressions may remain parameter-driven. Groups are bounded to 80 points.
  The Deform tool supports point-and-line sketches with horizontal, vertical,
  coincident and fixed constraints, horizontal/vertical point-distance dimensions,
  and lengths on explicitly horizontal/vertical-constrained lines. Coordinate
  changes propagate through supported relations; fixed and parameter-bound axes
  block incompatible targets without rewriting expressions. The complete sketch
  is bounded to 80 points. Solver movement outside the planned deformation,
  new point coincidences, collapsed/reversed edges and valid-profile topology
  changes fail before a history edit. IDs, constraints, dimensions and bindings
  survive deformation, undo/redo and save/open. Native XY/XZ/YZ checks verify
  corner deformations, parameter-driven width locks/edits, cancellation/stale
  gestures, exact BRep volume/bounds and STL winding. Curves (including construction),
  nonlinear constraints, general distance/angle dimensions and unconstrained-line
  lengths remain unavailable for deformation; existing geometry/dimension controls
  retain their support. General nonlinear constraint-driven dragging remains open.
  Straight-line T-junctions and crossing dividers are fragmented before bounded
  planar face extraction. Runtime segments retain source lineage; stable split
  anchors preserve profile IDs through ordinary size, ordering and winding edits.
  Topology changes require explicit profile repair. Source entities/constraints are
  never rewritten. Open/dangling, overlapping, touching-ambiguous and authored
  self-crossing loops fail diagnostically; 750 source lines and 2048 fragments bound
  the work. Straight dividers and closed line boundaries can now split circles
  and mixed arc/line profiles at analytic contacts, retaining exact circular kernel
  boundaries, source lineage and stable fragment-based profile IDs through
  size/order/winding edits. Native XY/XZ/YZ checks cover circle/arc sectors,
  parameter edits, reversed authored arc winding, exact BRep volume/orientation,
  save/open, STL and explicit repair after topology changes. Untouched circles and
  unsplit legacy arc profiles retain existing IDs. Authored mixed-loop
  self-intersections, interior tangencies, overlaps and dangling tails fail
  explicitly; ordinary shared arc endpoints remain supported. Proper circle/circle
  crossings now create selectable analytic lens/crescent regions with stable
  pair/root anchors. Native XY/XZ/YZ tests verify exact BRep volume and world-coordinate bounds,
  parameter edits, save/open, STL and explicit repair when intersections disappear.
  Nested/disjoint circles keep their identities; tangencies and coincident circles
  stay diagnostic. Circle/arc crossings are now fragmented analytically within the
  authored sweep, including partial arc dividers ending on circular boundaries.
  Native XY/XZ/YZ checks verify exact lens BRep volumes, coordinate orientation,
  parameter edits, reversed source winding, save/open/STL and lost-profile repair.
  Arc/arc contacts now use the same bounded analytic path. Arc-only disk and
  partial-divider regions preserve source lineage and IDs through scale, rotation,
  order and winding edits. Native XY/XZ/YZ tests verify exact lens volumes,
  coordinate orientation, parameter edits, save/open/STL and topology-change repair.
  Shared endpoint joins retain legacy IDs; coincident sweeps, interior tangencies,
  dangling networks and proper self-crossings of authored closed components fail
  diagnostically.
  Curved traversal is bounded to 750 source curves, 2048 fragments/contacts and
  8192 sampled graph segments; sampling classifies faces, while native modeling
  uses analytic fragments. Individual
  authored edge treatments on split lines or arcs remain diagnostic rather than
  rebinding; full cap-perimeter selections remain available.
  Arcs retain analytic kernel boundaries;
  profile classification and fallback meshes sample their sweeps. Face selection
  uses explicit feature-owned roles in Sketch tools, not arbitrary viewer picks.
- Timeline moves validate structural dependencies and preserve same-body modifier
  order; arbitrary modifier reordering and kernel preview before committing a move
  remain unavailable. Rebuild failures remain diagnostic and undoable. Durable
  explicit initial intersection-based scope capture is available for extrude,
  revolve and hole scopes. A dedicated bounded worker probes native common volume
  against the feature's upstream prefix, then saves only intersected stable IDs.
  Document edits/replacement cancel the probe; undo/redo/save/open preserve captured
  intent. Existing join primary IDs survive recapture when still intersected;
  face-only contact requires manual target selection. Capture is never dynamic.
  Extrude/revolve cuts persist explicit
  selected target sets, never add new bodies silently, retain all upstream previews
  on boolean/tessellation/resource failures, and expose lost-ID removal for repair.
  Joins retain the first selected target identity and absorb the rest only after
  native validity, connectivity, exact volume and tessellation checks pass. Target
  choices exclude absorbed bodies; authored downstream references diagnose absorption.
  Native Chromium checks cover bridge joins in non-spatial target order,
  per-body BRep volumes, a late disjoint-target failure,
  reference repair, parameter edits, undo/redo, save/open and STL output.
  Hole patterns also support separate centers drilling separate targets, offset
  bodies, and blind depths spanning selected bodies; unused centers and no-op targets
  fail the whole feature. Native XY/XZ/YZ tests verify exact volumes and orientation.
- Dependency inspection now exposes direct/transitive input and affected-output
  paths for parameters, sketches/entities, features and bodies. Stable-ID navigation
  is read-only; missing entries remain visible, suppressed/downstream owners are
  labelled, and body modifier chains follow the displayed timeline. Traversals are
  iterative with visited sets and diagnose cycles returning to the selection; lists
  paginate at 50 entries. Unit and Chromium checks cover rename propagation,
  lost bindings, cyclic intent and unchanged native geometry during navigation.
  This is authored structural inspection; geometry validity remains a rebuild check.
- General post-boolean face/edge naming remains missing. Sketch planes use a
  native-validated positive/negative/symmetric distance new-body role, including
  unique retained cap/straight-side planes after booleans;
  cap and straight-side planes follow shifted sweep origins and outward normals.
  curved side faces, hole/revolve faces, and ambiguous rebinding are unsupported.
- Canvas constraint markers cover all 11 supported types and identify current
  satisfied/redundant/conflicting/pending/lost/unavailable states. Leaders locate
  referenced geometry rather than tangency contacts. Marker/list selection supports
  keyboard inspection, ordered reference repair and undoable removal with stable
  constraint IDs; lost references remain list-only and pending markers are hidden.
  Native Chromium checks conflict recovery, missing-reference repair, unchanged
  volume through annotation/repair/removal, undo/redo, save/open and STL.
  Lists paginate at 20 entries and at most 128 anchored markers/16 leaders per
  marker render. Creation remains in Sketch tools. Constraint labels support pointer
  and keyboard positioning, Home/family reset and cancelled-gesture rollback;
  leaders follow the referenced geometry and inspection/repair retain stable IDs.
- Dimension and constraint labels now share bounded automatic placement:
  dimension labels reserve space first; constraint labels avoid those boxes and
  point handles. Font-size estimates and 49 candidate positions bound work to
  128 labels per family. Native Chromium checks actual rendered label separation
  through group translation, zoom, parameter edits, save/open and STL. Dimension
  leaders allow pointer gestures through to geometry; relocated labels retain
  geometry leaders. Layout is transient and follows the current view. All intent
  remains accessible in selection/list controls; dense or oversized labels stay
  visible with an explicit crowded-view diagnostic. This is best-effort box
  avoidance, not guaranteed placement around every curve/leader. Dimension and constraint labels support pointer dragging and keyboard arrow positioning
  (Shift for larger steps), with Home/per-family reset and Escape/pointer-cancel
  rollback. Manual positions clamp to the view and reserve space before automatic
  labels; overlapping manual positions remain explicit crowded placements.
  Reference measurements remain pointer-transparent until Position reference labels
  is enabled. Positions last only in the open canvas, never edit history or project JSON,
  and document/view changes cancel in-flight gestures. Constraint positions remain
  while markers are hidden; closing the canvas discards all manual placement.
- STL validation is numerical and bounded: it does not prove absence of every
  adjacent-face or near-degenerate self-intersection. Skipping expensive checks
  is explicit. Native union remains best-effort and does not connect disjoint solids.
- Production CSP and security headers are generated from one policy source for
  static hosts and Nginx, and applied by Vite preview to HTML and workers. A built-app
  Chromium test verifies native modeling, save/open, recovery, native union and STL
  under the policy, plus blocked inline scripts, JS eval and remote fetch. Final-host
  header/MIME verification remains a deployment step.
- Broader browser/kernel acceptance coverage (additional complex feature chains,
  imported workloads, other browsers), broader accessibility audit,
  and final-host deployment
  verification remain open. The bounded Chromium suite runs in the release gate
  and GitHub Actions; CI execution itself has not been verified locally.

## Keyboard and modal workflows

- Native palette, recovery, hole and STL dialogs keep background controls inert,
  wrap Tab/Shift+Tab and restore previous focus; Escape dismisses (recovery waits
  for an active load). Viewer Fit/selection shortcuts ignore open dialogs.
- Ctrl/Cmd+K opens the palette, arrow keys browse enabled results, and Enter runs
  the first available filtered command. Disabled/no-result searches remain open.
  Backdrop click or Close dismisses the palette; its filter resets on close.
- Chromium tests cover focus containment/restoration, modal-to-modal export,
  disabled commands, camera orientation, shortcut isolation and retained recovery.
  This is bounded keyboard coverage; screen-reader and contrast audits remain open.

## Performance and resource reporting

- A controlled native extrude/cut benchmark records five warmups and twenty current
  geometry-verified parameter edits, measurement/section previews, and ten validated
  STL exports. JSON artifacts include phase timings, sample p50/p95, environment,
  scoped/outer disposal counters, WASM capacity and Three.js resource counts.
- The release gate checks bounded resource growth and zero disposal failures;
  shared-CI latency is reported without hard timing thresholds. Capacity/resource
  counts do not prove absence of every leak.
- The built app runs the same controlled fixture under production CSP with public
  UI controls: five warmups, twenty edits and ten full-check STL exports. Reports
  record edit-to-current-native-readout and export-to-download timings, sample
  p50/p95, rounded observed native volumes and environment. Every edit checks
  current volume/solid count/bounds; every STL checks finite data, triangle count,
  positive signed volume and bounds. Internal phase/resource counters remain
  unavailable in production; broader workloads and browsers remain open.
  See [method and local results](PERFORMANCE.md).

## Intentionally deferred

Assemblies/mates, CAM, simulation, sheet metal, generative design, collaboration,
cloud sync, mobile-first editing, plugins, unrestricted AI generation, and general cross-feature
topological naming remain outside the working-CAD target. STEP can remain hidden
until validated support exists.

### AI selected-feature dimensions

The AI drawer can edit a selected unsuppressed Hole, distance Extrude or Revolve
in the active component. It sends only the feature type/name and named evaluated
dimensions, not project geometry. Source/profile/axis/operation/target/center and
termination references are retained; changed fields use literal mm/deg values and
override their prior binding. Unchanged bindings and project parameters survive.
The operation stage and full downstream native rebuild must both pass before Apply.
Selection/project/session/component changes reject stale proposals; Apply retains
IDs/timeline order in one undo step. Arbitrary feature replacement and edits to
other feature settings remain unavailable through AI.


Signed distance owners use the same durable cap/corner roles as positive owners.
Native Chromium coverage checks negative/symmetric fillet and chamfer geometry on
XY/XZ/YZ, exact removed volume, coordinate bounds, size/depth edits, invalid-size
recovery, save/open and positive STL winding. Through-all/to-face owners and
boolean-created topology remain unavailable for edge reference ownership.


Sketch-entity Inspector controls expose line/arc start/end and circle/arc center
references, same-sketch point reselection, point navigation, and arc winding.
Well-typed lost point IDs can open for repair; malformed/empty IDs are rejected.
Modeling validation still diagnoses unresolved references. Chromium covers imported
arc/line/circle reference repair, direction-dependent native bounds, inconsistent
arc geometry, undo/redo, save/open and STL volume/winding. These controls do not
guess replacement points or provide general constraint-driven deformation.


Inspector committed inputs identify dirty drafts with visible text/border styling
and an accessible description while preserving field names. Enter or blur applies;
Escape cancels; external changes replace the draft. Chromium verifies unchanged
native geometry during typing/cancel, exact volume after commit, and focused undo
without a stale blur overwrite. Other form controls retain their existing commit
behavior; this is not a completed screen-reader audit.


A six-operation native XY acceptance fixture chains extrusion → cap fillet → cap
chamfer → through-hole → through-pocket → connected boss join. Every intermediate
has exact-volume/BRep/solid-count assertions; depth and fillet-radius edits check
final bounds and stable identity. A failed middle cut retains the upstream preview
and blocks its downstream join/export; suppression and explicit repair recover.
Undo/redo, save/open over a replacement template, bound parameter IDs and STL
winding/volume are verified. Other complex parts and general modified-face naming
remain open; this fixture does not expand supported topology roles.

### Extrusion creation preview

The Extrude command opens a draft dialog rather than inserting a default feature.
It selects one closed profile and distance termination, with positive, negative or
symmetric total span and New Body/Cut/Join. Cut and Join also offer Through All
against explicit selected target bounds. Positive extrusion also offers To Face
with explicit unmodified upstream planar face selection and native coverage checks. Explicit target IDs are limited to
current native bodies in the active component. A separate preview worker rebuilds
the staged project, checks successful native solid assertions, and displays exact
volume and orbitable geometry. Apply is unavailable for invalid/no-op geometry,
pending or stale settings, project replacement/edits, or component changes. Cancel
terminates pending work without changing project history, rebuild meshes, save,
autosave or export. Worker cancellation and a 30-second limit bound preview jobs;
changing inputs is debounced by 300 ms. Multiple simultaneous profiles are not
offered in this dialog.

### Sketch workspace

Sketch editing uses the main model area with a contextual control panel and sticky
Finish Sketch action. The Browser, parameters and timeline remain accessible.
The existing plane-local SVG geometry, dimensions, constraints, snapping, exact
coordinate input and guarded edits are retained. Escape cancels a draft/drag before
finishing; F fits the focused sketch. Shared command enablement blocks solid
creation and a second sketch/component during this mode. The 3D viewer remains
mounted so finishing does not discard its runtime resources or camera controller.
Project replacement, sketch removal and component changes end obsolete sessions.

### Interactive sketch-plane selection

Create Sketch offers colored origin planes and native cap/straight-side picking in
the 3D viewer, with hover highlighting, matching keyboard buttons, and plane-local
camera alignment. Native picking matches body ID, outward normal and plane
position to exactly one supported role; ambiguous, curved, lost/split and fallback
faces diagnose without document edits. Origin selections and supported face
references create one sketch in the active component using existing persisted
plane data. Native browser tests cover origin picking, cap highlighting/selection,
owner parameter edits, save/open and curved-face rejection. Generic topology and
new boolean face roles remain outside this selection scope.

### Component navigation

The Browser provides component visibility and isolation, including owned native
bodies and sketch overlays. Per-sketch 3D checkboxes independently hide overlays
without hiding their editor canvases. Show All Bodies preserves individual sketch
hiding; Show All Components and Isolate restore sketch visibility within their
view scope. Hidden bodies are excluded from viewer fitting and
picking; visibility does not alter rebuilds or the explicit fabrication scope.
Timeline chips label their component owner, with an optional active-component
filter that follows activation. Timeline movement still validates the full
project order. These are runtime view preferences, reset when replacing/opening
a project and excluded from undo history and project JSON. Components remain
flat parts at a shared origin; assembly placements and joints are unavailable.


### Retained references after booleans

Current native solids publish only surviving, unique planar extrusion cap/straight
side roles. Sketch references, including face offsets and standalone sketches,
are validated at their timeline position; lost, split or absorbed references
produce sketch-linked diagnostics and block dependent modeling/export. Later
modifiers do not invalidate earlier sketches. The canvas and repair controls use
current validated planes. Native face measurements are cached per runtime shape
and discarded on disposal; neither these records nor available face lists enter
project files. Existing schema-12 references retain their saved identities.

Fillet/chamfer resolve the original distance extrusion through Cut/Join lineage,
then match authored edges against the current BRep. Entire perimeters require all
original edges, exclude newly introduced hole/Join edges, and reject trimmed or
ambiguous matches. Analytic circle rims match geometry independently of their
native seam, with exact native volume checks on XY/XZ/YZ. Tests cover retained
Cut caps, Join sides, post-boolean chamfer/fillet volumes, owner edits, save/open,
STL, and split-face repair. Arbitrary newly created boolean faces/edges and stable
topology naming remain unavailable; to-face termination retains its unmodified
owner restriction.

### Revolve creation preview

Revolve creation selects a closed profile, a coplanar origin or same-sketch line
axis, angle, operation and explicit active-component target bodies. A cancellable
native worker previews the staged project and validates BRep solid assertions and
operation tags before Apply adds one feature. Axis crossing, invalid angles,
no-op booleans, pending or stale settings, project edits/replacement and component
changes block Apply. Cancel leaves document history and main rebuild results
unchanged. Chromium checks analytic torus quarter-sweep volume/orientation,
construction axes, Cut/Join target volumes, cancellation and save/open.

### Edge-treatment creation preview

Fillet and Chamfer creation now stages size, current native distance-extrusion
owner, cap/side-corner role and original source edge choices. The shared isolated
worker requires real native treatment geometry before Apply. Invalid sizes,
unchanged/lost/trimmed edges and stale settings diagnose without a history edit.
Using both cap roles no longer prevents another treatment on a surviving authored
edge; the preview validates that choice against current geometry. Chromium checks
three successive native XZ treatments, exact volume changes, cancellation, invalid
size/edge recovery, stable body ownership and save/open. Existing XY/XZ/YZ and
post-boolean edge workflows also use the new Apply step. Arbitrary native edge
picking and new boolean-created edge identities remain unavailable.

### Per-sketch visibility

Sketch visibility is a runtime stable-ID preference scoped to the project session.
Browser checkboxes respect component hiding; editing a hidden sketch opens its
complete SVG canvas while its 3D overlay stays hidden after Finish Sketch. Native
Chromium verifies actual overlay point counts, unchanged BRep/history/results,
depth edits and undo while hidden, body/component view restoration, save/open
reset and native STL volume. Stale context commands cannot hide reused IDs in a
replacement project. No visibility state is serialized or used as fabrication
scope.

### Hole creation preview

Hole creation now rebuilds the staged project in an isolated native worker before
Create hole feature becomes available. Invalid dimensions, unused centers, no-op
cuts and missing targets leave the document unchanged. Diameter, blind depth and
Through All changes invalidate previous previews; Cancel, document replacement
(including the same ID), component changes and file jobs reject stale drafts.
Every resulting body must remain a valid native solid, and each selected body must
publish a native Cut. The kernel rejects unchanged cuts before success. Applying
adds one history edit.

Existing unsuppressed Hole features also use **Edit Feature**. A fresh native
upstream rebuild supplies same-component source sketches, solved points and live
target bodies; later bodies/sketches are excluded. Lost sources, centers and targets
can be reselected or removed. A failed current feature can be repaired when its
upstream geometry is native. Editing validates the Hole stage separately from the
full downstream rebuild, so later Chamfer/Fillet operations are supported and a
downstream no-op Cut blocks Apply. Feature, sketch/entity, body and timeline IDs
are retained; unchanged dimension expressions preserve authored units/bindings.
Cancel and stale project/session/component/file-job frames cannot apply; a valid
edit adds one undo step. Native browser acceptance covers multiple centers,
blind/through-all edits, lost-reference repair, downstream failure, same-ID project
replacement, undo, save/open and STL winding/volume.

### Offset-plane creation

Create Sketch offers a signed length offset before selecting an origin plane or
a supported native face. Viewer clicks and keyboard plane buttons select the
base; the sketch opens aligned to the offset basis. Invalid expressions and units
create no sketch or history entry. Saved expressions follow parameter and face
owner edits using the existing plane validation and repair rules.

### Extrude feature editing

Edit Feature in the timeline/palette and Edit feature with preview in the Inspector
open the selected unsuppressed Extrude with its current settings. Double-clicking
a supported timeline feature does the same. Choices come from an isolated native
rebuild immediately before its original timeline position, excluding future/self
target bodies. The replacement operation and the complete downstream project must
both rebuild as valid native solids before Apply. Cancel and invalid/stale previews
leave the document unchanged; Apply preserves feature/body IDs and timeline order
in one undoable edit. Source-sketch repair remains available in the Inspector.
Editing is also available for a current failed rebuild so invalid settings can
be repaired; choices must first pass a fresh native upstream rebuild. Editing
uses bounded isolated workers sequentially for the operation and downstream
validation, so it costs more than creation previews on large projects.

### Revolve feature editing

Edit Feature also previews replacements of unsuppressed Revolve features at their
original timeline position. Profile, coplanar origin/sketch-line axis, angle,
operation and saved target scope are editable. The native sweep and full downstream
rebuild must both succeed before Apply; canceled, invalid and stale drafts leave
history unchanged. IDs, ownership and timeline ordering survive one undoable edit.
Operation and downstream previews run sequentially to stop on a failed operation
and avoid retaining two live OpenCascade workers; this adds latency on larger
projects. Native acceptance also repairs a failed first Revolve with no published
body, so repair does not depend on an old successful output mesh.

### Fillet and Chamfer feature editing

Edit Feature supports unsuppressed Fillet and Chamfer replacements with native
operation-stage and downstream validation. Size, original distance-extrusion owner,
supported edge role and source entity are editable. Features with multiple edge
references expose an explicit reference selector; changing one reference preserves
the others. Owner choices use the native timeline stage before the selected feature,
so the feature's own treatment and future bodies cannot contaminate the choices.
Cancel, invalid sizes, lost/changed edges and stale projects cannot Apply; valid
edits retain IDs and timeline order in one undoable history entry.
Arbitrary BRep edge picking and new post-boolean topology roles remain unavailable.

### AI component generation

A collapsible bottom drawer offers plain-text descriptions, provider/model choices
for Anthropic/OpenAI/Google AI, bounded recent conversation, native preview and
Apply/Cancel. Provider credentials are read only by a loopback-only, same-origin
Node gateway in Vite development/preview; browser/project data never contain keys.
Static deployment reports a missing AI service without changing ordinary CAD.

AI recipes support rectangle/circle/polygon/line-arc wire and flat compound profiles, plus point
sketches for native Hole patterns (up to 64 centers), signed origin offsets,
distance/through-all/positive-to-face extrudes, recipe-owned unmodified cap/straight-side
planes, coplanar origin-axis revolves, explicit Cut/Join
targets, and supported entire extrusion-cap fillets/chamfers. At most 24 numeric
parameters and 32 chronological steps are accepted. Recipes are validated as data,
compiled through immutable document helpers and native-rebuilt before Apply.
Applied geometry adds a separate component and namespaced editable parameters in
one undo step; other parts are preserved. Malformed, unsupported, incomplete,
stale, canceled or failed geometry cannot Apply. Project/component replacement,
sketch editing and file operations invalidate in-flight proposals.

The selected provider receives only the description and recent AI turns. No
project geometry or runtime resources are sent. Create mode does not edit existing parts,
create unrestricted profiles, assemblies, loft/sweep/shell/thread geometry, or STEP.
Deterministic browser tests isolate provider responses while requiring actual
native BRep geometry, parameter edits, save/open/STL and stale-result rejection;
live-provider verification is separate from reproducible release checks.

AI task selection also supports existing-component parameter edits. Context is
limited to independent mm/deg parameters used exclusively by the active component;
transitive sharing, locked/derived/unused parameters and arbitrary feature changes
are rejected. Before/after values and a full native project preview precede one
undoable Apply, preserving durable IDs and bindings. Other components' dependent
face references are rebuilt. Empty/no-change edits require clarification; stale
and failed geometry retain the same Apply guard as component creation.
Proposed numeric mm/deg values can be edited locally before Apply. Explicit native
re-preview uses the same immutable frame and geometry gate without another provider
call; units, parameter names and recipe operations cannot be changed by these
controls. Any dimension edit immediately disables the previous Apply result.
AI polygon/wire profiles use at most 32 shared vertices with explicit outgoing
line/arc edges; points-only sketches support native Hole features with up to 64
indexed centers and explicit live body targets. Arc radius/winding, closed profile,
pattern participation and exact native geometry are validated before Apply.
The drawer displays up to 16 local conversation turns with summaries/assumptions.
Provider context is bounded to three complete recent turns and 32000 UTF-8 request
bytes, dropping only whole older turns with a visible notice. An oversized latest
proposal blocks follow-up with local-edit/reset guidance. Preview diagnostics can
be included in a reviewed next description; no automatic retries incur provider calls.

### AI sketch design intent

Generated rectangles have centered, fully constrained driving width/height dimensions;
circles have fixed centers and driving radii. These durable dimensions appear as
editable D labels in the sketch canvas. Polygon/wire/points recipes may supply up to
64 constraints and 64 driving dimensions using authored point/boundary-curve indices.
The existing solver rejects conflicting, redundant and lost references before native
preview; ordinary graphical edits, parameter bindings and project persistence apply.
Automatic rectangle/circle intent cannot be combined with duplicate explicit intent.

### AI profiles with inner openings

Compound recipes support one outer rectangle/circle/polygon/line-arc wire with
1–8 separate closed inner loops in the same sketch, within a 64-point total budget.
The detected material region must preserve every authored boundary and exclude
every requested opening; outside, overlapping, touching and nested-island contours
fail with diagnostics. Native sleeve, rectangular spacer and island-pocket volumes,
YZ orientation, parameter edits, stable profiles, save/open and positive STL volume
are covered. Circular outers are limited to circular openings. Per-loop automatic
rectangle/circle intent remains durable; cross-loop indexed intent is unavailable.

### AI face planes and to-face termination

AI sketches can reference earlier, live, unmodified distance New Body extrusion
start/end caps and indexed straight outer sides in their own recipe, with signed
normal offsets. Positive To Face extrusion uses the same supported stable face IDs
and validates finite target coverage and holes through the native kernel. Native
cap-boss and straight-side joins, to-face volume/orientation, upstream edits,
explicit lost-plane repair preserving geometry/IDs, save/open/STL, oversized targets
and missing material under target holes are covered. Curved and inner-loop sides,
modified/revolve/modifier owners, forward references, arbitrary existing-project
face picks and negative/symmetric To Face are diagnosed or unavailable. References
remain ordinary durable plane/topology data and use existing manual repair controls.

### AI acceptance corpus and provider checks

Nine named mechanical prompts share bounded recipe fixtures and independent analytic
volume/body-count/coordinate-span oracles. Provider transport decoding and durable
round trips cover all nine through Anthropic, OpenAI and Google response formats.
Native browser cases verify WebAssembly BRep validity/volume and actual rendered
WebGL meshes on Chromium, Firefox and WebKit; the plate case includes parameter
editing, undo, save/open and positive STL volume. Default Chromium release checks
include this corpus; CI additionally runs Firefox and WebKit.
Opt-in live checks use the ordinary loopback gateway and existing configured models
for a hollow sleeve and face-mounted boss per provider, at most six requests with
no retries. Geometry/orientation/rendering and one-step Apply are asserted. Without
`PLAINCAD_LIVE_AI=1` they skip before requests; missing keys skip per provider. Live
nondeterministic/API-dependent checks stay outside release gates and CI. This
coverage establishes these bounded workflows, not unrestricted CAD or complete
browser compatibility across every feature.

The October 5, 2026 live run passed both prompts with Anthropic and Google and the
sleeve with OpenAI (five of six cases). OpenAI's face-boss response used an invalid
identifier and was rejected before Apply. Identifier rules are now explicit in
provider instructions; that prompt refinement has not been retested live. These
results do not establish deterministic provider reliability.

### Focused and Full workspace layouts

Focused is the default presentation, with an empty-project Draw/Describe/Example/Open
start surface, compact Parts/History controls, and a selection-driven or explicitly
chosen Details panel. Empty timeline controls and unrelated inspection panels are
hidden. All tools opens the existing command palette; ribbon, palette and start
actions retain shared command enablement. Issues remain linked from the workspace
bar. Full workspace preserves the complete CAD UI, and individual panels can be
pinned. At compact widths only the chosen Parts/Details sheet is exposed.
Layout/pins/expansion persist locally with bounded preference validation and
storage-failure handling, outside project JSON/history. Hidden panels stay mounted;
layout changes do not discard form drafts or native model state. AI provider/model
controls move into AI settings, collapsed initially in Focused layout.
Native browser acceptance covers mouse sketch→extrude→cut→parameter edit→save/open→STL
in Focused layout; UI checks cover persistence, command access, keyboard focus and
compact layouts across Light/Dark/Saturn themes. The built app checks the Focused
example/edit/export path under production CSP. Existing detailed CAD acceptance
explicitly uses Full workspace. Distance extrusion handles and protected project-file
drops and contextual AI scopes/local edits are implemented within their documented
limits. Further operation drops remain planned.

### Direct and precise sketch controls

Visible Select/Line/Rectangle/Circle/Arc tools support existing click drawing plus
rectangle/circle mouse drags. Inline width/height/diameter drafts accept project-unit
bare numbers, explicit lengths and parameter expressions. A sized primitive and
its driving dimensions commit as one immutable history edit; sized rectangles
retain horizontal/vertical constraints. Selection inspects solved line/curve
measurements; reference sizes become driving only on explicit apply. Existing D
labels edit their dimension IDs and preserve expressions/units. Stale inline edits
are rejected. Dimensions remain on by default; Focused layout mutes unselected
labels and shows relevant or failing constraint markers, with all controls/lists
available through disclosures. Failed/pending dimensions remain unavailable and
repairable. Top/Front/Side plane buttons show axes/normals and retain native plane
hover previews. Precision and advanced controls remain expanded in Full workspace.
Select points/lines/circles/arcs (including construction geometry) on the canvas or
item list; Delete/Backspace or the visible delete button removes the selection.
Point deletion cascades to attached curves. Deleting geometry removes its unused
endpoints and centers; shared points, surviving dimension/constraint references and
hole centers retain their IDs. Unrelated standalone points remain intact.
Dependent dimensions/constraints are removed in one undoable edit with an impact
count. Invalid sketches remain deletable; stale selections and typing are protected.
Downstream profile references remain explicit and fail when their profile is lost.
Native acceptance covers mouse drags/cancellation, precise XY/XZ/YZ dimensions,
BRep validity/volume/orientation, inline edits, undo/redo, save/open and STL on
Chromium, Firefox and WebKit. The built app covers precise XZ dimensions, native
volume and STL orientation under production CSP.
New snap types and sketch camera gestures remain planned; existing
snap, grid, pan/zoom and advanced editing modes retain their supported limits.

### Project-file drops

One `.pcaddoc` or `.json` file can be dropped onto the workspace to open it through
the existing import limits, validation and migrations. A nonempty current project
gets a replacement confirmation with keep/save/open options. Invalid files,
multiple-file drops, active tasks and stale import/confirmation contexts leave the
current project intact. Native browser acceptance covers parameter edits, save,
reopen and STL after a drop. Part append and assembly placement remain unavailable.


### Sketch multi-selection and bulk deletion

Shift-click toggles point/line/circle/arc items. Left-to-right box selection keeps
fully contained curves and standalone points; right-to-left selects crossings.
Shift-drag toggles box hits. Curve support points are excluded from boxes so
adjacent curves are not accidentally deleted; direct point selection and Select
All retain explicit point-deletion behavior. Bulk Delete/Backspace removes the
selected geometry and dependent dimensions/constraints in one Undo edit. Unused
endpoints/centers are cleaned; shared points, surviving references and Hole centers
remain. Busy, stale document/session/component and typing contexts are protected.
Native browser acceptance verifies whole-shape deletion without leftover dots,
Undo/Redo, exact solid geometry, save/open and STL.

### Extrusion distance handles

Native Distance Extrude creation/edit previews include a perspective-aware axial
arrow and keyboard distance control (1 mm, Shift 10 mm). Positive/negative and
symmetric total-span semantics match typed input on XY/XZ/YZ. Drag values are
explicit mm at 0.001 mm resolution. Parameter/formula-bound values disable dragging
with an explanation; Through All/To Face remain typed/target workflows. Unfinished
gestures cancel on Escape, pointer loss, focus loss, resize or unmount. Pending,
invalid and stale previews cannot Apply. Native tests verify exact volume,
orientation, one Undo, binding protection, save/open and STL.

### Contextual AI intent routing

Explicit New part / This part / Selected feature chips determine edit scope.
Thickness intent targets a selected distance Extrude or a unique eligible
component thickness parameter; ambiguous targets require a user choice. Shared,
locked and derived values are excluded. Exact mm/deg edits can prepare local
native previews without provider availability; numeric refinements send no API
request. Unsupported/mismatched requests diagnose, while other bounded proposals
retain provider validation. Display-only numeric preview context is excluded from
provider conversation history. IDs, native operation/downstream checks, one Undo,
stale-frame protection, save/open and STL are verified for Extrude/Hole/Revolve
and component-parameter edits. This does not implement arbitrary direct modeling.
