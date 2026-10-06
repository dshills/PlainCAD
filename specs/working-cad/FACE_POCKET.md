# Draw on a face and remove material

Workbench has a guided native workflow:

1. Choose **Draw on face** and select a visible supported face in the active component, by clicking the viewer or its keyboard card. Selection does not edit CAD.
2. **Draw here** creates one editable sketch linked to that exact feature-owned face, aligns the camera, and opens mouse drawing. This sketch creation is one undoable action.
3. Draw a closed region and **Finish Sketch**. The handoff shows the target body's name and inward cutting direction. Multiple regions require an explicit choice.
4. **Remove material** opens an inward Cut preview for that chosen region and only that face's body. Region, body, operation and direction are locked; depth can be a positive length expression, or use Through All in Advanced options.
5. **Apply pocket** adds one feature in one Undo after a native preview proves reduced exact volume and one remaining valid BRep solid. Cancel discards the feature preview without changing the authored sketch.

Pocket intent is runtime-only and tied to the sketch ID, document session and component. Preview cancellation retains that intent so Edit sketch → Finish can retry the same pocket; accepting a feature clears it, and consumed-sketch finishing does not reopen it. File replacement invalidates it.

**Make solid** remains available as a deliberate alternative for a face sketch. Editing a sketch already consumed by a feature keeps the existing normal Finish behavior; it does not add another pocket automatically.

## Limits and diagnostics

Faces are retained, unambiguous native-validated distance-extrusion caps and straight sides. Current retained faces after boolean modifications may be available when the native reference validator confirms them. Curved, split, hidden, inactive-component, lost and ambiguous faces cannot be guessed. This adds no general face naming or new persisted schema.

The cut follows the negative normal of the measured face basis, so cap and straight-side sketches cut inward. Offset face planes are outside this guided shortcut. The native preview is the authority for intersection and geometry validity; drawing outside a face does not silently create a successful no-op. A cut that removes nothing, increases volume, leaves multiple solids, or consumes the entire target fails with an actionable message. The narrower single-solid result is deliberate for this guided operation; general Extrude remains available for other supported cuts.

Captured picker and modeling frames compare immutable document identity, document session, active component and native result identity. Replacement files, stale worker results and modified geometry cannot apply a captured face or pocket.

## Validation

`src/tests/facePocket.test.tsx` checks explicit selection versus creation, stale results/documents, hidden/unsupported faces, locked ownership and rejected unchanged volume. Its native proof metadata is synthetic and establishes command boundaries only.

`e2e/face-pocket.spec.ts` obtains actual OpenCascade geometry: a 40 × 30 × 10 mm plate has 12000 mm³; a 10 × 10 × 2 mm end-cap pocket yields 11800 mm³, and a 10 × 4 × 2 mm straight-side pocket yields 11920 mm³. Both assert one valid native BRep solid, retained outer bounds, explicit preview/Cancel/Apply, one-feature Undo/Redo, project save/open and oriented STL volume. The cap case uses a real viewer face click and both use actual mouse rectangle drawing.

Scoped validation completed: 17 focused unit/component tests passed, including the existing handoff regression suite. Both native cap and side cases passed in Chromium (15.3 seconds total), including actual mouse drawing and STL signed volume. Camera-error preflight was added after review and is covered by a focused test; the full integrated release gate reruns native acceptance.
