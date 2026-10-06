# Named first part

The empty-project start card asks for a Part name and offers Draw or Describe.
Draw keeps that name while choosing Top/Front/Side or a supported face. Confirming
the plane creates the component and Sketch 1 together in one Undo edit and starts
the mouse drawing canvas. Cancel creates neither. The breadcrumb retains the
sketch name when individual sketch entities are selected.

Describe prepares a named New part request in the existing AI drawer. The name is
temporary until an explicit native preview Apply; Cancel publishes no component.
Provider-generated content still passes the ordinary bounded recipe validation.
No provider request happens merely by choosing Describe. The starter name belongs
to the current project session; opening/replacing a project resets it.

Unit tests cover atomic creation, bounds, cancellation, stale context and named AI
apply. `e2e/first-part.spec.ts` proves mouse drawing, exact native volume/orientation,
save/open/STL and deterministic provider-response/native-preview cancellation.
The provider response is mocked; the geometry kernel is real.
