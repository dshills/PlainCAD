# Local reusable-part library

The local library saves one active, self-contained component with editable sketches,
features and independent parameter bindings. Saved parts include a shaded PNG
thumbnail generated from the current component's actual native tessellation. The
library lives in IndexedDB on this browser and origin; it is separate from project
files and does not sync or replace the open project. Download projects separately
for backups. Browser storage deletion removes saved library copies.

Open **Local part library**, name the active component, and choose **Save active
component to library** after a successful native rebuild. Cross-component geometry
references are refused by the same reference-remapping pipeline used by project
insertion. Repair these references before saving an independent component, or save
the whole project file and use **Insert a reusable part → All source components**.
All
source parameters are retained to preserve expression dependencies. Cameras,
project metadata and runtime objects are excluded.

Each card can be renamed, deleted, dragged into the model, or inserted at the
origin with a keyboard-accessible button. Internal library drags have their own
bounded MIME identifier; dropping a project file retains the existing Open flow.
Drop placement uses the explicit XY ground plane (Z = 0). The copied component's
translation becomes the chosen world origin; its saved rotation is retained. The
entire candidate project is rebuilt by an isolated native worker before Apply is
enabled. Cancel leaves the document untouched; Apply adds independent IDs and
bindings in one undo step. Project, session, active component, current rebuild and
competing task checks reject stale work. Use **Move component** after insertion for
precise placement and rotation. Joints, linked-library updates and assembly mates
remain unavailable.

Storage is limited to 50 entries and 25 MiB total text/thumbnail data. Each portable
project remains subject to existing 5 MiB, count, depth and unsafe-key limits. PNG
thumbnails are at most 256 pixels per side and 256 KiB, with a 50,000-triangle
rendering cap. Cursors bound storage reads, and atomic read/write transactions
enforce the total budget across tabs. Blocked, unavailable, timed-out or full
storage produces a visible diagnostic and leaves the current project unchanged.
Deleting a saved copy does not modify previously inserted components.

Damaged stored copies appear as bounded recovery entries with diagnostics and an
explicit **Delete damaged saved copy** action; their project content is never
inserted or merged. Saving and renaming wait until damaged or overfilled storage
has been repaired. Valid entries can still be inserted and deleted. Listings read
at most 50 rows and 25 MiB; an externally overfilled library shows a partial-page
warning. Delete copies and reopen the library to advance through remaining rows.
Unsupported corrupted storage keys can be handled by **Delete all saved library
copies**, which requires selecting the explicit permanent-deletion checkbox.
This resets only the part-library store and keeps the open project, recovery
autosaves and previously inserted components. Atomic rename requires its saved
entry to still exist, so another tab's deletion cannot be silently undone.
