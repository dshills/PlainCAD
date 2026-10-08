# Move and rotate components

Activate a component containing a successfully rebuilt native solid and choose
**Move component**. Use the X/Y/Z handles to translate along world axes, or drag a
rotation-ring handle to change its X/Y/Z rotation. Arrow keys on a focused handle
change 1 mm or 1 degree; Shift changes 10. The exact fields accept numeric
millimeters and degrees. Enter or leave a field to commit its draft value. Origin
and offset planes and finished bodies follow the component placement.

The pivot is the component's authored design origin. Rotation applies X, then Y,
then Z (`Rz * Ry * Rx`); each ring follows the axis of its corresponding saved
Euler field. Camera views nearly parallel to a translation axis or edge-on to a
rotation plane disable that handle. Orbit to reveal it or use the exact field.
Position is bounded to ±100,000,000 mm; each rotation is bounded to ±360 degrees.

Mouse movement displays a temporary rigid transformation of already validated
native meshes. Native validation starts after the drag ends, and an isolated
worker validates the whole candidate project. Body identities,
solid counts, and BRep validity remain invariant. Independent solids retain exact
volume. Bodies downstream of placed cross-component projection links may change
volume when the linked outline moves relative to a boolean target; their complete
native candidate must still validate. **Apply component placement**
requires the exact current successful native preview and saves one Undo step.
Escape during a drag, pointer cancellation, or window blur restores the captured
pose. **Cancel placement** closes the task without changing the project.

Placement belongs to the component in the project file. It does not rewrite
independent sketch coordinates, dimensions or feature parameters. New schema 17
world projection links regenerate their destination-local coordinates from relative
component placement; legacy design links preserve their existing associations. Parameter edits rebuild the authored shape, then position the
finished bodies. Measurements, view picking, save/open, and STL use placed world
coordinates. New projections accept different placements when their placed planes remain
parallel; oblique motion diagnoses and prevents Apply rather than guessing an
approximate projected curve. See [linked projection](SKETCH_PROJECTION.md). Placement provides independent positioning;
it does not provide assembly joints, motion constraints, or linked external files.

`e2e/component-placement.spec.ts` covers native bounds and volume, mouse drag and
Escape, keyboard placement, exact translation/rotation, one Undo/Redo, parameter
editing after save/open, and positive-winding STL coordinates. Focused command
unit tests separately reject stale native previews, forged preview objects,
changed body identities/volumes, store refusal, and currency changes during Apply.
