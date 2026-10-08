# Working CAD Capability Matrix

## Component reuse and interoperability

- **Placed-component projections:** New schema-17 links project retained native cap boundaries in world coordinates into parallel placed sketch planes. Source/target movement updates linked geometry; legacy links preserve their authored-coordinate behavior. Oblique, lost or unsupported references diagnose and block Apply. See [projection scope](SKETCH_PROJECTION.md).
- **Component alignment:** Move component can match native endpoints, straight-edge midpoints/directions, or supported planar face planes with signed clearance. Preview/Apply saves a static rigid pose in one Undo step; curved/general boolean topology, collision avoidance and assembly joints remain unavailable. See [alignment scope](COMPONENT_ALIGNMENT.md).


## Docked Workbench workflow improvements

- Native cap-edge eligibility uses bounded, handle-free exact-input proof reuse.
  Changed source identities, geometry and boolean tools invalidate the relevant
  signature; unsupported histories are rechecked. A 40-body fixture verifies
  unchanged native geometry, dimension-edit invalidation and disposal.
  Native feature output reuse is also implemented in a bounded worker-owned cache.
  See [incremental rebuild scope](INCREMENTAL_NATIVE.md).
- Click-to-measure offers current analytic authored cap edges/endpoints and
  native-validated planar faces, plus visible solved sketch geometry. Point pairs,
  straight-edge angles and planar-face angle/separation are supported. General
  BRep topology and arbitrary curved-distance pairs remain unavailable.
  See [click measurement limits](CLICK_MEASURE.md).
- Schema 15 linked projections copy complete retained authored distance-extrusion
  cap boundaries into parallel origin/offset/supported face sketches. Stable
  members follow source dimensions, with explicit role repair, break-link and
  whole-projection removal. Native survival is checked at the consuming sketch's
  timeline position. Oblique, fragmented and new boolean boundaries diagnose.
  See [projection limits](SKETCH_PROJECTION.md).
- Schema 14 associative linear/circular feature patterns repeat an upstream
  single-center Hole or finite-distance Cut Extrude, preserving source dimensions,
  signed direction and saved body scope. Count 2–32 includes the source; circular
  360-degree layouts avoid a duplicate endpoint. Overlaps and no-op/missing cuts
  diagnose; native outputs publish atomically. See [pattern limits](FEATURE_PATTERNS.md).
- Reusable-part insertion copies all source components or one explicitly chosen
  component with its saved placement through the safe import codec, with independent
  parameter names/bindings and remapped geometry/profile/topology identities.
  Outside-scope dependencies, missing references, stale tasks and combined
  portable-file/resource excesses reject insertion. Saved rigid placement is supported; joints and linked
  external designs remain unavailable. See [insertion limits](REUSABLE_PARTS.md).

- Task guidance uses current worker sketch profiles/diagnostics and distinguishes
  empty/open/closed/broken sketches, failed rebuilds and native/fallback solids.
  Disabled actions show prerequisites; diagnostics retain explicit source repair.
- Empty-project Draw creates a named component and its first sketch atomically
  after plane confirmation. Describe names a transient AI proposal; only validated
  Apply publishes it. Cancel edits nothing and retains the starter name in session.
- Extrude/Revolve/Hole/Fillet/Chamfer use shared Selection/Settings, native status,
  Advanced options and Cancel/Apply controls. Recognized legacy profile aliases
  remain valid and retain their authored IDs; lost profiles require explicit repair.
- Solid labels expose authored feature fields, evaluated values, formulas and
  affected features, opening a compact native editor with explicit shared-parameter
  versus feature-formula edits. Native operation and downstream preview must pass
  before Apply; stale snapshots and worker responses cannot publish changes. No arbitrary BRep or
  bounding-box dimension editing is inferred. See [supported fields and limits](SOLID_DIMENSIONS.md) and
  [inline edit semantics](INLINE_SOLID_DIMENSIONS.md).
- Default Workbench production acceptance covers all five native editors through
  save/open/STL under CSP plus keyboard docks, themes and compact navigation.
  A [human usability pilot protocol](WORKBENCH_VALIDATION.md) is prepared; human
  sessions and comprehensive accessibility audits remain unperformed.

