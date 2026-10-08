# Linked projected boundaries

Open a destination sketch created after its source extrusion, then choose
**Project edges**. Select the named part, feature and start/end cap boundary.
Choose **Construction reference only** for guides, or leave it off to create
profile geometry. **Preview projected boundary** shows the linked outline and
validates native solids before **Apply projected boundary** creates one undo step.
Cancel leaves the project unchanged.

The destination plane must be parallel to the source cap. Origin, offset and
supported face planes are accepted when their resolved normals are parallel.
New links follow source dimensions and component placement. Source cap coordinates
are transformed into placed world space, projected along the destination normal,
and resolved into the destination sketch's authored local coordinates. Downstream
features stay in those local coordinates, then receive their component placement.
Analytic circles retain their radius; arcs retain their sweep and reverse winding
when the two placed plane normals oppose. Schema 17 records `coordinateSpace: "world"`. Loading
older projects migrates without inventing links.

Only full native-validated surviving caps of earlier distance extrusions that
created a new body are supported. The 32-link/sketch and 256-member/boundary limits
bound processing. Arbitrary face silhouettes, boolean-created or fragmented
boundaries, oblique projection and arbitrary 3D curves are diagnosed explicitly.
Native checks run at the destination's timeline position rather than confusing
later geometry changes with source availability.

Linked items are read-only. Edit source parameters to update them. The
**Projected boundaries** section offers:

- **Reselect projected boundary** to repair a cap role on the same authored
  boundary while preserving generated IDs and downstream profile identity.
- **Break projection link** to retain currently solved coordinates as independent,
  editable geometry. This requires a current successful rebuild.
- **Remove projection and geometry** to remove the link and its generated items,
  including when a missing source prevents rebuilding. Generic drawing deletion
  rejects a partial linked boundary; selecting every projected curve can remove
  the entire projection and its owned support geometry. Downstream consumers may
  then need explicit profile repair.

A different source boundary has different entity identities. Remove the old
projection, project the new boundary and repair downstream references explicitly;
PlainCAD does not guess a topology mapping.

Source discovery checks a separate native preview of the upstream timeline,
which also permits repairing a failed destination. It never replaces the current
model. Preview/Apply captures project identity, session, active component,
canvas session and selection; stale or canceled proof cannot commit. Every task
competes with other sketch/model/export tasks through shared command availability.

Core geometry and persistence coverage is in `sketchProjection.test.ts`. Exact
preview ownership and selection-race coverage is in
`sketchProjectionCommand.test.ts`. Native browser acceptance is in
`e2e/sketch-projection.spec.ts`; execution/review status is recorded by the batch
validation gate.

## Pick a boundary in the source view

While editing a sketch, choose **Project part edges**. The source view shows the
actual upstream native solid and overlays its complete surviving authored caps.
Click or tap a cyan outline to select that exact cap group and automatically
solve its linked preview. Orbit by dragging the part away from an outline, zoom
with the mouse wheel, or use **Fit sources**. The outlines show through the solid
so its start and end cap are both selectable. A selected outline turns yellow.
Tab to an outline and press Enter or Space for the same selection; the named
**Source part boundary** chooser remains available.

Dashed brown outlines are incompatible with the destination sketch plane. Pick
one to see a diagnostic explaining the parallel-plane requirement. This does not
change the project or enable Apply. Named selection offers the same compatibility
feedback. The SVG outline is a bounded display approximation of authored lines,
circles and arcs; projection references and native geometry come from the existing
complete-cap proof and projection planner, never from arbitrary mesh triangles.

Review the linked outline and native preview, then use **Apply projected boundary**.
Changing the source, construction option, document, sketch selection or task
invalidates the preview. A source edit after Apply updates the link at rebuild;
save/open preserves its stable member identities. Display limits retain the named
chooser and native Preview/Apply validation.

Source-view outlines use the current posed world coordinates. Different component
positions and in-plane rotations are accepted whenever the **placed** source cap
and destination plane are parallel. Different authored origin planes can also
project when their component rotations make the placed planes parallel. Separated
parallel planes project orthogonally; distance along the normal does not alter the
outline. Oblique planes fail explicitly: circles are never approximated as ellipses
or polyline outlines.

Moving the source updates the destination-local outline at rebuild. Moving the
destination changes its local outline to retain the source's projected world
position; the destination feature still starts on its own placed sketch plane and extrudes
along that plane's normal. Moving both components by the same rigid placement preserves their
relative authored outline. A downstream cut or join can change volume when its
linked outline moves relative to its target. Move previews validate the complete
native candidate and retain body identities/solid counts; independent solids must
retain exact volume. Incompatible motion invalidates the linked sketch and its
consumers and prevents Apply/export, with source-linked repair diagnostics. Undo
restores the last valid pose; reselect a compatible cap, repair the sketch plane,
or remove the link rather than guessing geometry.

Older schema 15/16 links remain **Legacy design links** and keep their original
authored-coordinate associations, even when components move. Migration does not
convert them. Reselect preserves their coordinate mode and generated IDs. To adopt
placed behavior, remove the legacy link, project a new boundary, and explicitly
repair downstream profile references. Break link retains the currently solved
local outline as ordinary editable geometry. The linked-boundary UI labels the
association mode. During legacy repair, the source view still displays the actual
placed native part; compatibility and the linked sketch preview follow authored
design coordinates, as the task explicitly labels.

`placedSketchProjection.test.ts` covers XY/XZ/YZ circles/arcs, opposite normals,
world-parallel different authored planes, schema migration, source/target motion,
coordinate limits and exact cache signatures. `e2e/placed-projection.spec.ts` adds
native solids/volume/orientation, motion, Undo/Redo, save/open, parameter changes,
STL, stale preview rejection and oblique-motion recovery. The production schema
17 fixture verifies the same native association under built-app security headers.
Execution results are recorded in [the validation log](VALIDATION_LOG.md).
