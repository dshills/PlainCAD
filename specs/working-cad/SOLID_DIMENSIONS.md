# Solid driving dimensions

Selecting a feature or a current visible native body shows its authored driving
feature dimensions next to an affected solid. Extrude distance, Revolve angle,
Hole diameter/blind depth, Fillet radius and Chamfer distance are supported.
Selecting a body resolves its latest authored writer, not every upstream feature;
use History to inspect an earlier operation.

Labels show evaluated mm/deg values, the formula when parameter-bound, and affected
downstream feature names. Click or focus and press Enter to open the ordinary
native feature task. The existing expression is preserved on opening; edit it,
review the native preview, then Apply. Editing a formula or deliberately replacing
it changes the feature field; it does not silently change a shared parameter.
Cancel leaves history unchanged; Apply is one undoable feature edit.

These are authored feature values, not inferred bounding-box dimensions, arbitrary
face offsets or measured edge lengths. To Face/Through All do not gain a fictitious
editable thickness. Failed/pending/stale, hidden, foreign-component and fallback
geometry produce no labels. Camera-following annotation positions are transient,
excluded from project JSON and history. A clipped/offscreen anchor hides its labels.

Unit tests verify reporting boundaries; `e2e/solid-dimensions.spec.ts` proves native
formula edits, invalid Apply gating, Cancel, Undo/Redo, stable bindings, save/open
and STL volume. The production Workbench suite covers all five native editors.
