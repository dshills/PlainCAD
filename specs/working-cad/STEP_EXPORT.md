# Validated native STEP export

**Export STEP** downloads selected current native solids in one `.step` file for
other CAD tools. Bodies stay separate, including overlapping bodies; no union is
performed. Saved component translation and rotation are applied to complete native
BReps before export, so the file uses the same world coordinates and millimetres as
the modeled project. STEP retains geometric solids; editable sketches, feature
history, component labels, joints and assembly hierarchy remain in `.pcaddoc`.

The command requires a successful current native rebuild, actual installed STEP
writer/reader/filesystem bindings, browser worker support and no competing edit or
file task. Select bodies, choose **Generate validated STEP**, and review the native
verification status before **Download STEP file** becomes available. Cancel or
Escape terminates the disposable export worker. Changing the project, session or
rebuild result rejects or cancels pending exports; a file prepared for an older
model cannot be downloaded. Body selection changes discard prepared files.

Generation rebuilds the complete source in an isolated native worker and accesses
the selected world-positioned shapes immediately before their normal disposal.
The native `STEPControl_Writer` transfers each body separately. The same worker
then reimports its actual bytes with `STEPControl_Reader`, checks body/root counts,
valid BReps, native solid counts, exact BRep-integrated volumes and native bounds
for each root. The installed writer/reader pair is verified to retain transfer
order using distinct placed bodies and overlapping duplicates. A changed root
order fails verification safely; labels or hierarchy are not inferred from it.
Volume tolerance is the greater of 1e-7 cubic millimetres and 1e-8
relative; coordinate tolerance is the greater of 2e-6 millimetres and 1e-10 relative
to each coordinate. These checks use native geometry, not tessellation volumes.
Missing writes, malformed files, unit changes, no solids, changed geometry or lost
body roots fail with a diagnostic and no download. Runtime proof records and STEP
bytes are never persisted in project files or ordinary rebuild results.

Exports are limited to 1–64 unique current bodies, the existing project/model
limits, 32 MiB of STEP data and 60 seconds. The native filesystem write is bounded
before oversized buffers are allocated. Request IDs and document-session epochs
are checked at the client boundary; native handles remain worker-only and owned
writer, reader, reimported shapes, filesystem files and feature-cache handles are
disposed on success and failure. Terminating a failed/cancelled worker releases
its entire native runtime.

## Installed binding compatibility

The installed OpenCascade.js 1.1.1 bindings accept filename strings for
`STEPControl_Writer.Write` and `STEPControl_Reader.ReadFile`, but route a corrupted
filename through their string ABI. Passing a numeric UTF-8 pointer is rejected by
the binding. A native probe confirmed that the STEP content itself is valid AP214
and round trips correctly when filesystem access is routed to a known file.

The isolated export operation temporarily routes exactly one synchronous write
open and one synchronous read open to a private task-owned filename. It accepts
only the expected read/write flags, rejects extra file access, bounds writes, and
restores the original filesystem methods in `finally`; no hook crosses an `await`
or changes the application's browser filesystem. Export proof still requires the
real native writer and reader to succeed. This compatibility adapter does not
substitute geometry or fabricate STEP data. Native tests cover malformed/missing
writes, write limits, wrong reimport geometry, resource cleanup, curved cuts,
overlapping solids and world placement. Browser acceptance checks the public
selection/generation/download flow and emitted production worker security policy.
