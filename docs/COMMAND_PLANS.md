# Transactional modeling plans

`plan.preview` accepts a bounded sequence of stable `cad.*` commands. It builds a
private candidate and proves OpenCascade geometry before showing it in the main
viewport. The accepted document, autosave data, selection and undo history remain
unchanged until `plan.apply`. Apply commits the complete candidate through the
normal document store as one history edit; Undo restores the preceding project.

Discover the current project session and schemas with `commands.list`, then:

```json
{
  "command": "plan.preview",
  "session": 1,
  "arguments": {
    "label": "A simple plate",
    "steps": [
      { "command": "cad.sketch.create", "arguments": { "name": "Outline", "plane": "XY", "as": "outline" } },
      { "command": "cad.sketch.rectangle", "arguments": { "sketchId": "$outline", "width": "40mm", "height": "20mm", "as": "rectangle" } },
      { "command": "cad.feature.extrude", "arguments": { "sketchId": "$outline", "profileId": "$rectangle.profile0", "distance": "5mm" } }
    ]
  }
}
```

Replace the illustrative session with the discovered value. The successful
response contains `planId`, JSON step results and native body proofs. Inspect
`plan.status` or use the Before/After controls in the task dock. Call
`plan.apply` with `{ "planId": "the-returned-id" }`, or `plan.cancel` with `{}`.
Scripts must explicitly apply; a provider, recording or preview never does so
implicitly. Native solids require a valid BRep, positive exact volume and a
positive integer solid count. Unsupported/no-op edge operations fail through the
same native diagnostics as interactive modeling.

`$alias` references bind created objects within a plan. A JSON result reference
can instead supply an earlier step's output:

```json
{ "sketchId": { "$result": { "step": 0, "path": ["id"] } } }
```

Step indices are zero-based and must point backward. References can address IDs
and arrays in plain JSON results; they cannot supply worker/kernel handles or
native proofs. Agent-supplied runtime geometry, arbitrary code, file operations,
UI gestures and unknown command fields are rejected.

A plan is limited to 256 KiB, 100 steps, 16 edits while active modeled features
exist, a 90-second total deadline and the existing 30-second native-worker limit.
Each edit to an already modeled candidate is checked before a later edit can hide
its failure. The final candidate is also validated. Sketch-only candidates show
in the main viewport; intermediate open sketch steps are allowed before a solid
is built. Split larger modeling sequences into separately reviewed plans.

Changing the accepted document, project session, selection, active component or
accepted rebuild invalidates the proposal. Cancellation terminates the private
worker. Failure leaves the accepted document and history intact. Cancel/Apply
remove disposable meshes and proofs; none are serialized into the project or
macro library. A subsequent normal rebuild after Apply remains authoritative for
export availability.