- Finishing a new unmodeled sketch in Workbench opens thickness preview directly
  for one origin/offset-plane region. Multiple regions and face sketches retain a
  source-scoped chooser; selection and Make solid open Extrude, and Apply creates geometry. Existing modeled sketches and Full layout retain
  ordinary Finish behavior unless a guided face-pocket sketch is active. See [handoff limits](SKETCH_SOLID_HANDOFF.md).
- Sketch mouse tools support view-only Space/middle panning, visible Move/Translate/
  Deform, finite analytic intersections and external-anchor tangents; Alt bypasses
  snapping. Curve candidate work is bounded and snaps add no implicit constraints.
  See [mouse limits](SKETCH_MOUSE.md).
- Local AI refinement supports exact rectangle sizing and selected horizontal/
  vertical lines. Ambiguous, conflicting and parameter-bound geometry gets a clear
  diagnostic. Apply follows solver/profile validation and native downstream geometry
  when solids exist. See [refinement limits](SKETCH_REFINEMENT.md).

- Analytic line/arc/circle Trim and line/arc Extend stage a solved/native downstream
  preview and one undoable Apply. Circles have no Extend endpoint. Protected intent,
  actual overlapping spans and no-op/tangent edits are diagnosed. See
  [trim/extend limits](SKETCH_TRIM_EXTEND.md).
- Selected-geometry relations offer matching Horizontal/Vertical, Coincident,
  Parallel/Perpendicular and Tangent actions with conflict/local-freedom diagnostics,
  native downstream proof and stale-selection rejection. See
  [contextual relation limits](CONTEXTUAL_SKETCH_CONSTRAINTS.md).
- Draw on face → Draw here → Finish → Remove material guides cap/straight-side
  pockets with explicit inward target locking and changed exact native volume.
  Curved/lost faces and modified references that fail native validation remain
  unavailable. See [pocket limits](FACE_POCKET.md).
- Opt-in conversational sketch edits use Anthropic/OpenAI/Google structured data,
  explicit binding policies and bounded context, then the same local planners and
  native downstream preview. Local refinement remains the default. Provider
  suggestions cannot publish scripts or arbitrary documents. See
  [conversational editing limits](SKETCH_REFINEMENT.md).
- Automated editing accessibility checks cover compact/reduced layout space,
  named public controls, keyboard cancellation/focus and validation semantics.
  These do not establish whole-app conformance, screen-reader speech, actual
  browser/OS zoom or human usability. See [audit scope](EDITING_USABILITY_AUDIT.md).

- Mirror and linear pattern create independent ordinary primitives with new IDs,
  remapped supported internal constraints/dimensions and shared parameter bindings.
  Cross-selection intent and ambiguous profile repair are diagnosed. They are not
  associative pattern features. See [copy limits](SKETCH_MIRROR_PATTERNS.md).
- Outline Offset creates convex authored-line or analytic-circle copies. Polygon
  distance uses literal lengths and solved snapshots; circles can retain matching
  source/distance expressions. Concave, mixed-arc, open or collapsed outlines
  diagnose. Existing holes require explicit outer-only scope. See
  [offset limits](SKETCH_OUTLINE_OFFSET.md).
- AI feature additions append bounded holes, pockets and supported cap treatments
  on one explicit current face/body, after consent, operation-by-operation native
  validation, full native preview and one Apply. Existing parameters/features are
  preserved. No general direct modeling or arbitrary topology is inferred. See
  [AI addition limits](AI_FEATURE_ADDITIONS.md).

## Review scope

Reviewed against source and automated tests on 2026-10-06. This is the current
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

## Docked workbench UI

The default layout has Project/Parameters tabs on the left, one Task/Properties
panel on the right, and mutually exclusive History/AI/Issues below. Its context
toolbar shows Draw, Solid or Inspect. Native Extrude/Revolve/Hole/Fillet/Chamfer
previews occupy the center with Apply/Cancel controls in the right task area;
background commands remain inert while a native modal task is pending. Sketch
controls replace the ordinary right dock. Docks close/reopen and resize by pointer
or keyboard; bounded preferences are browser-local and excluded from CAD files.
Search filters component/sketch/current-body names. Light, Dark and Saturn share
locations and behavior. Minimal and Full layouts remain compatible options.

