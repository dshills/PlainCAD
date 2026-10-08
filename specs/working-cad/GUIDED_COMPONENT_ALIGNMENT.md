# Guided component alignment

Move / Rotate opens a two-pick alignment flow when another component has
supported native flat faces. Pick highlighted geometry on the moving component,
then pick matching destination geometry. The second pick updates the pose
immediately and schedules native validation. Apply saves one undo step; Cancel
leaves the project unchanged. The named source and destination lists provide the
same flow without requiring a pointer.

Choose Flat faces, Straight edges, or Points. Picking a new source starts the
destination step again. Selected geometry remains marked with a green checkmark.
Gap and Flip direction update the preview automatically after a committed field
change. Uncommitted and invalid inputs block Apply. Preview results from an old
pose or document cannot be applied.

Details contains the exact position and rotation fields. Clear alignment choices
returns to free movement; dragging a handle or editing an exact pose also exits
the guided picks. Reset placement and keyboard handle movement remain available.

These actions save a rigid component pose, not a joint or persistent mate. Flat
faces match their planes while preserving translation along the destination
plane; edges match their midpoint and direction; points coincide without changing
rotation. Gap follows the destination face direction. Supported geometry and
native solid validation retain the limits documented in COMPONENT_ALIGNMENT.md.
