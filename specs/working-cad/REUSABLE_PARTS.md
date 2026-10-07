# Reusable part insertion

Use **New part → Insert a reusable part**, or **Insert Reusable Part** in the
command palette. Choose a local `.pcaddoc`/`.json` project, then choose all its
components or one component. **Insert components** creates one undoable edit in
the open project. Cancel discards the staged file; opening a project still replaces
it through the separate Open workflow.

Inserted components retain their source coordinates at the shared project origin.
They can overlap existing bodies. This is an editable copy, not a linked external
assembly: positioning transforms, mates, and external updates remain unavailable.
The imported root component uses the source project name; repeated component names
receive a suffix. The destination project ID, root, camera views, display units,
metadata, and history remain its own.

All source parameters are copied, even when selecting one component, so their
upstream expressions remain self-contained. Conflicting parameter names receive a
numeric suffix. Parameter bindings and dependent expressions follow the copied
IDs/names. Destination dangling references reserve their IDs, so an insertion cannot
accidentally reconnect them. ID allocation retries are bounded and fail without
editing the project if independent identities cannot be generated.

IDs for components, sketches, points/curves, constraints, dimensions,
features, and projection links are independent. Body references follow their copied owners. Supported face/edge references keep
their distance-extrusion owners; revolve solids can be copied, while revolve-owned
face/edge references remain unavailable. Profile signatures
are rebuilt from the remapped sketch and matched by geometry; opaque IDs are not
blindly substituted. Legacy strict units and explicit authored units retain their
source meaning in a destination using other display units.

A one-component insertion rejects references to other source components. Insert
all components or repair the source. Missing bindings, unknown parameter symbols,
unmatched profiles, and unsupported topology references produce clear errors before
changing the project. This validates authored content; the geometry worker still
performs the native rebuild and reports unsupported operations or invalid geometry.

File validation uses the existing bounded safe importer, schema migration and
validation. Combined output must satisfy component/parameter/sketch/entity/feature
limits and the portable 5 MiB/depth/node limits. Async validation and Apply both
check the captured project/session. Changes during validation, cancellation, and
unsafe input never replace or partially modify the open project. Other modeling
and export tasks cannot start while the insertion task is open.

Validation includes independent parameter edits, profile ID remapping, repeated
insertion, units, face/edge/projection/pattern references, resource limits,
undo/redo, cancellation and stale-state protection. Native browser acceptance
checks exact BRep volume, coordinate orientation, save/open and selected-part STL.
