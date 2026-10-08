# Incremental native feature rebuilds

Successful native feature outputs are reused in the geometry worker. Renaming a
project or feature does not rebuild its solids; the returned body labels still
reflect the current document. Changing a dimension rebuilds the affected feature
and its downstream body dependencies while independent features can reuse their
validated native geometry and tessellation.

The cache compares exact construction inputs rather than a rounded geometry
fingerprint or a lossy hash. Each feature key includes evaluated expression
quantities, resolved sketch geometry and profiles with their authored identities,
resolved design planes, pattern source inputs, and exact upstream body versions.
To-face termination also includes its target-face owner's body version. Sketch
solving and native plane/projection validation still run before feature reuse.
Component placement is applied after modeling, so rigid placement alone does not
invalidate an unchanged feature's design geometry.

Only successful native outputs with geometry assertions are admitted. Failed
rebuilds discard pending admissions. Scope probes bypass reuse so native overlap
capture still executes. Export filtering and union happen after the ordinary
feature graph and cannot change cached bodies. Fallback geometry is never cached.

The worker owns cached shapes independently from each rebuild's shapes through
native copies. Each returned mesh has independent arrays and bounds. Final
runtime disposal, subsequent booleans and export therefore do not invalidate a
retained entry. The cache clears on a changed document ID, kernel instance or
worker epoch; terminating the worker releases its WASM heap. An explicit clear
helper is available for direct native callers.

Cache ownership is bounded to 128 entries, 256 native shape wrappers and 32 MiB
of estimated mesh/signature storage, including pending admissions. Native BRep
allocation sizes cannot be measured by this estimate: the native shape count is
the separate bound. Current-rebuild transient native shapes are owned and
released through the existing rebuild lifetime. Admission or retrieval copy
failures skip reuse, dispose partial copies, and issue a diagnostic warning.

Runtime metrics expose hits, misses, retained entries/shapes/estimated bytes and
cache disposal failures. `operationCount` counts executed modeling operations,
so a completely reusable rename has zero modeling operations. Native face
proofs, shape-copy validation, sketch solving, resource checks and component pose
work can still take time; a cache hit does not mean zero work.

Validation includes unit checks for independent ownership, failed transactions,
namespace/epoch invalidation, partial native-copy failure, exact input signatures
and bounded eviction. Real-kernel browser tests compare warm and fresh-worker
geometry, verify invalid cuts remain diagnostic, check rapid parameter edits,
and record the 40-body rotary-fixture cold/rename/parameter timings. Timing
samples describe that fixture and machine; they do not establish a general
percentile or latency guarantee.
