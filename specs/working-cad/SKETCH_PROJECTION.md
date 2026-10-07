# Linked projected boundaries

Open a destination sketch created after its source extrusion, then choose
**Project edges**. Select the named part, feature and start/end cap boundary.
Choose **Construction reference only** for guides, or leave it off to create
profile geometry. **Preview projected boundary** shows the linked outline and
validates native solids before **Apply projected boundary** creates one undo step.
Cancel leaves the project unchanged.

The destination plane must be parallel to the source cap. Origin, offset and
supported face planes are accepted when their resolved normals are parallel.
Projection follows source dimensions and resolves world orientation into the
sketch's local coordinates; a linked sketch is persisted in schema 15. Loading
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