`e2e/workbench.spec.ts` verifies real mouse geometry, graphic dimensions, distance
handle edits, stale/invalid preview gating, exact native volume and positive XY
orientation, portable save/open and positive STL volume (curved tessellation within
0.01% of native volume), plus retained form drafts, search, themes and compact dock
visibility. This layout does not add free-floating/redockable windows, arbitrary
solid dimension handles, unrestricted topology picking or new kernel capabilities.
See `DESIGN_SYSTEM.md` and `design-qa.md` for design rules and comparison evidence.

## Implemented foundations

- React/Vite/TypeScript UI, Three.js viewer, Zustand document history and undo/redo.
- Serializable document with stable IDs, deterministic JSON, schema migrations
  through version 16, and validation before imported state is accepted.
- Import unsafe-key rejection, nesting/node limits, and component/parameter/sketch/entity/
  constraint/feature count limits; unknown and runtime fields stripped by migration.
- Local project files contain a root component and up to 99 additional internal
  components with stable ownership of sketches/features/bodies. Browser activation,
  component naming, Create Sketch → origin plane → canvas → Finish Sketch → Extrude,
  undo/redo, legacy migration and native save/open/STL are covered. Modeling targets
  and source sketch choices are scoped to the owning component. Components have independent saved rigid placement;
  the parameter table and timeline remain project-wide.
  Saved rigid placement is supported. Nested assemblies, joints and linked external components are unavailable.
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
| Hole | Up to 64 explicit saved target IDs and 64 sketch point centers; native aggregate cylindrical tools; every center must cut some target, every target must lose exact volume; atomic output publication; positive blind depths or through-all, with positive/negative sketch-normal direction; empty/duplicate/lost centers/targets and no-op cuts diagnosed | Native preview-and-Apply creation and editing; fresh upstream choices, separate edited-operation/downstream checks, source/center/target repair, stable IDs and one undo; direct repair inspector |
| Fillet/chamfer | Real native geometry on feature-owned cap perimeters, individual complete line/arc/circle cap edges, or a source line’s two extrusion-direction corners; BRep/solid-count/volume-or-surface-change checks; retained authored edges also work after native booleans; grouped perimeters require every original edge and exclude new Cut/Join edges; lost/trimmed/ambiguous edges fail | Native preview-and-Apply creation dialogs with size/role/source/owner choices; repair inspector |
| Offset/face sketch planes | Expression-driven origin/face offsets; upstream distance-extrusion caps and straight outer sides; retained native faces after Cut/Join supported at the sketch’s timeline position; removed/split/ambiguous/suppressed/missing faces require repair | Create Sketch with signed expression-driven origin/face offsets; Sketch tools with explicit replacement selection; lost planes fail rebuild |
| STEP | Optional adapter interface only; no implemented exporter | Hidden |

Failed operations retain upstream preview bodies but fail rebuild and disable STL.
Downstream modifiers on a failed body are blocked. Suppression permits recovery.
Native modeling results include runtime-only validity, exact volume/surface area, and solid-count
assertions; these are never saved in project JSON. Splitting a body by a cut may yield
multiple valid solids in one stable target-body compound. Empty cuts fail explicitly.
Only retained authored edges/cap perimeters can survive supported boolean
modifications. Treatment chains may select remaining cap perimeters or unchanged
source edges; changed, trimmed or missing boundaries require explicit reselection.
The operation-token picker uses native proofs of original sharp cap boundaries
on extrusion or supported Cut/Join results. Whole-cap groups require every
original edge; arbitrary transient BRep edge picks are unavailable.

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

- Schema 1–13 checked-in fixtures migrate, rebuild, retain IDs, edit dimensions,
  round-trip project files, and recover through the same import codec. Production
  Chromium imports the entire released corpus under CSP and verifies native BRep
  volume/solid count, thickness edits, saved feature/entity/parameter IDs, save/open
  intent and STL signed volume/global bounds. This corpus is a rectangular body
  with a through-hole, including an inward end-cap hole in schema 13; it does not
  cover every historical feature combination.
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

## Viewport fitting

