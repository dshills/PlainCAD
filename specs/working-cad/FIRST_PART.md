# Named first part

Open **New part**, enter a **Part name**, and choose **Draw a shape**.
Choose Top (XY), Front (XZ), Side (YZ), or a supported face. Confirming the
plane creates the component and Sketch 1 together in one Undo edit and opens
the drawing canvas. The breadcrumb retains the sketch name when you select
individual entities.

For a first solid, choose **Rectangle**, drag between its corners, and choose
**Finish Sketch**. A closed profile in the guided workflow opens an extrusion
preview. Set **Thickness** in the Extrude panel, then choose **Apply** when the
preview is ready. The body appears under the component you named.

**Describe a part with AI** prepares a named request in the existing AI drawer. The name is
temporary until an explicit native preview Apply; Cancel publishes no component.
Provider-generated content still passes the ordinary bounded recipe validation.
No provider request happens merely by choosing Describe. The starter name belongs
to the current project session; opening/replacing a project resets it.

Unit tests cover atomic creation, bounds, cancellation, stale context and named AI
apply. `e2e/first-part.spec.ts` proves mouse drawing, exact native volume/orientation,
save/open/STL and deterministic provider-response/native-preview cancellation.
The provider response is mocked; the geometry kernel is real.
