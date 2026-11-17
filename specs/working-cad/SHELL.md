# Native Shell

Select an unmodified rectangular extrusion body and open **Shell** in Solid
tools, the timeline, or the command palette. Choose the start cap (at the
sketch) or end cap (away from the sketch) as the opening. Enter a wall
thickness, which can reference a project parameter. A valid native preview
unlocks **Apply Shell**; Cancel leaves the project unchanged. Select the Shell
feature in History and choose **Edit Feature** to change the opening or
thickness. Apply saves one undoable edit and keeps the source body ID.

The first scope is one cap of an active, positive-distance new-body extrusion
from an axis-aligned rectangular profile in sketch coordinates. Profiles with
holes, modified solids, curved walls, other extrusion directions, side
openings and multiple openings are unavailable. Inward wall thickness must
leave room for the cavity on both sides and at the remaining floor. The kernel
checks the opening at the feature's timeline position; if an earlier operation
modifies its source, move that operation after Shell or suppress it.

PlainSolid builds the cavity using the selected opening and the exact inward
wall and floor offsets. The preview and normal rebuild verify that the result
is one valid native solid with the exact expected remaining material volume.
A no-op, collapsed wall or lost opening produces a diagnostic. The opening
stores the source extrusion ID and its cap role; no kernel handles or preview
meshes go into the project. Supported old projects migrate without adding a
Shell feature.

Use `cad.feature.shell` in a native command plan for the same behavior from
the CLI or an agent. Pass `sourceFeatureId`, `opening` (`startCap` or
`endCap`) and the `wallThickness` expression. Existing Shell settings are
editable with `cad.feature.update` inside a native plan. Direct JSON creation
and geometry edits cannot bypass the preview. See the
[stable command catalog](../../docs/STABLE_COMMANDS.md).
Workflow recording captures the semantic edit only when Apply commits it.