- Fit considers the narrower camera frustum dimension and complete body bounds.
  Auto-fitted and explicitly fitted 3D/preview views refit on canvas resize. Manual
  camera gestures and restored named poses keep their framing until explicit Fit.
  Compact layouts retain a visible model Fit action; native previews have their
  own Fit button and camera. Fitting changes no CAD geometry or history.

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
termination references and Hole drilling direction are retained; changed fields
use literal mm/deg values and
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
flat parts with optional saved rigid placement; joints are unavailable.


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

In **New part** scope, the selected provider receives only the description and recent AI turns. No
project geometry or runtime resources are sent. Create mode does not edit existing parts,
create unrestricted profiles, assemblies, loft/sweep/shell/thread geometry, or STEP.
Deterministic browser tests isolate provider responses while requiring actual
native BRep geometry, parameter edits, save/open/STL and stale-result rejection;
live-provider verification is separate from reproducible release checks.

**This part** scope supports existing-component parameter edits. Context is
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
explicitly uses Full workspace. Distance extrusion handles, project-file drops,
guided face holes and contextual AI scopes/local edits are implemented within the
limits in their sections. Guided repair/save/export, clearer pointer snaps,
eligible operation placement and AI candidate-solid hints are also implemented
within their documented bounds; broader arbitrary interactions remain planned.

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
reopen and STL after a drop. Independent part append and rigid component placement are supported; joints remain unavailable.


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

### Guided face holes

**Place holes on face** accepts supported retained native distance-extrusion caps
and straight side faces in the active component. Viewer picking and named face
buttons lead to a face-local drawing; pointer centers use 0.001 mm precision and typed
coordinates accept lengths/parameter expressions. Actual coplanar mesh triangles
reject centers outside the face and inside openings; guided circles must also
clear boundaries/openings and not overlap one another. Opening and other tessellated
contours add the native deflection allowance (currently 0.5 mm); outer cap segments
matching authored straight profile edges retain exact clearance, including small
and tangent holes. Side-face and other unproven boundaries remain conservative.
Native preview validates the inward blind/through-all cut on one explicit target, before the point sketch and
Hole are committed together in one Undo edit. Centers are removable. Cancel and
stale document/session/component/selection/rebuild/file-job contexts cannot apply.
Schema 13 persists direction; migration preserves earlier positive-hole geometry.
Existing Hole editing retains direction, with direct direction repair in Inspector.
This is a guided face-to-hole task, not free-form operation dropping or assembly
placement. Native XY/XZ/YZ tests verify exact cut volume, cavity depth/orientation,
parameter edits, Undo/Redo, save/open and STL; all schema fixtures remain covered.

### Contextual AI intent routing

Explicit New part / This part / Selected feature chips determine edit scope.
Thickness intent targets a selected distance Extrude or a unique eligible
component thickness parameter; ambiguous targets require a user choice. Component
parameter edits exclude shared, locked, derived and unused values; selected-feature
field edits preserve project parameters and unchanged bindings. Exact mm/deg edits
can prepare local
native previews without provider availability; numeric refinements send no API
request. Scope/selection changes trigger no provider request. Scope-specific next
action hints, readable generated-parameter labels, explicit targets and before/after
values are visible. Simple contradictory thickness/size wording asks for
clarification; explicit absolute set requests and user-chosen fields remain
authoritative. Unsupported/mismatched requests diagnose, while other bounded
proposals
retain provider validation. Display-only numeric preview context is excluded from
provider conversation history. IDs, native operation/downstream checks, one Undo,
stale-frame protection, save/open and STL are verified for Extrude/Hole/Revolve
and component-parameter edits. Ambiguity choices trace authored dependencies to
current live solids and name an unambiguous authoring sketch; **Show geometry** is a
transient hint and **Change** explicitly chooses the bounded dimension. Highlighting
preserves document, selection and history, clears on context/rebuild/busy changes,
and never calls a provider. Shared, locked, derived and unused component values
remain excluded. Several fields of one feature share related solids; no exact
face/edge/axis or general semantic dimension inference is claimed. Missing related
geometry diagnoses without widening the current edit context. Chromium verifies
two independent native solids' rendered highlight IDs, an explicit one-parameter
edit with exact volumes and one Undo, and zero provider calls. This does not
implement arbitrary direct modeling.

