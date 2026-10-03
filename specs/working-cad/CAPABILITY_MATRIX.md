# Working CAD Capability Matrix

Reviewed against source and automated tests on 2026-10-03. This is the current
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
  through version 11, and validation before imported state is accepted.
- Import unsafe-key rejection, nesting/node limits, and parameter/sketch/entity/
  constraint/feature count limits; unknown and runtime fields stripped by migration.
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
| Extrude new body | Positive/negative/symmetric distance native wire/face/prism extrusion of closed line/arc/circle loops and holes; symmetric distance is total span; fallback triangulates sampled boundaries | Creation command and inspector |
| Extrude cut | Up to 64 explicit saved target IDs; atomic updates of all targets; native world-coordinate tools; valid nonempty solid output with reduced exact volume; disjoint/no-op and empty cuts diagnosed; narrow rectangle/circular-through-hole fallback | Inspector |
| Extrude join | Up to 64 ordered explicit targets; atomic native connected union; first target ID/name survives, secondary targets absorbed; tool must add exact volume beyond target union; disconnected/no-op joins diagnosed; no fallback | Inspector |
| Through all | Projects all selected target bounds along the sketch normal for positive/negative directions or a symmetric total span; wrong-side targets diagnosed; subject to cut/join limits | Inspector |
| Extrude to face | Positive termination on an upstream unmodified feature-owned planar cap/straight side, including sloped faces; native half-space trimming; end-cap area/intersection checks enforce finite face and holes | Inspector with explicit face selection and repair |
| Negative/symmetric extrude | Distance and through-all supported with a shifted start plane and unchanged coordinate basis; to-face remains positive-only | Inspector; unsupported to-face combinations disabled and diagnosed |
| Revolve | Native analytic closed line/arc/circle profiles with holes; coplanar world X/Y/Z or same-sketch line axes; angles greater than 0 through 360 degrees; cross-axis/zero-volume/invalid output rejected | Shared creation command and inspector; narrow full-Y/XY rectangular fallback without kernel |
| Revolve cut/join | Native cut on up to 64 explicit saved targets with atomic publication; join merges an ordered explicit scope into one connected solid; boolean validity/volume checks | Inspector with cut/join scope checkboxes and lost-reference removal |
| Capture intersected targets | Native common-volume checks on current upstream solids and extrude/revolve/hole tools; saved IDs only; preserves an intersected join primary; ignores downstream bodies; empty/failed/stale probes leave the scope intact; face-only joins remain explicit | Shared command and Inspector button; dedicated worker with cancellation/time limit |
| Hole | Up to 64 explicit saved target IDs and 64 sketch point centers; native aggregate cylindrical tools; every center must cut some target, every target must lose exact volume; atomic output publication; positive blind-depth/through-all; empty/duplicate/lost centers/targets and no-op cuts diagnosed | Shared creation command with modal target scope and center choices; full size/termination/center/source/scope repair inspector |
| Fillet/chamfer | Real native geometry on feature-owned cap perimeters, individual line/arc cap edges, or a source line’s two extrusion-direction corners; BRep/solid-count/volume-or-surface-change checks; lost or ambiguous edges fail | Shared creation commands and size/role/source/owner repair inspector |
| Offset/face sketch planes | Expression-driven origin/face offsets; upstream distance-extrusion caps and straight outer sides; modified/suppressed/missing owners require repair | Sketch tools with explicit replacement selection; lost planes fail rebuild |
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

- Schema 1–11 checked-in fixtures migrate, rebuild, retain IDs, edit dimensions,
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
  General constraint-driven deformation remains unavailable. Native XY/XZ/YZ
  checks verify BRep volume/bounds, cancellation, parameter edits, save/open and STL.
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
  stay diagnostic. Arc/arc and circle/arc intersection fragmentation remains unsupported.
  Curved traversal is bounded to 750 source curves, 2048 fragments/contacts and
  8192 sampled graph segments; sampling classifies faces, while native modeling
  uses analytic fragments. Individual
  authored edge treatments on split lines remain diagnostic rather than rebinding.
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
- General post-boolean face/edge naming remains missing. Planes require an
  unmodified positive-distance new-body owner;
  curved side faces, hole/revolve faces, and ambiguous rebinding are unsupported.
- Canvas constraint markers cover all 11 supported types and identify current
  satisfied/redundant/conflicting/pending/lost/unavailable states. Leaders locate
  referenced geometry rather than tangency contacts. Marker/list selection supports
  keyboard inspection, ordered reference repair and undoable removal with stable
  constraint IDs; lost references remain list-only and pending markers are hidden.
  Native Chromium checks conflict recovery, missing-reference repair, unchanged
  volume through annotation/repair/removal, undo/redo, save/open and STL.
  Lists paginate at 20 entries and at most 128 anchored markers/16 leaders per
  marker render. Creation remains in Sketch tools; constraint glyph dragging
  remains unavailable.
- Dimension and constraint labels now share bounded automatic placement:
  dimension labels reserve space first; constraint labels avoid those boxes and
  point handles. Font-size estimates and 49 candidate positions bound work to
  128 labels per family. Native Chromium checks actual rendered label separation
  through group translation, zoom, parameter edits, save/open and STL. Dimension
  leaders allow pointer gestures through to geometry; relocated labels retain
  geometry leaders. Layout is transient and follows the current view. All intent
  remains accessible in selection/list controls; dense or oversized labels stay
  visible with an explicit crowded-view diagnostic. This is best-effort box
  avoidance, not guaranteed placement around every curve/leader. Direct label
  dragging remains unavailable. Remaining feature inspectors need work.
- STL validation is numerical and bounded: it does not prove absence of every
  adjacent-face or near-degenerate self-intersection. Skipping expensive checks
  is explicit. Native union remains best-effort and does not connect disjoint solids.
- Production CSP and security headers are generated from one policy source for
  static hosts and Nginx, and applied by Vite preview to HTML and workers. A built-app
  Chromium test verifies native modeling, save/open, recovery, native union and STL
  under the policy, plus blocked inline scripts, JS eval and remote fetch. Final-host
  header/MIME verification remains a deployment step.
- Broader browser/kernel acceptance coverage (complex feature chains, imported
  additional imported workloads, other browsers), broader accessibility audit,
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
  counts do not prove absence of every leak. Broader workloads and production-build
  benchmarking remain open. See [method and local results](PERFORMANCE.md).

## Intentionally deferred

Assemblies/mates, CAM, simulation, sheet metal, generative design, collaboration,
cloud sync, mobile-first editing, plugins, AI generation, and general cross-feature
topological naming remain outside the working-CAD target. STEP can remain hidden
until validated support exists.
