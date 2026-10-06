# Workbench validation and usability pilot

The release gate includes the default Docked Workbench in addition to Full and
Minimal layouts. New production tests import portable non-template fixtures via
the public file UI, select driving dimensions and edit Extrude, Revolve, Hole,
Fillet and Chamfer under production CSP with real native workers. Each case checks
Cancel, a changed native solid volume, stable feature IDs through save/open, and
positive STL volume matching the native result. Extrude/Revolve/Hole have analytic
volume expectations; edge treatments must reduce volume and remain one native
solid. Keyboard dock resizing and compact navigation run across all three themes.

Development cases additionally cover named mouse-created parts, readiness and
source repair, formula-bound dimension editing, one-step Undo/Redo and orientation.
AI first-part acceptance uses a deterministic provider response and a real native
preview; paid provider calls are not part of the ordinary release gate.

## Human pilot — prepared, not conducted

Automated tests prove the specified behaviors, not that people find them easy.
Recruit five beginners, five occasional makers and five experienced CAD users.
Use the same machine/project units and balance task order. Observe without teaching
the interface. Participants may stop at any time; record observations without
credentials or personal project contents.

| Task | Observable completion |
| --- | --- |
| Name and draw a 30 × 20 × 6 mm bracket | Correct component/sketch ownership and native solid; no example template |
| Add a 4 mm hole | Intended face/body targeted; hole visibly removes material |
| Change thickness to 8 mm | User finds the solid label and understands preview versus Apply |
| Make a sleeve by description | Target/provider disclosure understood; validated proposal reviewed before Apply |
| Repair an open outline | User finds the issue, fixes the intended geometry, and rebuilds |
| Save, reopen, and export one body | Editable project distinguished from printable STL; intended body included |
| Find a formula/reference control | Advanced tools discovered without changing an unrelated field |
| Repeat an edit with AI unavailable | Manual route completes without a provider/key |

Record one row per participant/task, with experience group and anonymous ID:

| ID/group | Task | Unaided success | Seconds | Wrong-target edits | Help requests | Preview/Apply understood | Ease 1–7 | Observation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Not yet observed | | | | | | | | |

Proposed pilot targets: four of five in each group complete create/edit/save/export
unaided; zero wrong-target committed edits; advanced tools found in two deliberate
actions; first-solid time improves against the previous layout. These are goals,
not measured results. Summarize failures and revise priorities from observations.
Screen-reader, contrast/zoom, broader cross-browser native workflows and real human
sessions remain open; the Chromium geometry gate does not establish those outcomes.