### Guided issue repair

Source-linked diagnostic cards open parameter/feature controls and select reported
sketch dimensions/constraints in the drawing. Upstream feature target body
highlights are transient, filtered to current meshes, and do not modify history.
Lost face/edge references still require explicit supported replacement; no arbitrary
reference guessing is performed.

A single connected, unbranched open outline of 2–256 non-construction line/arc
segments can propose a straight edge between its two open endpoints. The drawing
shows both endpoints and a dashed proposal before **Add missing closing edge**
becomes available. The explicit edit must solve and produce valid closed profiles,
preserves existing IDs/design intent, and creates one Undo step. Branches, multiple
chains/loops, circles, solver failures and invalid closing geometry require manual
repair. Cards bind the exact document/session/result and reject stale or competing
tasks. Native Chromium coverage proves endpoint highlighting, conflict-dimension
selection/deletion, Undo/Redo, real solid volume, save/open and positive STL volume.

### Guided save/export task

**File → Save or export…** distinguishes editable project saving from printable
STL, defaulting to the editable project. Saving retains design intent and does not
require successful geometry. STL still requires a successful current rebuild and
bounded mesh validation. Its explicit body/component checklist defaults to all
bodies independently of visibility; selected/visible shortcuts change that checklist
explicitly. Counts and one-STL versus separate-file ZIP output are explained.

Advanced STL options retain separate files/shells/native union and all existing
topology, winding, resource and float32 validation. Original failure messages remain
visible with bounded repair advice and source-feature navigation when identifiable.
Exact document/session snapshots reject edited or replaced guided tasks; file and
modeling tasks, including scope capture, must finish first. Native acceptance proves
body subset/global placement, exact volume, parameter edits, save/open, separate
ZIP output and stale-task rejection. No new file formats or saved export settings
are introduced.

### Pointer precision snapping

Mouse drawing can snap to existing points, line midpoints, true arc-sweep
midpoints, and circle/arc centers, with labeled markers and horizontal/vertical
alignment guides. Existing points take priority. Proximity uses screen-space
pixels on both axes and follows the sketch view, including nonuniform scaling.
Use **Geometry snaps** to disable midpoint/center/alignment inference. Existing
points, including stored circle/arc center points, still snap when inference is
disabled. **Snap** controls the existing grid behavior.

Snapping places pointer-drawn geometry without adding automatic constraints or
changing authored expressions. Typed coordinates, point moves, translation and
solver deformation retain their existing behavior. Tangency and intersection
snapping are not implemented. Native acceptance verifies precise pointer placement,
preview cancellation, rebuild geometry, save/open and STL export.

### Drag operations onto supported geometry

Extrude, Fillet and Chamfer tokens accept drag, viewer clicks or keyboard target cards
through one command workflow. Turquoise overlays identify eligible geometry;
yellow hover feedback stays in fixed space so target cards do not move during a
pointer gesture. Choose a target, inspect the native preview, then explicitly Apply.
Cancel changes no project data; Apply retains one Undo step.

Extrude accepts current closed sketch regions in the visible active component.
Fillet/Chamfer drop targets require native distance/new-body Extrude owners and
their original start/end cap-perimeter groups or individual unchanged authored
line/arc/circle cap edges. Native matching permits retained edges after Cut/Join.
Groups require every original edge to survive; individual targets require a
single-edge sharp contour for both treatments. Contours that propagate beyond
original cap boundaries are excluded. Individual viewer picks take precedence
over the coincident whole-cap group; an exact keyboard card resolves ambiguity.
Split/trimmed edges, boolean-created topology, vertical sides and smooth or
ambiguous boundaries are unavailable. Final Fillet/Chamfer body results and
Revolve/to-face origins are excluded from this picker. Ambiguous or detailed targets can
be selected by their exact card. At most 128 targets are offered; viewer overlays
pre-bound sampled vertices to 8192 per target and 65536 total.

Picking and Apply bind the exact document, project session, component and native
source result. Competing modeling, guided save/export, STL and repair tasks are blocked until
the operation is applied or canceled. Unsupported picks give a diagnostic. Native
acceptance covers actual profile drag and cap picking on XY/XZ/YZ, changed BRep
volume, undo/redo, parameter edits, save/open and positive signed STL volume.

