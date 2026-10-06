# Sketch outline offset

While editing a sketch, choose **Offset sketch outline**, select a detected closed
region, enter a positive distance, and choose Inward or Outward. **Preview outline
offset** solves a proposed copy and rebuilds existing downstream features in the
native worker. The original contour is shown in muted color and the new contour in
the accent color. Review profile nesting and affected bodies, then **Apply outline
offset**. Apply creates one Undo step. Cancel, Escape, invalid input and stale
worker replies leave the document unchanged.

This command copies a two-dimensional boundary in the same sketch. The existing
**sketch-plane offset** controls where a sketch lies in three-dimensional space;
it does not copy an outline.

## Supported boundaries and design intent

- A single authored circle supports inward and outward offsets, including a
  parameter-based length distance. Matching source center/radius expressions are
  retained, and the copied radius combines its source expression with the distance.
  A single driving radius or diameter dimension supplies the governing radius when
  it matches the solved geometry. If constraints have moved the source away from
  an expression, that coordinate/radius is captured from the solved geometry.
- A convex closed polygon consisting of authored straight line segments uses
  mitered corners. Its distance accepts literal length arithmetic and bare numbers
  in the project's length unit. Parameter-bound polygon distances are rejected
  explicitly. Its solved shape and distance are captured as canonical millimeter
  coordinates in independently editable new points and lines.
- Regions containing holes require an explicit **Outer boundary only** choice.
  All existing holes remain unchanged. Offsetting a hole itself, or resizing all
  holes along with a boundary, is not supported by this command.

Both forms produce ordinary sketch entities with new IDs. All source entity IDs,
constraints and dimensions are preserved. No constraint is silently dropped and
no offset feature is added to the persisted schema. This is **not a fully
associative offset**: polygon copies do not follow later source edits; circle copies
follow retained parameter expressions but do not follow later source entity or
constraint edits. Future parameter edits that produce a nonpositive circle radius
fail the normal sketch solve rather than reporting usable geometry.

Adding nested contours changes detected regions. A previously consumed sketch may
change an existing extrusion or lose its exact referenced profile. Preview requires
a successful native rebuild for any existing active features; review that result
before accepting the copy. A standalone sketch preview establishes a solved closed
profile, not a modeled solid. Finish Sketch and extrude the ring region to create a
wall or rim.

## Explicit limits and diagnostics

Concave polygons, nonconstruction analytic arcs anywhere in the sketch, mixed or
fragmented boundaries, open outlines, crossing/touching copied contours, collapsed
inward contours and unsupported miter corners produce diagnostics. The command
does not sample arcs or trim a self-intersecting approximation. Construction
geometry remains intact and does not participate in contour-contact checks.

Polygon boundaries are limited to 64 authored edges; the sketch and resulting
copy are limited to 512 entities. Existing interactive solver limits also apply
to the combined source and copy (160 variables and 512 equations), so a constrained
or point-heavy sketch can reach its limit earlier. Coordinates and circle radii
are bounded to 100,000,000 mm, and distances/copy sizes must exceed 0.000001 mm.

The runtime draft is scoped to the exact immutable document, session, active
component, canvas session and selected entity IDs. Input changes cancel the old
preview. Same-ID project replacement, changed selection and late responses cannot
authorize Apply. A proof issued for another copy cannot be reused. Worker preview
times out after 120 seconds without adding history.

## Evidence

`src/tests/sketchOffset.test.ts` exercises closed polygon/circle geometry, clockwise
orientation, retained parameter bindings, constraints/dimensions, explicit holes,
units, concavity, construction arcs and contact/collapse diagnostics.
`src/tests/sketchOffsetPanel.test.tsx` exercises read-only preview, input
invalidation, one-step Undo/Redo, cancellation, same-ID replacement and proof
identity.

`e2e/sketch-outline-offset.spec.ts` contains real OpenCascade worker acceptance
flows for inward XY and outward XZ rectangular walls, inward/outward parameterized
circle rims, exact BRep validity/solid count/volume, coordinate orientation,
Undo/Redo, collapse/export readiness, save/open and exported STL volume. Native
execution results are recorded by the batch handoff; jsdom tests alone are not
native-kernel evidence.
