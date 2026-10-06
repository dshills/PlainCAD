# AI additions to an existing part

The bottom AI drawer has **Describe or edit a part** and **Add features to this
part** modes. Descriptions and conversations survive mode changes. Pending native
previews are canceled and sharing consent is reset; returning requires a fresh
preview. Sketch mode retains its separate local/provider refinement workflow.

## Target and explicit data sharing

Choose a current supported native planar extrusion face of the active component.
The target body and inward direction are fixed. Inspect context before allowing
sharing with the selected configured Anthropic, OpenAI or Google provider. The
loopback-only gateway keeps keys on the local server. Requests contain the face's
local tessellated bounds, body/face IDs, up to 32 supported authored cap-edge choices,
up to 24 project parameter names/expressions/evaluated values and recent complete
conversation turns. No project JSON, full meshes or credentials are sent. Context
and prompt are bounded to 32 KB; older whole turns can be dropped, while an oversized
latest turn requires an explicit reset. Consent expires with target, selection,
project session, parameter, rebuild, visibility or provider changes.

## Supported additions

Up to four operations execute in order:

- Holes: 1–16 explicit face-local centers, positive diameter and through-all or
  positive blind depth. Each circle must fit entirely on material; overlaps within
  an action are rejected.
- Pockets: one axis-aligned rectangle (lower-left corner, width/height) or circle
  (center/radius), with positive blind depth. Outlines must fit on material.
  Rectangle boundary checks include openings contained inside the outline and
  reserve uncertainty at sampled curved boundaries.
- Fillet/Chamfer: 1–8 exact listed authored cap edges or original perimeter groups,
  with positive radius/distance. Owners must match the selected body's extrusion.
  Later operations can invalidate an earlier reference; native stage validation
  rejects the resulting plan rather than guessing topology.

All coordinates and lengths are expressions. Explicit units are recommended;
unsuffixed lengths use the project unit. New expressions may use listed existing
parameters. Existing features, parameters, expressions, entity IDs and component
ownership are preserved. New ordinary sketches/features receive new IDs; no
new persisted schema is needed. A clarification has no Apply control.

## Native proof and limits

Each operation must pass its native feature assertion in a private worker, followed
by a complete project preview with valid BReps, positive volumes, one surviving
solid in the target mesh and a measurably reduced target volume. The exact plan,
document object, project session, component, selection, result and task ownership
must still match when applying. Cancel, timeout, task replacement, same-ID file
replacement and stale replies cannot publish geometry. Apply creates one Undo.

Placement checks guide the initial proposal; they are not persistent geometric
constraints on later parameter edits. Cross-action overlaps and supported-edge
survival are governed by the native stage rebuilds. A redundant/no-op operation,
lost reference or invalid downstream geometry rejects the plan. This does not
provide arbitrary semantic layout, additive bodies, general profiles, assembly
operations, unlisted topology or edits of existing parameter/feature fields.

## Evidence

Native-WASM unit tests cover real multi-feature volume, parameter binding and
round trips, individual fillet/chamfer geometry, full-outline fit diagnostics,
bounded input, exact preview proof, visibility/stale-frame rejection and one Undo.
Gateway tests exercise all three structured provider adapters, consent-related
transport boundaries, unsafe payload rejection and same-origin enforcement.
Chromium acceptance exercises all three provider interfaces (controlled replies),
XY/XZ/YZ coordinates, clarification, canceled replies, mode preservation, private
native previews, explicit Apply, parameter edits, Undo/Redo, save/open and signed
STL volume. An additional flow proves one individual-edge AI chamfer with Cancel
and Apply. Controlled provider replies prove deterministic application behavior;
live-provider smoke results are reported separately and are not acceptance tests.
