# Stable CAD commands

Semantic commands describe CAD intent independently of mounted controls or screen coordinates.
The canonical registry discovers their strict JSON schemas. Execute them through
`window.plaincadCommands.execute`, the CLI, or command plans. Use the current session
from discovery. Direct edits remain ordinary undoable document edits; an accepted
plan commits its entire document as one history entry.

Command completion confirms an authored edit. It does not prove a valid solid.
Call `runtime.awaitNative` before inspecting/exporting geometry, and check native
BRep validity, solid count and volume. Kernel diagnostics reject failed booleans
and unchanged edge treatments. Use a previewed plan when geometry must be checked
before accepting edits.

| Command | Required arguments and supported behavior |
| --- | --- |
| `cad.parameter.add` | `name`, `expression`; optional `authoredUnit`, `group` |
| `cad.parameter.update` | `parameterId`; optional name/expression/unit/group; renames preserve expression references; invalid authored expressions return parameter diagnostics |
| `cad.component.create` | `name` |
| `cad.component.rename` | `componentId`, `name` |
| `cad.component.place` | `componentId`, three-number `translation` in mm and `rotation` in radians; X then Y then Z |
| `cad.sketch.create` | `name`, `plane`: XY/XZ/YZ; optional `componentId`, signed `offset` expression; defaults to root component |
| `cad.sketch.createOnFace` | `name`, `featureId`, `stableFaceId`; optional matching `componentId`. Pick a current native face from `runtime.snapshot.rebuild.faces`. |
| `cad.sketch.draw` | `sketchId`, `tool`, numeric-mm `points` with optional existing `pointId`; optional `sizes`, `construction`, `clockwise`; the same sized drawing helper used by mouse gestures |
| `cad.sketch.point` | `sketchId`, `point`: `{x,y}` expressions |
| `cad.sketch.rectangle` | `sketchId`, `width`, `height`; optional corner `origin`: `{x,y}`; positive sizes |
| `cad.sketch.circle` | `sketchId`, `center`: `{x,y}`, `radius` |
| `cad.sketch.line` | `sketchId`; each endpoint requires either coordinates `start`/`end` or `startPointId`/`endPointId` |
| `cad.sketch.arc` | `sketchId`; center/start/end coordinates or existing point IDs; equal positive endpoint radii; optional `clockwise` |
| `cad.sketch.construction` | `sketchId`, `entityIds`, `construction` boolean |
| `cad.sketch.dimension` | `sketchId`, `type`, `refs`, `expression`; optional `authoredUnit`, `dimensionId` for editing existing dimensions without changing their type/references |
| `cad.sketch.deleteEntities` | `sketchId`, `entityIds`; removes dependent dimensions and orphan points using the same deletion planner as the UI |
| `cad.feature.extrude` | `sketchId`, either `distance` or `termination`; optional `profileId`, `direction`, `operation`, `targetBodyIds`, `name` |
| `cad.feature.pocket` | Plan only: `sketchId`, `targetBodyId`, either `distance` or `throughAll: true`; optional `profileId`, `name`. Cuts inward from a supported face sketch. |
| `cad.feature.revolve` | `sketchId`, `angle` up to one turn; optional `profileId`, origin `axis`: X/Y/Z or `axisLineId`, `operation`, `targetBodyIds`, `name` |
| `cad.feature.hole` | `sketchId`, `centerPointIds`, `targetBodyIds`, `diameter`, and either `depth` or `throughAll: true`; positive/negative `direction` |
| `cad.feature.fillet` | supported `edges`, `radius`; optional `name` |
| `cad.feature.chamfer` | supported `edges`, `distance`; optional `name` |
| `cad.feature.update` | `featureId`; only settings compatible with that feature are accepted; changing extrusion distance selects distance termination |
| `cad.feature.delete` | `featureId`; rejects deletion that leaves authored dependencies broken |

