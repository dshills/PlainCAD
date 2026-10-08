# Direct pattern arrangement controls

Create or edit a feature pattern, then use its arrangement plan beside the native
geometry preview. The plan displays the source profile outline and each copy in
the source sketch's own X/Y coordinates. Its labeled copies correspond to the
source and the additional cuts; the independent native view shows the completed
solid in world coordinates, including component placement.

- For a linear pattern, drag the handle on the first additional copy to set
  signed spacing along the selected sketch X or Y axis.
- For a circular pattern, drag the center to set both source-sketch center
  coordinates, or drag the sweep handle to change the signed angle. The pointer
  unwraps across the angle boundary and stops at one full revolution in either
  direction. A full-circle handle begins on the original's radial direction;
  moving back along the sweep reduces the angle.
- Every setting remains editable in a labeled text field. These fields accept
  units and parameter expressions, and provide keyboard alternatives to gestures.

A literal field can be dragged immediately. A parameter or arithmetic formula is
protected unless **Allow dragging to replace formulas with literal values** is
checked. Consent affects only fields actually dragged; unchanged count/other
settings retain their existing references and authored units. Dragged coordinates
use explicit millimeters and dragged angles use degrees, independent of display
or authoring units. The checkbox does not change the document by itself.

The plan's camera bounds remain fixed during a gesture. Escape or pointer
cancellation restores the gesture's initial expressions. Native preview work
waits until the gesture finishes. The last validated native preview stays visible
with an explicit out-of-date label during dragging and validation; changing the
source or invalidating the project hides it. Apply is disabled during the gesture and
until the exact latest native preview succeeds. Cancel leaves the project and its
Undo history unchanged; Apply records the same single document edit as numeric
pattern editing. Project/component/session changes invalidate the draft.

Copy outlines are sampled arrangement guides, not topology proof. Source geometry
comes from the worker's solved sketch and authoritative plane transform. The plan
shows a diagnostic and leaves numeric editing available when source geometry or
settings are unavailable; outlines above 16,384 vertices across all copies also
use numeric editing. Unsupported sources, overlapping tools, off-body cuts,
invalid counts and no-op geometry continue to fail through the native pattern
preview, with the same actionable diagnostics as numeric editing.

Validation covers protected formulas, explicit replacement, signed linear and
circular placement on a non-XY and placed plane, retained units, stale geometry,
angle unwrapping, pointer/Escape cancellation, and stale gesture cancellation.
The focused native browser cases use actual mouse drags, native exact volume,
hole-rim coordinates and orientation, cancellation and save/open round trips.
These acceptance cases must pass before handing off this item.
