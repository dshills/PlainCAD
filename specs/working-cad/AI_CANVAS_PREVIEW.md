# AI proposals in the modeling canvas

An accepted AI proposal is rendered as real, native OpenCascade geometry in the
existing 3D viewport. It uses the current camera, world coordinates and clipping
plane. The proposed result is the complete project, so adding a component keeps
existing project parts visible. Changed and new bodies receive a cyan highlight.
Before shows the original accepted model; After shows the native proposal. Neither
comparison changes the document, camera pose, selection, accepted rebuild or undo
history. Subtractions display the actual cut shape, rather than an estimated ghost.

A proposal can publish only after every resulting body has native source, valid
BRep proof, a positive finite exact volume and a positive integral solid count.
Failed, fallback, empty and outdated proposals are not displayed. The original
project object, session, active component, complete selection and accepted rebuild
are captured. Changing any of those contexts, starting a rebuild or a file action
invalidates the proposal. Cancel, changing AI modes, closing AI, and leaving the
viewport release the proposal. Undo cannot resurrect it by returning to an old
project object.

The preview owns separate Three.js buffers in an independently disposed group.
Before/After and appearance changes reuse matching buffers. Loading is deferred
until a native proposal exists, and no animation or worker runs while idle. The
original model group remains available for restoring the accepted view. Proposal
bodies are not selectable as applied geometry. Geometry exports require Apply or
Cancel first, and the PNG capture boundary diagnoses an active proposal explicitly.
Applying commits the editable document through normal history and rebuild actions;
preview meshes never become durable project data or replace an accepted rebuild.

Protocol unit tests cover native-proof rejection, stale context release, bounded
resource ownership and unchanged document/history. The native browser test in
`e2e/ai-canvas-preview.spec.ts` adds a real XZ triangular extrusion to an existing
box. It verifies both bodies, their exact total volume, negative world Y extrusion,
unchanged camera, matching current part geometry, Before/After buffer reuse,
cancellation, selection invalidation and the final native rebuild after Apply.
