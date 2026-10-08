# Local reusable-part library

The local library saves one active, self-contained component with editable sketches,
features and independent parameter bindings. Saved parts include a shaded PNG
thumbnail generated from the current component's actual native tessellation. The
library lives in IndexedDB on this browser and origin; it is separate from project
files and does not sync or replace the open project. **Download library backup**
saves a portable `.pcadlib` pack; **Download project** on a card saves that saved
copy as an editable `.pcaddoc` project. Keep these downloads outside this browser.
Browser storage deletion removes saved library copies.

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

## Portable backup and transfer

**Download library backup** reads a complete, validated library snapshot in one
readonly transaction. Damaged, overfilled or partially readable libraries must be
repaired first; an incomplete backup is never silently downloaded. A healthy empty
library can be backed up. Individual valid saved copies can still be downloaded
while unrelated rows need recovery. Downloading a project uses its saved component,
parameters and placement, independently of the current open project.

Choose a `.pcadlib` file with **Import library pack**. Validation runs in a bounded
background worker and shows the names and number of copies before **Apply library
pack import**. Cancel or Escape discards validation or the pending preview. Once
Apply starts its bounded atomic write, Cancel waits until the write completes.
Apply adds fresh library identities for every imported copy, retaining its editable
project and thumbnail; it never updates or overwrites an existing saved copy.
Duplicate names are allowed and explicitly reported. Reimporting the same backup
adds another independent set of copies. Duplicate identities inside a pack are
rejected as malformed. The open CAD document and its Undo history are unchanged.
Previewing an imported part's insertion still requires valid native solids.

Packs use the `plaincad-part-library` envelope, version 1, with at most 50 parts.
All embedded projects pass the usual safe JSON, depth, count, migration and final
project validation. Only documented envelope and entry fields are accepted.
Stored data remains limited to 25 MiB; the portable envelope allows up to 50 MiB
plus 64 KiB for JSON string escaping. Each project still has the 5 MiB import limit
and thumbnails retain their PNG limits. Imports validate all entries before a
single atomic IndexedDB write transaction checks the combined existing-plus-new
budget. Quota errors, cross-tab capacity races, cancellation before completion,
damaged existing rows and invalid files abort the complete import. No partially
imported copies are retained. Project/session changes cancel pending work; stale
results cannot apply to a new open library or project. Packs contain CAD and PNG
copies only; no application credentials or runtime kernel/renderer handles are added.
Browsers without background worker support use a reduced 5 MiB transfer limit.
