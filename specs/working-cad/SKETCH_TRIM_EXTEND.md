# Analytic sketch Trim and Extend

Open a sketch, select a curve, then choose **Trim** or **Extend**. The task also
provides a curve selector. Click the drawing or enter pick X/Y in millimeters.
Picks project onto a line or radially onto a circular support; the center of an
arc/circle cannot determine a radial pick. **Preview** solves an immutable
candidate. **Apply** adds one Undo step. Cancel, Escape, changing inputs or
changing the source document/sketch invalidates the candidate.

Trim supports lines, arcs and circles. Contacts are calculated analytically
between finite lines, finite arcs and circles, including construction geometry.
A line/arc loses the picked interval between contacts or between its endpoint and
a contact. An interior interval can leave two fragments. A circle requires two
crossing contacts: its picked cyclic interval is removed and the complementary
segment becomes an arc. The retained first fragment keeps the source entity ID;
circle conversion keeps its center ID and construction state. Existing unchanged
endpoints keep their IDs. New endpoints can join existing boundary endpoints,
but never silently attach to centers or unrelated standalone points.

Extend supports lines and arcs. Pick nearer the endpoint to extend. The nearest
finite boundary along that endpoint's continuation is selected. Arc continuation
follows its clockwise/counterclockwise circular support, with no full-turn arc or
circle conversion. Boundaries are never implicitly extended. Disjoint arcs on the same circular
support can provide finite endpoint contacts; overlapping spans are diagnosed.
Disjoint collinear lines are not crossing boundaries, and a chosen line extension
that would overlap one is rejected. A circle has no
endpoints and produces an explicit Extend diagnostic. An endpoint already meeting
a boundary, shared authored endpoints, or equal endpoint distances require an
explicit choice or reference repair.

Supported sketches contain at most 512 entities. Tangencies and near-tangent
contacts within sketch tolerance, overlapping coincident circular spans, overlapping
collinear line spans, absent crossings, picks exactly on contacts, tiny retained
fragments and unsupported full-turn extensions produce diagnostics. A whole curve
without a usable interior trim interval is not implicitly deleted: use Delete.

Constraints/dimensions affecting the target or its points, parameter-bound point
coordinates, a parameter-bound circle radius and referenced revolve axes require
explicit editing first. No design intent is silently deleted. Circle conversion
changes the profile type, so an existing circle feature profile is diagnosed as
lost rather than rebound to the arc. Every existing extrusion/revolve profile
reference must remain resolvable. Superseded unused target endpoints are cleaned;
standalone points and feature centers remain.

A sketch-only preview reports a sketch solve. When downstream features exist,
Apply requires a successful OpenCascade preview with native geometry assertions.
Worker-issued results are bound to the exact candidate. Source object identity,
document session, component and sketch session are checked again at Apply.

Pure entry point: `buildSketchTrimExtend(document, sketchId, lineId, mode, pick)`.
The legacy `lineId` argument/plan field identifies a line, arc or circle; AI actions
continue to pass their target `id`. Shared analytic helpers are in
`trimExtendIntersections.ts`. Command entry points remain `openSketchTrimExtend`,
`setSketchTrimExtendPick`, `previewSketchTrimExtend`, `applySketchTrimExtend`, and
`cancelSketchTrimExtend`. Runtime task ownership is never serialized.

Focused tests cover circle conversion, cyclic seam selection, signed arc trimming
and extension, finite curve filtering, protected references and save/load. Native
acceptance cases cover a trimmed XY semicircle and extended YZ quarter-circle,
checking exact OpenCascade BRep volume, bounds/orientation, Undo/Redo, save/open
and STL tessellation volume. Exact solid geometry distinguishes analytic arcs from
endpoint chords; STL is checked within 0.5% because it is a tessellated export.