## PNG image downloads

File and command search offer the current 3D project view, a selected body alone,
and the open sketch drawing. The sketch header also offers PNG download. Project
images preserve current camera/visibility/section previews and Three.js sketch
overlays. Body images fit the selected native body, including hidden bodies, and
omit other bodies, grid, sketches, measurement overlays, highlights and clipping;
live view state is restored immediately. Sketch images rasterize the actual SVG
with computed theme styles and visible dimensions/constraints, excluding pointer
feedback. Application chrome and HTML 3D dimension controls are excluded.

Images are bounded to 4096 pixels per side. Viewer exports require a current
successful native rebuild; sketch exports require a current valid solved drawing
without an unfinished gesture. Asynchronous downloads reject document/session or
3D result changes and honor cancellation. Native Chromium acceptance validates
geometry, PNG decoding/nonblank pixels, dimension visibility, hidden-body export,
and unchanged camera/visibility/clipping/history. The built-app CSP suite exercises
all three scopes without widening its image policy. Unit tests cover stale/canceled
jobs, encoding failure, command availability, session replacement and size limits.

## Success feedback and parameters

A successful build with only sketch degree-of-freedom notices has no Issues badge.
Those notices remain available under Optional sketch guidance. Other warnings,
errors, and worker failures remain actionable issues. Parameter readouts explicitly
label previous values stale while updating, clear invalid values, and reset across
project sessions. Names wrap in full; Rename opens the name editor deliberately.
Native acceptance covers a free rectangle, valid/invalid edits, held worker delivery,
export availability, and same-ID project replacement.

## Part identity and isolation

Presentation names follow component ownership without changing document/body IDs
or feature history. A child component with one body uses the component name;
multiple bodies include their body names. Duplicate labels and safe-filename
collisions are resolved in stable ID order against the full model, so selected
exports match ZIP member names. Root-component bodies retain legacy names.
Exit isolation restores body/component visibility while preserving sketch visibility.

## Rectangle drawing and dimensions

The main Rectangle command opens/updates the current sketch canvas with explicit
corner or center creation modes. Typed dimensions author ordinary driving
dimensions; center mode mirrors corners around the picked center and saves a
construction diagonal, midpoint constraint and fixed center support.
Draft sizes appear in the properties panel outside the drawing surface; the panel
stacks below the drawing on compact screens. Newly drawn Center rectangles keep
the chosen center during size changes; parameter-bound snapped centers remain
associative. Older rectangles retain their original constraints and free Corner
rectangles keep their positional freedom. Explicit validate-only sketches require
Corner mode or a new driving sketch. Deleting a centered rectangle removes only
its owned support geometry, preserving borrowed points and external references. Driving labels
remain visible/editable by default within the existing canvas-label limit. Reference labels are selection-based by default, with
a Show reference measurements opt-in. Existing advanced fixed presets remain.
Native workflows verify both creation modes, exact bounds/volumes, inline sizing,
reference visibility, undo/redo, project round trips and STL.

## Model and Render presentation presets

Public viewport and Views commands switch temporary presentation state without
editing the durable document, history, camera or part visibility. Each preset
remembers independent grid/edge choices until project replacement; Model defaults
show both and Render defaults hide both. Render also hides axes, sketch/measurement
and driving-dimension overlays and selection colors, while native body picking remains
available. Existing native positions, normals, triangulation and body IDs are reused.
A fixed hemisphere plus key/fill/rim lights and material appearance provide studio
shading with no textures, shadows or ray tracing. The demand renderer, movement DPR
and cached buffers remain in use. Project/part PNG captures use the active preset at
full resolution and restore temporary capture state. Native browser checks cover
buffer identity, idle frames, camera/picking, parameter rebuilds, save/open, PNG and
STL; a production CSP check compares changed PNG pixels and byte-identical STL.

## Simplified fabrication task

