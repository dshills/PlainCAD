# Direct sketch mouse workflows

The sketch toolbar exposes Select, Line, Rectangle, Circle, Arc, Move,
Translate and Deform. Movement uses the existing immutable sketch transactions:
release accepts one undo edit only after the solve and profile topology checks
pass. Escape cancels a preview. Move is for a free numeric point; Translate
moves its connected group while retaining dimensions and constraints; Deform
supports the existing bounded orthogonal point-and-line solver. A diagnostic
explains parameter-bound, fixed, unsupported-curve or unsupported-constraint
movement and directs users to dimensions/coordinate expressions where needed.
Movement point selection is visible without opening Precision controls.

Hold Space and drag on the drawing surface, or drag with the middle mouse
button, to pan. Pan changes only the transient view: it adds no history entry,
never edits project geometry and never invokes a rebuild. Escape during a pan
restores its starting view. Pointer cancellation, lost capture, window blur,
file activity and stale document changes release the capture and restore an
unfinished view gesture. Starting navigation preserves a click draft and its typed sizes while
cancelling live pointer capture and movement previews. An active press-drag
primitive is discarded on interruption; the next click starts a fresh shape. Native Space activation of toolbar buttons remains available;
text fields retain normal text entry.

Geometry inference adds finite line/line, line/circle, line/arc, circle/circle,
circle/arc and arc/arc intersection targets. Parallel or coincident curves do
not create ambiguous inferred targets. Arc targets must lie within the signed
sweep; finite line targets must lie on the segment. A line draft anchored
outside a circle or arc can snap its endpoint to an analytic tangent point.
An anchor inside or on the circle has no external tangent targets. Tangency is
an endpoint placement aid; it does not add a persistent tangent constraint.
Existing point reuse still wins, then the nearest midpoint, center,
intersection or tangent within eight screen pixels; independent SVG X/Y scales
are respected. Alignment and grid retain their existing priority afterwards.
No inference creates dimensions, constraints or source-entity edits.

Hold Alt during drawing to bypass existing-point, geometry, alignment and grid
snaps. During a movement preview, Alt likewise supplies the raw requested
coordinate; the transaction still preserves authored constraints and may reject
it. Starting a movement still identifies an existing point, including when Alt
is held, so the selection itself cannot become an unrelated free coordinate.
The navigation status makes the temporary suspension visible. Exact keyboard
coordinates retain their existing behavior.

Intersection/tangent work is limited to 64 nearby curves (2,016 pairs) per
pointer event after finite-geometry, bounds and curve-outline filtering. A denser area declines
advanced inference and advises zooming in or entering coordinates; it does not
expose an arbitrary truncated set of advanced targets. Existing points,
midpoints, centers and grid remain available. The work limit is runtime UI
behavior and adds no saved-document schema data.

AI refinement dispatches `plaincad:cancel-sketch-gesture` before capturing and
applying its frame; this clears unfinished primitives, selection boxes, pans
and movement previews without saving them. While a refinement frame is active,
pointer drawing/movement is disabled and the status asks users to Cancel or
Apply. Selection changes invalidate the proposal through the refinement guard.

## Verification

- `canvasCurveSnapping.test.ts`: finite segments; positive/negative arc sweeps;
  internal/external tangency; coincident/degenerate/nonfinite curves; exact
  tangent radius and perpendicularity; stable order; bounded pair work.
- `canvasSnapping.test.ts`: pixel tolerances, existing-point priority, draft
  extents, intersections/tangent feedback, total snap suspension and dense-area
  feedback, alongside existing snapping regressions.
- `sketch-mouse.spec.ts`: real Chromium/OpenCascade on XY and XZ, view-only pan
  and Escape restoration, analytic tangent and intersection mouse drawing,
  temporary Alt suspension, cancelled/accepted group translation, one Undo,
  Redo, stable entity IDs/design intent, exact native volume and plane-oriented
  bounds, project save/open and positive-volume STL.

These checks prove the bounded workflows above. Arbitrary free deformation,
automatically authored geometric constraints and unconstrained movement of
parameter-bound or fixed geometry remain outside this implementation.
