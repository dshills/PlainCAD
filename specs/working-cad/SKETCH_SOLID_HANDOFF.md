# Finish Sketch → Thickness preview

Finishing an unmodeled sketch in the Docked Workbench returns to the solid viewer
with a source-specific handoff. Finishing an already consumed sketch keeps the
ordinary edit/rebuild flow so Undo and Save remain available. Full and Minimal
workspaces retain their explicit modeling commands. Additional regions of an
already consumed sketch can still be chosen through explicit operation targets.
The geometry worker must finish checking that exact document before its usable
regions become usable. With one closed region on an origin/offset plane, Finish
Sketch opens thickness preview directly. Multiple regions and face sketches keep
the chooser; its eligible regions are highlighted and sketches elsewhere in the
component are excluded.

For a chooser with several regions, click a highlighted region in the canvas or
use its exact region button with the keyboard, then choose **Make solid**. Face
sketches keep their explicit Add/Remove material choice even with one region.
The Extrude task shows thickness, operation and native geometry preview.
Only the task's **Apply** changes the CAD document. **Cancel** in either the chooser
or the preview creates no feature or history entry. A consumed handoff cannot
reopen a canceled preview. **Edit sketch** returns to the same drawing without
changing its geometry.

Empty sketches, construction-only geometry, open outlines, missing planes, failed
solving and failed rebuilds retain a clear current-source diagnostic. No guessed
region or fallback mesh is presented as native geometry. Overlapping viewer hits
require an explicit exact region button. Detailed regions above the bounded
viewer overlay budget retain that same button alternative.

The source capture includes the immutable document, document session, active
component and sketch. An edit, replacement, Undo, component change, or file job
invalidates the chooser; hidden or changed targets cannot open a preview. The
captured native result remains checked by the shared operation dispatcher and
the native Extrude preview's Apply guards. Selection, hover, and this source
capture are runtime state and are not serialized into project files.

Focused command/component tests cover cancellation, source scope, native-result
currency and selection without document edits. Browser acceptance uses authored
non-template single- and two-region sketches on XY and XZ, selects ambiguous
regions in the actual WebGL viewer,
checks preview cancellation, verifies native BRep validity, one solid, exact volume
and world-coordinate bounds, then saves/reopens and verifies positive STL volume.
These tests establish this bounded handoff; they do not establish general CAD
topology support or human usability results.