Save/export keeps the header and primary Save/Generate/Download plus Cancel actions
outside independently scrolling options. **Output files** is always visible for
STL, defaulting to **One file per part**. Advanced numerical checks describe their
actual scope: separate files validate each part without checking overlaps between
files; a file with separate shells can check cross-part overlaps; native union
requires full self-intersection validation and may retain disconnected solids.
Document/session/rebuild checks still reject obsolete tasks. Compact/desktop native
acceptance covers reachable footer actions, ZIP placement/volume, and stale tasks.

## Compact Parts browser

Part rows separate expansion from activation, expose visibility inline, and keep
isolation/rename in a dismissible contextual menu. Empty root groups are omitted;
authored features still count while geometry rebuilds. Search expands matching
descendants and resets when replacing a project. Current-document filtering keeps
obsolete rebuild body IDs out of the tree. Native tests cover activation,
visibility, isolation, search, nested components and compact layout.

## Clear canvas and direct sketch completion

The starter question card is removed. A collapsed **New part** menu above the
canvas retains named Draw/Describe, example and Open actions. It dismisses on
Escape/outside interaction and resets with the project session.
Workbench Finish Sketch opens thickness preview for one unambiguous region on
an origin/offset plane, after current worker analysis succeeds. Multi-region and
face sketches retain explicit selection and Add/Remove choices. Existing-feature
sketch edits and other layouts retain their prior finish behavior. Preview
creation leaves history unchanged; Apply publishes, Cancel discards, and the
consumed handoff source cannot reopen a canceled preview. Native XY/XZ tests
verify exact bounds/volume, cancellation, save/open and STL.

## Retained native edge picking

Rebuild results carry bounded, handle-free runtime edge proofs outside project
JSON. Both treatment contours must match original sharp boundaries on the current
final body. Each probe clears contour state; a fully proven original tangent
chain is offered once as a group, avoiding repeated native indexing. Unexpected
probe failures produce source-linked warnings while preserving validated solids.
Native XY/XZ/YZ viewer picks verify changed exact fillet/chamfer volume after
Cut/Join, parameter edits, stale same-ID replacement guards, save/open and STL
orientation. Split groups, smooth seams and propagated individual targets are
excluded. The public picker remains capped at 128 filtered targets.

Edge proofs run eagerly in the geometry worker so availability belongs to the
exact current rebuild. This adds rebuild work rather than render-frame work.
The 2026-10-07 controlled small-model sample reported worker rebuild p95 117.2ms;
the 64-edge tangent-contour regression took about 1.3s. Resource checks passed,
but these workloads do not establish a latency budget for large parts. Adapters
without native edge proofs conservatively offer no targets; the shipped native
adapter implements the probe, and fallback meshes never authorize edge picking.

Validated native feature output reuse uses independently owned OpenCascade copies, with 128-entry/256-shape bounds and a 32 MiB mesh/signature estimate. Document/session/kernel changes clear ownership. Native allocation size is not measured by that estimate; exact BRep validity, volume and shape-count bounds remain authoritative. See [incremental limits](INCREMENTAL_NATIVE.md).

Schema 16 stores finite rigid component placement: translations within ±100,000,000 mm and Euler rotations within ±360 degrees. Move component offers pointer/keyboard handles and numeric fields; Apply requires an exact current native candidate with unchanged body IDs, volumes and solid counts. Completed native BReps and mesh normals/vertices are positioned together. Existing face/projection associations stay in design coordinates; new cross-component projections and face choices require matching placements. Hierarchical assemblies and joints are unavailable.

Projection source picking supports complete retained authored extrusion cap boundaries through mouse, touch and Enter/Space, with native preview before explicit Apply. It does not project arbitrary BRep edges, oblique boundaries, or components with differing placements.

Feature pattern controls offer signed spacing, circular center and sweep pointer handles on a bounded source-plane diagram. Formula replacement requires explicit consent; Escape/pointer cancellation restores the captured expression. Native previews run after release and current geometry is required for Apply.

The local part library saves one self-contained editable component with a bounded native PNG thumbnail. IndexedDB is limited to 50 entries/25 MiB with atomic writes and quota/cancellation diagnostics. Drag insertion uses the viewport ray on XY z=0; keyboard insertion starts at origin. Full candidate native validation precedes one-step Apply. Saved copies remain local to the browser, with independent inserted identities/parameters; external links, joints and automatic source updates are unavailable.