Geometry expressions are strings, including numbers (`"20"`) or explicit units
(`"20mm"`). Bare scalar lengths use the project's authored length unit; explicit
lengths retain their unit. Dimensionless ratios involving dimensional inputs do
not silently become lengths. Missing IDs, unknown fields, duplicate references,
invalid parameters during creation/modeling, failed sketch solving, and ambiguous
profiles fail explicitly. Parameter updates preserve structurally valid authored
expressions even when evaluation fails, so users can see and repair their input.
Their results include serializable, source-linked `diagnostics`; the rebuild fails
and current geometry/measurements become unavailable until repair. An accepted
parameter edit does not establish modeling success. Previewed plans still require
a successful native rebuild before Apply, and every other semantic modeling
command requires valid parameters.

Rectangle/circle/line/arc/point creation accepts `construction: true`. Driving
dimensions support length, radius, diameter, horizontalDistance, verticalDistance,
distance and angle, with the same reference requirements as the sketch editor.

## Stable references within plans

Creators optionally accept `as`, a safe plan-local alias. `"$outline"` resolves
the primary ID created as `outline`. Results expose `id`, `pointIds`, `entityIds`,
`profileIds`, and—for new-body features—`bodyId`. Additional aliases bind generated
members: `$rectangle.point0`, `$rectangle.entity0`, `$rectangle.profile0`, `$base.body`.
Aliases never replace durable project IDs and are not persisted in CAD files.
Direct executions have no previous alias context; use returned IDs between calls.

```json
[
  {"command":"cad.sketch.create","arguments":{"name":"Outline","plane":"XY","as":"outline"}},
  {"command":"cad.sketch.rectangle","arguments":{"sketchId":"$outline","width":"20mm","height":"10mm","as":"rectangle"}},
  {"command":"cad.feature.extrude","arguments":{"sketchId":"$outline","profileId":"$rectangle.profile0","distance":"5mm","as":"base"}}
]
```

Shared point references let scripts build connected profiles without coordinate
matching or mouse gestures. Profile IDs reflect sketch topology; rediscover them
after topology-changing edits instead of assuming old IDs still match.

## Modeling limits

`cad.sketch.create` supports origin planes and origin-plane offsets.
`cad.sketch.createOnFace` uses a stable feature-owned planar reference on an
existing native body. IDs are published only for a current successful rebuild.
Direct execution checks that native face before creating the sketch; plans
validate the candidate sketch at its timeline position in the worker. Repair
and arbitrary topology picking remain separate UI tasks.

`cad.feature.extrude` accepts `{ "type": "throughAll" }` for scoped Cut or Join,
or `{ "type": "toFace", "featureId": "…", "stableFaceId": "…" }` for positive
extrusions to a covering, unmodified supported planar face in the same component.
Use `plan.preview` for native coverage and target checks before Apply.
Boolean features require explicit, nonempty targets in the same component.

For a face pocket, put `cad.sketch.createOnFace`, a closed region such as
`cad.sketch.rectangle`, and `cad.feature.pocket` into one `plan.preview`.
Use the listed face's `bodyId` as `targetBodyId`, and the sketch's local
coordinates for the region. The pocket selects inward direction automatically,
reduces the target's exact volume, and leaves one valid native solid. Apply the
plan once, or Cancel with no change. Later, preview `cad.feature.update` with the
pocket feature ID and a new `distance`; it retains body and feature identity.
Changed bare depths use the current project length unit; untouched expressions
keep their authored units. Use explicit units to lock size. Interactive Draw on face, Remove material and
straightforward depth edits use the same authored commands with native previews.
Recorded face references target existing project faces. A recording does not
rebind a composite `stableFaceId` to a newly replayed owner; select an existing
face or supply its current ID when replaying such a workflow.

Edge specifications are `{featureId, role, sourceEntityId?}`. Roles are
`startCapPerimeter`, `endCapPerimeter`, or `profileEdge` (requires a source line).
They target one active distance new-body extrusion and use existing supported
feature-owned topology references. They do not accept arbitrary edge indices or
runtime proof objects. Native geometry must establish that the selected original
edges remain available and that the treatment actually changes the solid.
