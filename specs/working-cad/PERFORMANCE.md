# Controlled native performance report

Run `npm run test:browser -- e2e/performance.spec.ts` after installing Chromium.
The release gate includes this test. Playwright writes `performance.json` under
the test's `test-results/` directory and attaches it to the test; GitHub Actions
uploads that directory as `browser-results` even when a later check fails.

The fixed scenario has one parameter, two XY sketches, a 12mm rectangle extrusion,
and a real native circular through-cut. After kernel readiness, five width-edit
warmups precede twenty measured edits. Each result must match the current width,
native volume, solid validity, solid count and global bounds. A distance overlay
and alternating global section clipping exercise viewer replacement/disposal.
One export warmup precedes ten full mesh-validation/STL encoding samples in real
export workers. Each binary STL must have the expected triangle byte length and
no validation warnings. This is a small reproducible scenario, not an exhaustive
benchmark of the solver or complex CAD documents.

The report records machine/browser/viewport metadata, raw samples, nearest-rank
sample p50/p95, cold page-load-to-first-model time, and these distinct timings:

- Parameter evaluation, sketch solving, profile detection and feature rebuild.
- Total worker rebuild and UI-edit-to-current-model time (includes automation,
  debounce, scheduling and result observation).
- Export worker round trip, full mesh validation and STL/ZIP encoding. Each export
  creates a fresh worker; round trip includes its startup and message transfers.

Shared CI records timing without hard latency thresholds. Resource assertions
permit at most eight additional rendered geometries, one texture, four shader
programs and 64 MiB of WASM capacity growth above the first post-warmup sample.
These conservative bounds detect substantial accumulation in this workload;
they do not prove every allocation is freed. Runtime body-map entries are bounded
by feature count, and scoped handles must reconcile registered, disposed,
transferred, already-deleted and failed disposals. All rebuild disposal failures
must be zero. Repeated scope disposal is idempotent; registering after disposal
fails explicitly. Current callers use synchronous scopes.

WASM telemetry reports the allocated `HEAPU8.buffer.byteLength`, **not live used
memory**. Unavailable capacity is omitted rather than reported as zero. Optional
Chromium JS heap telemetry is recorded without a threshold because collection and
process sharing vary. Three.js counts describe resources registered with the
renderer, not total GPU bytes. `cacheSize` is the legacy name for per-rebuild
runtime body-map entries; it does not measure a persistent tessellation cache.
Scoped-handle telemetry covers the disposable-scope utility; outer shape disposal
attempts/failures are reported separately. Unscoped transient allocations are not
counted individually. Small timings may round to zero at browser timer resolution.

An illustrative local run on 2026-10-02 used Apple M4 Pro/14 logical CPUs,
macOS arm64, Node 26.10.0, Chromium 153.0.8010.12 and a 1600×1000 viewport,
with the Vite development build:

| Measured phase | Sample p50 | Sample p95 |
| --- | ---: | ---: |
| Worker rebuild | 38.7 ms | 39.9 ms |
| UI edit to current model | 346.4 ms | 350.9 ms |
| Export worker round trip | 13.9 ms | 18.3 ms |
| Full mesh validation | 5.6 ms | 5.9 ms |
| STL encoding | 0.5 ms | 0.6 ms |

WASM capacity stayed at 64 MiB; the viewer stayed at eight geometries, one texture
and seven programs. Every measured rebuild reported 50 scoped registrations,
47 scoped deletions, three ownership transfers, three outer shape disposal
attempts and zero failures. These measurements support this bounded workflow;
long sessions, larger sketches, edge-treatment chains, other browsers and
production-build timings still need broader coverage.
