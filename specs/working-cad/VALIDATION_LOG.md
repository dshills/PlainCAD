# Validation cadence

Run Prism with Anthropic `claude-sonnet-5-5` and `npm run check:item` for every
completed requested change. Run `npm run release:check` on the fifth item, before
its handoff or commit. Fixup commits belong to the same item. Record results here
with each item; reset the count only after the full gate succeeds. If this log is
missing or the count cannot be determined, establish a baseline with the full gate.

## Last successful full gate

- Date: 2026-10-08.
- Change: guarded AI canvas undo/redo, including the preceding canvas assistant, selection targeting and native proposal items.
- Result: type checks, 1411 unit/component tests, build/bundle budget (largest 460.61 kB), all 301 development native browser cases and all 40 production cases passed.
- Completed items since that full gate: **2**.
- Next full gate: after **3** more completed items.

## Completed batch

| Item | Requested change | Prism review | Reduced gate | Full gate |
| --- | --- | --- | --- | --- |
| 1 | Five-item full gate and per-item reduced gate | Anthropic `claude-sonnet-5-5`; no high/medium findings; two low notes assessed | Passed: type checks, build/bundle budget, 960 unit tests, 5 development and 14 production smoke tests | Not due |
| 2 | Keep fitted models and previews visible through dock/canvas resize | Anthropic `claude-sonnet-5-5`; no high/medium findings; actionable fit findings fixed | Passed: type checks, build/bundle budget, 966 unit tests, 5 development and 14 production smoke tests; 7 additional native viewport/preview tests | Not due |
| 3 | Clear success feedback and readable parameter editing | Anthropic `claude-sonnet-5-5`; no high/medium findings; four low notes assessed | Passed: type checks, build/bundle budget, 975 unit tests, 5 development and 14 production smoke tests; 6 native parameter/status/deformation tests | Not due |
| 4 | Consistent part names and explicit Exit isolation | Anthropic `claude-sonnet-5-5`; no high/medium findings; four low notes assessed | Passed: type checks, build/bundle budget, 980 unit tests, 5 development and 14 production smoke tests; 17 additional native component/fabrication/AI tests | Not due |
| 5 | Rectangle workflow and selection-based reference dimensions | Anthropic `claude-sonnet-5-5`; no high/medium findings; six low notes assessed | Superseded by full gate | Passed: type checks, 994 unit tests, build/bundle budget, 228 development and 29 production browser tests |

Prism review `dc636fab53dbe0066d9b0f92d040fda1` covered all four changed files.
Its low notes concern explicit smoke-file lists and manual cadence tracking.
All named smoke files were exercised successfully (5 development / 14 production
tests). Maintain those lists when renaming tests. The count tracks completed
requests rather than commits, so agents maintain it here; an uncertain count
requires a full gate rather than assuming the batch is current.

Prism review `76647ea9ebf22e1e9f88d5e98caf3474` covered all ten item-2 files.
Earlier findings about initial camera state, empty Fit controls, and small-part
framing were fixed. Final low notes were assessed against Three.js: wheel/touch
inputs emit the controls start event, keyboard controls are not enabled, and
`Matrix4.lookAt` handles parallel up/direction vectors.

Record completed results before committing. On item 5, record the successful full
gate as the new baseline and begin the next batch at item 1. CI continues to run
the complete release gate on pull requests and pushes to `main`.

Prism review `ab638806e8e44e075ef9714fe7f9f474` covered all eighteen item-3 files. Low notes were checked: held worker delivery and its replacement queue are explicitly asserted before release, cache validity is checked during render and its empty error array is stable, and TypeScript verifies the result narrowing. The small rename setup remains local to each existing spec helper to avoid unrelated test refactoring.

Prism review `cca424c1601d9788c19e28bdbd73e7dc` covered all twenty item-4 files. STL export rejects empty meshes before indexing. Display maps cover the same complete body list used by the browser and inspector; exports receive that complete map and collision tests exercise full/subset naming. Separate parts use part names; shell/merged project exports retain project names, clarified in README.

Prism review `9224995a388d49c8a2f70b83670b95e9` covered all twenty-four Rectangle/integration files. Positive-length validation and zero/negative center-size tests already reject degenerate sizes; each sketch test replaces the document and rebuild state. Tool consumption is immutable and guarded, its cancel ref is initialized, and reference IDs and memoization match the annotation builder. Draft sizing now occupies the always-present properties panel outside the canvas, with native overlap assertions and successful side-face mouse pockets. Disabled solid-dimension cards pass pointer events through to geometry; all twelve native pointer regressions passed before the full gate. The full gate found and verified these obstruction fixes. File-job status is now a non-flow overlay so PNG encoding cannot resize/refit the viewport; strict native camera assertions and keyboard cancellation were verified. Older reference-display, optional-guidance and parameter-selector fixtures now exercise the intended UI. The pending validation entry has now been completed.

## Completed batch: first-part workflow

| Item | Requested change | Prism review | Reduced gate | Full gate |
| --- | --- | --- | --- | --- |
| 1 | Lightweight Model/Render presets and matching PNG | Anthropic `claude-sonnet-5-5`; no high/medium findings; four low notes assessed | Passed: type checks, 998 unit tests, build/bundle budget, 5 development and 14 production smoke tests; 7 additional native viewer/Render tests and 1 production Render CSP test | Not due |
| 2 | Simplified fabrication options and persistent completion actions | Anthropic `claude-sonnet-5-5`; no high/medium findings; one low test note assessed | Passed: type checks, 1029 unit tests, build/bundle budget, 5 development and 14 production smoke tests; native export/footer/ZIP tests | Not due |
| 3 | Compact Parts browser and contextual actions | Anthropic `claude-sonnet-5-5`; no high/medium findings; final low note assessed | Passed: shared frozen-checkout reduced gate, 1032 unit tests, type checks, build/bundle budget, 5 development and 14 production smoke tests; compact native Parts case | Not due |
| 4 | Associative center rectangles and owned-support deletion | Anthropic `claude-sonnet-5-5`; no high/medium findings; six low notes assessed | Passed: shared frozen-checkout reduced gate; 4 native rectangle workflows including XY/XZ parameter centers, undo/redo, save/open and STL | Not due |
| 5 | Direct single-region Finish Sketch thickness preview | Anthropic `claude-sonnet-5-5`; one medium missing-helper false positive verified; no actionable functional findings remain | Shared frozen-checkout reduced gate passed | Full stages verified: 1032 units, 242 development cases after targeted test-step repairs, 30 production cases |
| Additional | Remove startup question card; retain collapsed New part menu | Same reviewed first-part change; native Draw/Describe and compact theme cases passed | Shared reduced gate passed | Covered by the same checkpoint before completion |

Prism review `42e25361187ae950c8a18d6b6c5ac59a` covered the complete fabrication change. Earlier label, bounds and cancellation findings were fixed. The final low note concerns the scroll-container test: compact native coverage actually scrolls options and verifies reachable footer actions; desktop coverage verifies the footer stays outside that container. Separate-file checks now accurately exclude cross-file overlaps. The reduced gate passed on the integrated checkout, with a largest JavaScript bundle of 417.69 kB.

Prism review `9f83a6142b0afbbf57d91bdaaf2059d5` covered all sixteen Render files. The idle observation begins only after frame scheduling settles. Preset snapshots are private to mode switching; active controls use current grid/edge flags, with switch/reset tests. Fixed light counts/order enforce the bounded studio budget. Render grid visibility is intentionally optional and remembered independently. Final integration sources match the native-tested checkout exactly; geometry buffers, camera/picking, idle rendering, movement quality, PNG pixels and unchanged STL were verified. Largest JavaScript bundle is 414.41 kB within the 500 kB budget.

Prism review `dba73cb49b64e95fc76221217363bca8` covered all nine Parts files. Outside dismissal now blurs a dirty rename before hiding the disclosure; native checks verify rename, Escape cancellation and Undo. The remaining low note concerns unsupported detached-window DOM constructors; current docks all live in the app document. The reduced gate is shared by the parallel, frozen implementation items so identical broad checks need not be repeated. Largest bundle: 417.91 kB.

Prism review `54193d8e6ade405d5238bc5fcb5c68aa` covered all nine centered-rectangle commit files. Numeric native assertions preserve strict centered placement and compare free Corner sizes rather than promising an unconstrained position; project round trips preserve actual bounds. Helper namespaces are documented and tested with borrowed centers, external constraints, holes and reordered entities. Both cleanup predicates now preserve multi-point fixed constraints. Empty validate sketches have no existing intent to change; nonempty validate sketches receive actionable guidance. The shared menu helper supports the older startup card as well as the collapsed menu, keeping intermediate commits usable.

Fabrication test fixup: Prism `f74c1d464c683faa5d4328937254bead` reviewed the Cancel-action keyboard selectors (no high/medium; one low repetition note assessed). Both native keyboard cases passed, including radio-group focus wrapping and recovery. Type checking passed. This test-only fix belongs to item 2 and does not advance cadence.

Prism `e71f5f90769510418b97423827ad1a88` covered the complete 24-file first-part change. Its missing-helper medium finding is false: `e2e/newPartWorkflow.ts` was already tracked by preceding commit `1e1d469`, and all importing browser cases ran successfully. Native details expose their expanded state automatically; nested example disclosure state is retained deliberately. Current commands dispatch immediately and shared enablement defines all prerequisite keys. Earlier actionable error/enablement findings were fixed. Prism `c256122939a5946ce1dcaba063d23aa3` reviewed the remaining automatic-preview test step; its low note describes the intended new behavior.

The initial `release:check` invocation passed lint, all units and the build, then ended with 240 development passes and the two outdated keyboard/Finish test steps. After test-only corrections, lint and both affected files (3 cases) passed; all 30 production cases passed. All distinct tests of the full gate are therefore verified on unchanged runtime sources. This completed checkpoint resets cadence, and covers both first-part workflow requests. CI still executes the complete release command from a clean checkout.

## Current batch

| Item | Requested change | Prism review | Reduced gate | Full gate |
| --- | --- | --- | --- | --- |
| 1 | Direct native-validated retained cap-edge picks after Cut/Join | Anthropic `claude-sonnet-5-5`; no high findings; two medium policy/performance notes assessed and documented | Shared frozen-checkout gate passed: 1032 units, type checks, build/bundle budget, 5 development and 14 production smoke tests; 26 focused native geometry tests | All five new browser cases and existing treatment/reference cases passed in the completed checkpoint |

Prism `e4592bc940d0129a9d09ff794b185ad5` reviewed all twelve native-edge implementation/documentation files. Earlier contour-state, propagated-edge, unexpected-error, STL-bound and session-currency findings were fixed. Unsupported adapters intentionally get an authoritative empty target list: geometry without a native proof cannot authorize a pick. The shipped OpenCascade adapter implements the probe; fallback results omit native metadata. The medium eager-proof note is an accepted worker-rebuild tradeoff, measured by total `durationMs`/rebuild telemetry: small controlled workload p95 117.2ms, and the 64-edge chain case about 1.3s. Larger-part latency is not established; this limit is documented in the capability matrix.

Low findings were assessed: native fixture lookups are fixed analytic geometry and passed across all planes; a probe exception exits the entire owner scope before any builder could be reused; all scoped disposals passed resource assertions. Prototype spies are restored in the existing afterEach. Native viewer picks verify actual changed fillet/chamfer volume, orientation, parameter edits, split/smooth exclusions, same-ID stale rejection, save/open and positive STL volume. Runtime edge proofs never enter project JSON. This parallel item completed after the full checkpoint, so it begins the new cadence at item 1.

### Item 2: exact native edge-proof reuse

Prism `c8def01f3505d513a07de65794432267` reviewed all eleven isolated implementation/test/documentation files with Anthropic `claude-sonnet-5-5`: no high or medium findings. Its earlier stale-result benchmark finding was fixed by waiting for changed native volume and the edited expression. The remaining low cold-counter note was assessed against the deliberately fresh document/worker setup; cold probes and warm reuse are both independently asserted.

The exact commit checkout passed `npm run check:item`: type checks, 1036 unit/component tests, build/bundle budget (largest 417.91 kB), 5 development and 14 production smoke tests. Its additional 6 native cases passed: the 40-body cache benchmark, XY/XZ/YZ retained-edge treatments, split exclusions, and same-ID stale-preview rejection. The first temporary-checkout test attempt used a dependency symlink that Vite refused; local dependency paths fixed that test environment, then the complete gate passed. No runtime behavior was changed to relax those checks.

### Item 3: click-to-measure current model geometry

Prism `ad4c2f2881b5b2d2fba834629e0bad63` covered the isolated measurement implementation; fixup reviews `210fd6571b86261f3509666c58e2b05b` and `8f3f702fa1f50cc3d81d0a3d67c57571` covered its final guards and tests. All used Anthropic `claude-sonnet-5-5`. Actionable session reset, hidden-pair resolution, stale overlays, missing-path and positive-test findings were fixed. Final fixup review has no high/medium findings. Competing drafts are already excluded through `targetPickerActive`, which includes `interactionDraftBusy`; that medium note was a false positive. Low notes concern the documented bounded target set, ordered analytic fixtures, and placement helpers whose expected lost/budget errors use plain Error. Unexpected subclasses now propagate and a ReferenceError regression proves this.

The exact commit checkout verified every `check:item` stage: type checks, 1050 unit/component tests, build/bundle budget (largest 429.60 kB), 5 development and 14 production smoke tests. Both additional native click-measure cases passed, proving edge/endpoint/circle/plane values, units and stale handling. A concurrent development run initially cleared production trace artifacts during cleanup; the complete 14-case production smoke set then passed sequentially on unchanged runtime sources. Future browser runs remain serial within a checkout.

### Item 4: associative native Hole/pocket patterns

Prism `b148ba44a3b4d8b5f2f0a55281809006` reviewed all 31 isolated files using Anthropic `claude-sonnet-5-5`; no high findings. Its arc-test medium was clarified: envelopes are intentionally conservative, and the regression now checks enclosure of the actual semicircle extrema despite narrower sampled bounds. Fixup `bdc97b604b40fcb00059c66ec2d8c8de` found no high/medium issues. Remaining low notes were assessed: featureGraph already enforces upstream ordering; schema14 has a separate real-pattern production fixture, while legacy box fixtures stop at13. Typed field retention and the bound feature lookup follow the validated schema/upsert contracts. Native tests independently prove invalid-cut diagnostics.

`npm run check:item` passed on the isolated checkout: type checks, 1059 unit/component tests, build/bundle budget (largest 439.39 kB), 5 development and 14 production smoke tests. The clarified bounds test passed its 9-test focused rerun on unchanged runtime sources. All 3 native pattern cases and the additional built-app schema14 case passed, covering linear Holes, YZ circular pockets, source/count parameter changes, undo, save/open, STL and overlap/no-op refusal. Native BRep mass uses 1e-8 relative precision; the production three-decimal readout has its explicit rounding allowance.

### Item 5: associative native sketch projection

Prism reviewed the isolated projection implementation with Anthropic `claude-sonnet-5-5`; final command review `2ea20756786519b77653f3b6f36c26f3` has no findings. Earlier actionable current-result, read-only edit, lost-source diagnostic and no-op completion findings were fixed. Required dimension-reference types and complete document-timeline enumeration disproved the remaining medium notes. Production-test review `a02f1bb4c57a8128c250e3a06a1b7cf8` has no high/medium findings; disclosure currency, nonempty fixture intent and positive-winding/relative STL-volume checks were improved. Low formatting/cwd notes were assessed against the npm scripts and fixed analytic fixture. Native BRep volume assertions remain exact to the displayed precision; mesh tolerance is separate.

The full checkpoint verified type checks, all 1071 unit/component tests, the production build/bundle budget (445.60 kB largest), all 251 development cases and all 32 production cases. The original release command exposed a collapsed measurement disclosure and outdated body-selection steps in production tests. The complete production rerun passed 31 cases; the remaining linked-cover test passed after fixing its component body label, JSON key-order comparison and automatic export-dialog closure. Its final reviewed test and type checks passed again. Runtime sources stayed frozen. This verifies all full-gate stages and resets cadence; CI still runs the complete release command from a clean checkout.

Projection native acceptance proves source edits update linked geometry, save/open preserves links and IDs, unsupported oblique boundaries fail explicitly, and repair/break/remove use the current model. The production schema-15 fixture verifies two independent native solids, cover volume following width edits, coordinate orientation, saved links and multibody STL.

## Current batch: reusable projects

### Item 1: independent reusable-part insertion

Prism `de30d1e22f7b617009a16f5283bbfb83` reviewed the complete isolated 15-file insertion change using Anthropic `claude-sonnet-5-5`, with no high/medium findings. Supplemental final alias review `2f35925e075754ebb37d24d81058e999` covered the final importer and regressions, also with no high/medium findings. Earlier actionable stale-task/resource-bound findings and reference-ID cases were fixed. Explicit entities named `all` now remap correctly; profile aliases are scoped by sketch and preserve the worker's first-match ordering, with an unresolved first candidate refusing insertion. Focused tests cover cross-sketch and same-sketch alias collisions, actual copied geometry, cancellation, resource limits, units and ownership.

Low review notes were assessed: components currently contain only id/name; the size check uses the same pretty-printed portable save format; exact allocator retries test the bounded resource contract; stable and transient edge identities share the same format. Current readiness hooks subscribe to every competing task and their UI behavior is tested. Component activation is a synchronous existence-guarded store action. Native export is invoked through the development module API; insertion, Undo/Redo, parameter edits and Save use actual UI controls. Supported face/edge references are extrusion-owned; revolve solids are copied without inventing unsupported revolve topology references. Profile geometry matching remains bounded by import limits.

The exact commit checkout passed `npm run check:item`: type checks, 1101 unit/component tests, production build/bundle budget (largest 460.57 kB), 5 development and 14 production native smoke tests. The final focused native insertion case passed (4.6s), proving independent parameter edits, exact BRep volumes, source-origin orientation, real toolbar Undo/Redo/Save, reopen and selected-part STL. The latest production projection test also passed after its final mesh-tolerance-only test correction; application runtime sources stayed frozen.

This is the first completed item after the successful full checkpoint above. The next full gate is due after four additional requested changes. Reusable insertion creates independent editable copies at shared original coordinates; placement transforms, joints and external linking remain planned.

### Item 2: incremental native feature rebuilds (2026-10-08)

Prism reviews `0b803a2a144d172d8765ff967c572e83`, `df9a111e96b7d1eaafe4141004019560`, and `1d7e8dac21656f11d2730a92b1ec4468` covered the complete isolated cache change using Anthropic `claude-sonnet-5-5`. Final ownership fix review `c69a30cf6f624b82b85799cfc33e3492` covered the fallible mesh-copy ordering, regression and documentation. Actionable nonfinite-input, unadmitted-version churn, exception rollback and native-copy ownership findings were fixed. Its remaining medium removal-version note is false: removed and changed body versions are cleared before staging, including staging failure, undefined admission and removal-only deltas. Treatment-history notes were checked against the closed KernelHandle union (only kind/base) and unsupported treatment edge-proof signatures; no native target handles are omitted.

Low findings were assessed against bounded admission before copying, per-rebuild counter reset in begin(), required native volume validation, the fixed 40-body fixture within cache limits, and trusted plain-data histories. Failed admission may evict committed entries to preserve combined pending/committed resource bounds. No cold-feature modeling warnings are skipped; warning generation remains outside the reused modeling branch.

The final isolated checkout passed `npm run check:item`: type checks, 1115 unit/component tests, production build/bundle budget (largest 460.57 kB), 5 development and 14 production native smoke tests. Both focused native cases passed: 40-body cold/warm/changed-dependency benchmark and failed-cut/rapid-edit/fresh-worker equivalence. Warm rename executes zero modeling operations with unchanged native geometry, IDs, winding, volume and disposal checks. Cache storage estimates exclude native allocation size, which is separately bounded by shape count. The initial temporary dependency copy needed executable symlinks repaired; final gates ran with local dependency paths.

Cadence: 2 completed items since the last successful full checkpoint; full gate remains due after 3 more requested changes.

### Item 3: saved rigid component placement (2026-10-08)

Prism `10ab41cff7274654d16e87a5dfbbffd6` reviewed the complete isolated placement change using Anthropic `claude-sonnet-5-5`. Follow-ups `a1ce2a40838c1f43602074f884bac6c5` and `6dee391472c3d3927ed6cb77e7e363b3` covered final UI, schema, mesh and worker-plane fixes. Native ownership review `91b42d631d0e126048f1771f9533795d` has no high/medium findings. Actionable field/proof gating, effect dependencies, nested scrolling, event cleanup, empty/nonfinite mesh guards, equality and compatibility expectations were fixed. The remaining missing-plane fallback note is intentional: worker-backed missing native plane proof keeps Revolve unavailable; an available posed worker plane is converted back to design coordinates without main-thread solving. Invalid placements are already rejected by validateDocument before any plane resolution, so that medium corrupted-document note is false.

Low notes were checked against snapped trigonometric values, bounded handle rendering, the closed KernelHandle union, idempotent outer disposal, and DOM-only command usage. copyHistory allocates only plain data; a real-WASM regression proves noncloneable metadata allocates no clone/placement handles. Native metadata preparation now precedes allocation for both copy and placement, hardening the previous cache item without advancing cadence. Reusable insertion retains saved poses; existing design-coordinate associations stay intact, and new cross-component picks require matching poses. Performance documentation distinguishes historical edge-proof-only timings from feature reuse.

The final isolated checkout passed `npm run check:item`: type checks, 1150 unit/component tests, production build/bundle budget (largest 465.38 kB), 5 development and 14 production native smoke tests. The final pointer/keyboard placement acceptance case passed, including Escape, exact translation/Z rotation, unchanged native BRep volume, one Undo/Redo, save/open, parameter edits and positive-winding STL bounds. Two focused production cases passed: schema16 two-body X/Y/Z poses and the migrated schema15 associative cover, including IDs, geometry, save/open and multibody STL. Earlier failures were stale body-label/schema-version test expectations, corrected before the successful final gate.

Cadence: 3 completed items since the last successful full checkpoint; full gate is due after 2 more requested changes.

### Item 4: click-to-project native cap boundaries (2026-10-08)

Prism `c862f80d140b6815a5e5da9fa56bdd2e` reviewed the complete isolated picker change with Anthropic `claude-sonnet-5-5`. Final fixup review `6eafa0da6df028c8b3288e711bf08cb0` has no high/medium findings. Resize now preserves the fitted/orbited camera; empty bounds are ignored, frame paths avoid unchanged updates and lookups use a map, and compatible sources receive the bounded display budget before incompatible diagnostic outlines. Initial native mouse tests clicked clipped outlines; they now scroll the actual target into view and require elementFromPoint to prove it receives the real mouse click.

Remaining low notes were assessed: unposed design planes are required for compatibility with the design-coordinate projection planner, rather than comparing a posed proof normal against an unposed destination; native complete-cap choices have unique feature/role IDs. The exposed-point retry is bounded by the browser test timeout and passed in the actual mouse workflow. Unsupported oblique/fragmented sources remain explicitly diagnostic; display curves never authorize Apply without native proof.

The exact isolated checkout passed `npm run check:item`: type checks, 1163 unit/component tests, production build/bundle budget (largest 465.42 kB), 5 development and 14 production native smoke tests. All 4 additional native projection cases passed (23.5s), including mouse/keyboard choices, one Undo, source edits, save/open, repair/remove/break links, unsupported oblique refusal and YZ native coordinate orientation. Unit regressions cover camera preservation and eligible sources after 170 incompatible sources.

Cadence: 4 completed items since the last successful full checkpoint. The next requested item requires the full release gate before its commit.

### Item 5: direct pattern arrangement controls (2026-10-08)

Prism reviewed the complete isolated change with Anthropic `claude-sonnet-5-5`. Initial review `cfe61b7967ea021253b1c78d7d4d5094` identified render-time ref mutation, which was replaced with committed preview state. Final complete review `09b180f70062156772af0ba8cf58ede3`, gesture fixup `03758fcfe8087b01d4ee09564d5353ed`, browser typing fixup `f7c8db83984ff8e6feb085c82dce9ce3`, and viewer restoration review `ceb1a993a3337014cf90fb5a99c010b8` had no high/medium findings. Remaining low notes were assessed against the frozen drag transform, angular-delta grab preservation, current native preview identity, and fixed browser viewport; geometry checks independently validate hole walls rather than assuming tessellation seam angles.

Pattern spacing, circular center and sweep now support direct pointer arrangement with parameter-expression protection, cancellation, stale preview labeling and native proof before Apply. The 22 focused pattern tests and both native pattern cases passed, proving a substantive 18mm spacing change, signed YZ sweep, native cylindrical boundaries, exact saved expressions and durable geometry. Browser mesh access now respects the ArrayLike contract.

The initial full gate passed all unit/build checks and 256 of 257 development browser cases, but full-quality restoration took 511.5ms against the unchanged 500ms limit. A focused repeat measured 513.1ms. Reducing the idle scheduling delay from 100ms to 50ms fixed both viewer performance cases; actual sharp restoration also includes full-resolution frame time. This change retains input/damping guards and does not relax the assertion. The clean full release rerun then passed on the frozen final checkout.

The clean `npm run release:check` passed type checks, all 1185 unit/component tests, production build/bundle budget (largest 471.36 kB), all 257 development browser cases and all 33 production cases. The full run also passed both viewer performance cases after the fix.

Cadence: the successful full checkpoint resets the completed-item count to 0.

## Current batch: local part library

### Item 1: persistent reusable parts with native thumbnails and drag/drop (2026-10-08)

Prism reviewed the full isolated library implementation with Anthropic `claude-sonnet-5-5`: initial `5a9eeef4e109efd68a160892b675cefd`, final complete `7462e2b39b860edbbb5323b890a04e93`, and final drop/ray/canvas fixups `1da4a765d346cfb3de5c23afefc53a07`, `e3adbf81238dc4d9e5ebc53a4f0a6767`, `485e7f792d5da95f82238cbd71f1340f`, and `61be6246eb74123ca4d7b86b4ed9445b`. Actionable abort/session handling, quota recovery, cross-tab rename, missing canvas and invalid-origin findings were fixed. The final complete review's two medium notes were false positives: mesh indices are number[] under the adapter contract, and model coordinates are Z-up with an identity model group. Final fixup reviews have no high/medium findings. Remaining low test-tolerance notes were assessed against the controlled viewport, strict screen reprojection bounds and independently asserted native/STL geometry.

The exact final runtime passed `npm run check:item` in an independent local checkout: type checks, all 1214 unit/component tests, build/bundle budget (largest 489.68 kB), 5 development and 14 production native smoke tests. Its isolated servers used ports 5283/5284 to avoid the concurrent full checkpoint; only temporary browser harness origins differed. The first isolated production attempt used old hardcoded storage origins; these fixture origins were corrected and the complete reduced command then passed. A comparison verified all 476 src/server files and the package/build inputs match the final workspace runtime.

All 3 focused native library cases passed on port 5281, and the final owned-canvas pointer locator passed its focused rerun. They verify real 192x192 PNG persistence, reload, drag/drop native preview, cancel without history, independent copied parameter edits, Undo/Redo, save/open and positive STL; storage limits/quota, atomic cross-tab rename, overfilled-store recovery, unsafe JSON rejection, damaged-row deletion and confirmed library-only reset. The 29 focused library unit/component tests passed.

The library is local to this browser and stores bounded independent copies. Saved parts must be self-contained; unsupported external dependencies produce a diagnostic. Drop positions use the owned canvas and XY world plane; Move component provides further placement. No assembly joints or external live links are introduced.

Cadence: 1 completed item since the successful full checkpoint above. The next full gate is due after 4 more requested changes.

## Current batch: alignment, portability and interchange

### Item 2: snap and align native component geometry (2026-10-08)

Prism Anthropic `claude-sonnet-5-5` reviewed the complete isolated alignment change: initial `9d5d0861733a6255cf2d270287474ec5`, final `0965639bf9907005bdf44bd5b7cb8b8e`, and final test/documentation delta `9dc53640ab79df1516c424d90222eb9d`. Actionable degenerate-normal handling, bounded complete face-marker scans, gesture cancellation and pending-alignment status were fixed. Final reviews have no high/medium findings. Low marker notes are documented: display centroids may lie between coplanar regions, while exact plane roles govern placement. The final unit assertion intentionally checks the deterministic canonical, snapped Euler pose in its fixed opposite-normal fixture; independent math tests compare transformed directions at gimbal poses.

The isolated checkout passed `npm run check:item`: type checks, all 1224 unit/component tests, build/bundle budget (largest 489.68 kB), 5 development and 14 production native smoke tests. All 3 additional native alignment/placement cases passed on the final runtime, proving actual face-marker pointer choice, signed clearance, straight-edge rotation, endpoint cancellation, preserved native BRep volume/solid count, one Undo, save/open, parameter edits and placed positive STL. The final stronger saved-pose assertion and documentation received focused unit/type checks and the delta review; runtime sources stayed unchanged. Initial browser failures exposed overlapping face markers and disabling a dirty clearance field, both fixed before final validation.

Alignment produces static rigid placements using supported native points, straight edges and planar face roles. Face alignment preserves tangential translation, and has no collision avoidance, mate or joint. Lists remain available when display marker budgets or overlap prevent a pointer choice.

Cadence: 2 completed items since the last successful full checkpoint; the full gate is due after 3 more requested changes (the fourth item in this implementation batch).

### Item 3: associative projection between placed components (2026-10-08)

Prism reviewed the isolated implementation with Anthropic `claude-sonnet-5-5`: initial `d036c0d30ff912d695a9e2b9094b0517`, complete final `e89af189148ce6b5d76e4ce09c92eabe`, and follow-ups `cb440e01ad08b5cf8d93cc8400b43786`, `50e62bda62d0670b627656a1f232db60` and `f0b9e8a602572793413de25c12d39990`. Actionable repair guards, finite native tolerances and unit-normal checks were fixed. Final reviews have no high/medium findings; the final runtime follow-up has no findings. Low production-fixture label/regex notes are controlled constants.

The exact isolated runtime passed `npm run check:item`: type checks, 1239 unit/component tests, build/bundle budget (largest 489.83 kB), 5 development and 14 production native smoke cases. All 5 focused development cases passed (33s), proving differently placed XY/XZ/YZ analytical boundaries, opposite-normal arc winding, source/target movement, one Undo/Redo, durable parameters and save/open, STL orientation, actual stale results and failed oblique/no-op-cut placement. All 3 focused production schema cases passed (12.1s), covering new schema 17 world links and preserved schema 16/15 projects. Initial production body-label and reopened-result synchronization expectations were corrected before the final pass; runtime sources stayed unchanged. The final 61 focused unit tests and type check passed.

New links retain analytical world-coordinate associations across parallel placed planes. Legacy links keep authored-coordinate semantics. Traced world-link consumer bodies may change volume during placement; independent source bodies must retain native validity, solid count and volume. Oblique, missing or unsupported references fail explicitly.

Cadence: 3 completed items since the last successful full checkpoint; the full gate is due after 2 more requested changes.

### Item 4: portable editable part-library backups (2026-10-08)

Prism Anthropic `claude-sonnet-5-5` reviewed the complete transfer change: `9de280cb7a2bcf213348e206e570ca34`, `2d50fc33d09f9919bbd30383f5964c1b`, `99895858eee34bbc3e60b20a85439cab` and final `e07bef64ff0a26f412eaee13a4b99768`. Worker ordering, cancellation and dismissal guards were strengthened. Atomic transaction-abort regressions prove rollback rather than partial writes. The final review has no findings.

The frozen independent checkout passed `npm run check:item`: type checks, all 1253 unit/component tests, build/bundle budget (largest 495.48 kB), 5 development and 14 production native smoke cases. Its temporary harness used ports 5292/5293; source/server files and all 14 owned files were compared byte-for-byte against the sequential commit checkout. All 5 additional library/transfer browser cases passed (22.5s), verifying native editable downloads, portable backup/import, independent copies, reload, original library operations and invalid-input safety. The 43 focused unit tests passed, including bounded envelope validation, quota failures and actual canceled-transaction rollback.

Complete `.pcadlib` backups validate every stored entry before download; imports preview and atomically add fresh independent entries. Individual downloads remain editable `.pcaddoc` projects. Corrupt or overfilled libraries cannot silently produce partial backups. Transfer payloads preserve existing project safety checks and resource limits.

Cadence: 4 completed items since the successful full checkpoint. The next requested item requires the full release gate before its commit.

### Item 5: exact concave and tangent line/arc outline offsets (2026-10-08)

Prism reviewed the complete isolated change with Anthropic `claude-sonnet-5-5`: initial `bc53a2c11e7c9fdd4c5df05329572fb6`, complete final `ea37260327164bed08829baa62917763` and final delta `17fbee059f9f534d1774dd3334a30707`. Actionable finite-arc contact, provenance, limits and diagnostic findings were fixed. The complete final review has no high/medium findings; the final delta has no findings. Remaining closure-tolerance notes were checked against the actual 1e-8 endpoint epsilon and mandatory full solve/native preview.

All 65 focused unit/component tests passed. The final isolated `npm run release:check` passed type checking, all 1263 unit/component tests across 157 files, build/bundle budget (largest 495.48 kB), all 272 development browser cases (29.9m) and all 34 production cases (2.8m). All 7 offset acceptance cases passed in that full run: original convex/circle cases and new concave XY plus exact tangent line/arc XZ/YZ contours, native extrusion, history, parameter behavior, save/open, STL and collapse diagnostics. Earlier focused checks also passed all 7 native cases and all 3 new cases after final runtime fixes. An initial browser-copy run encountered Vite reload/recovery interference; the frozen final checkout and full gate passed cleanly. Both unchanged viewer performance assertions passed; full-quality restoration measured 491.2ms and zoom restoration 68ms against the unchanged 500ms limit.

Simple concave whole-line outlines now use exact miters; mixed whole-line/arc contours retain analytic arcs at tangent arc joins. Fragmented, nonsmooth, crossing, collapsed or disconnected results fail explicitly. Copies remain ordinary editable geometry with bounded source/solver limits, rather than associative offset features. The finite-arc fragmentation guard now rejects actual finite contacts without treating supporting-circle crossings outside an arc as geometry contacts. Documentation also corrects obsolete matching-placement summaries and records schema 17 fixtures.

Cadence: the successful full checkpoint resets the completed-item count to 0.

### Item 1 after full checkpoint: validated native STEP export (2026-10-08)

Prism reviewed the complete implementation with Anthropic `claude-sonnet-5-5`: `89663da86d6b9c01ac776a82905303cf` and `783be623e10b3732de70c6396d262ef5` have no high/medium findings. Follow-ups `a07e68da93617bac1d3a38942e50b84f` and final `e1f92001e7de6783196f65660f4ac4c5` covered ownership, bounded protocol decoding and native assertions; the final source delta has no findings. Browser reviews `7ca9e5d8202cf79470ed75af65d6293d`, `89f71ff563c7d27fa4ccdbe52575e94a` and final formatting `e2dcb4b8e770bdc51daa1bb006a9989d` have no high/medium findings; the final delta has no findings. Actionable cleanup, single-use worker, full-buffer main-thread decoding, formatting and float-assertion notes were fixed. Remaining cache notes are intentional: export uses a disposable worker with native feature reuse disabled and clears its private cache. The installed-binding availability flag enables an isolated export worker, rather than direct main-thread native export. Distinct and overlapping bodies prove native root order for the shipped writer/reader; native binding types follow the existing adapter boundary. Exact worker-error text is a tested diagnostic contract with actual retry recovery.

The independent frozen checkout passed `npm run check:item`: type checks, all 1276 unit/component tests across 160 files, production build/bundle budget (25 bundles, largest 497.93 kB), 5 development smoke cases (36.7s) and 14 production smoke cases (52.8s). Its temporary harness uses 5294/5295. All src/server files match the sequential commit checkout; 508 recorded runtime/test hashes remained unchanged during validation. Provenance is `/tmp/plaincad-step-reduced-gate-hashes.json`, SHA-256 `9d49a0ce0a2e995b3ba3e7336a3d1dfd7ff4b1b9767dc928a9a77ba623cf8d11`. The final browser helper differs only by reviewed formatting and explicit braces around existing single-statement conditions; both spec hashes and runtime sources are identical.

All 13 focused STEP tests passed, including actual installed-WASM curved subtractive solids, separately transferred overlapping/distinct placed bodies, BRep volumes/bounds, failure cleanup, resource limits and current protocol proofs. All 3 development STEP acceptance cases passed (17.2s), and the built native STEP/CSP case passed (7.5s). They verify public body selection, native writer-to-reader proof records, actual downloads, saved X/Y/Z poses, parameters/Undo/save/open, running/prepared same-ID stale rejection, cancellation, real worker executable failure and retry. An initial build exceeded 500 kB; splitting generation and the client behind the lazy export panel fixed the budget without relaxing it.

STEP exports 1–64 selected native bodies as separate solids in millimetres at saved world positions. Actual reimport must preserve native validity, solid/root counts, exact volume and bounds before Download is enabled. The installed filename-binding incompatibility uses bounded synchronous task-owned filesystem routing in the disposable worker, with restored hooks and no substituted geometry. Files are limited to 32 MiB and 60 seconds. Component labels, assembly hierarchy and editable history remain in the project file; STEP import is not exposed.

Cadence: 1 completed item since the successful full checkpoint above; the next full gate is due after 4 more requested changes.

## Current batch: usability consistency

### Item 1: contextual canvas actions (2026-10-08)

Prism Anthropic `claude-sonnet-5-5` reviewed the complete canvas implementation,
initial `6e9900ab2c38f4e988640b56b2b93d15`, final complete
`6b286294eb766bfde1ece657d6bcda46`, and documentation
`27ba2431bced5bc1c6a3afac1628e080`. Whole-store rerenders, pointer drag lifetime,
right-button pan timing, ambiguous multi-selection, stale menus and disabled-command
handoff were fixed. Final reviews have no high/medium findings. Two low notes were
assessed: selecting the intended feature remains useful when its editor reports an
error, and the explicit keyboard handler prevents its native default; the verified
Chromium Shift+F10 path preserves the selected body and restores focus.

The frozen isolated checkout passed `npm run check:item`: type checks, all 1281
unit/component tests, build/bundle budget (largest 492.44 kB), 5 development native
smoke cases and 14 production CSP/modeling smoke cases. Five focused canvas tests
and the final native context-menu/drag/double-click/edit/delete/Undo case passed.
Two existing native PNG cases passed, including clean ORBIT exports. Native volume
was restored after Undo, and Hide preserved the document/history.

Earlier validation attempts exposed a duplicate lazy declaration and bundle excess,
both fixed. Sandbox loopback restrictions required the normal escalated gate.
Changing a running Vite snapshot caused a transient page error; overlapping browser
runs also collided in trace artifacts. The final successful gate used frozen source
and a single browser run. The export panel and PNG implementation load as separate
chunks, preserving the 500 kB budget.

Canvas actions edit or remove the creating feature; deleting it preserves the source
sketch and can require dependent-feature repair. Arbitrary topology editing is not
inferred. Keyboard/pointer acceptance was performed in Chromium; human usability
sessions remain unperformed.

Cadence: 2 completed items since the last successful full checkpoint. The full gate
is due after 3 more requested changes (item 4 of this usability batch).

### Item 2: automatic local sketch previews (2026-10-08)

Prism Anthropic `claude-sonnet-5-5` reviewed the complete panel/helper implementation
`37da7b835733cd93a7a0ac6e4d7f0167`, final deltas
`1b70e252d8f0dc4a381a771e508f3d6f` and
`8984e2dc73d9f15c4801536392289b9f`, and documentation
`3a6c6993a6bbb0d64fee852c4f4465b7`. Actionable transient-input alerts, unsupported
automatic projection, proof invalidation, debounce cancellation and display-only
budget handling were fixed. The final runtime delta and documentation have zero
findings; all reviews used the requested provider/model.

The ordered isolated snapshot passed `npm run check:item`: type checks, all 1291
unit/component tests, build/bundle budget (largest 492.44 kB), 5 development native
smoke cases and 14 production CSP/modeling smoke cases. The 43 focused tests and
19 distinct native offset/replication/trim/projection workflows passed, including
automatic native proofs, Apply, cancellation and old repair/orientation regressions.
The projection-links component is extracted without changing its pre-item-4
behavior; the next linked-usability item updates it separately.

Concurrent validation exposed a pre-existing STEP test fixture scheduling a real
debounced rebuild over its fabricated native protocol result. The fixture now
installs its history/result atomically and explicitly disables its test-owned
rebuild action; production behavior is unchanged. The final test-only delta passed
all 5 STEP tests and type checking after the reduced gate, with zero findings from
Prism `d0087fdeae7dcf222dc2ef7913d3b3b1`. Frozen runtime hashes stayed unchanged.

Offset, Mirror/Pattern, Trim/Extend and projection coalesce valid edits after 250 ms,
clear old Apply proofs immediately and retain manual Preview retries. Details hides
less common settings; diagnostics remain visible. These local native previews do
not contact an AI provider. Unsupported projection choices diagnose; a display-only
overlay budget does not disable an otherwise valid named boundary.

Cadence: 3 completed items since the successful full checkpoint. The full gate
is due after 2 more requested changes (item 4 of this usability batch).

### Item 3: two-pick component alignment (2026-10-08)

Prism Anthropic `claude-sonnet-5-5` reviewed the complete final alignment change
`539672dc1958c8b60222db3fef94b646` and documentation
`c2638b719f5ccb91823026374b1c33da`, both with zero findings. Earlier preview
invalidation, unavailable-target, marker-visibility and numeric-details findings
were addressed before the final review.

The ordered isolated snapshot passed `npm run check:item`: type checks, all 1294
unit/component tests, build/bundle budget (largest 492.44 kB), 5 development native
smoke cases and 14 production CSP/modeling smoke cases. All 16 focused tests and
3 native placement/alignment workflows passed. The full checkpoint also passed
those native workflows with the other new usability controls present. Final
alignment files and source/runtime hashes matched the reviewed/tested bytes; only
temporary harness origins differed.

Pick source geometry, then destination. The destination pick, signed Gap and Flip
refresh the native placement preview automatically. Exact numeric pose controls
remain under Details; supported visible geometry has source/destination markers
and named keyboard lists remain available. Cancel edits nothing; Apply saves one
validated static rigid pose in one Undo step. Arbitrary curved/boolean topology,
collision avoidance and assembly joints remain outside this picker.

Cadence: 4 completed items since the successful full checkpoint. The next requested
item requires the full release gate before commit.

### Item 4: linked sketch provenance and source controls (2026-10-08)

Prism Anthropic `claude-sonnet-5-5` reviewed the complete source/UI change
`4abeee3cfcbc09aa6072607be8c85c47` and final complete shared-command integration
`dc458351a26f8fb995c3142f125f3f56`. Final reviews have no high/medium findings.
Actionable cross-component selection, unfinished-input preservation, source-opening
ordering, native-highlight proof, accessible labels and fixture assertions were
fixed. The remaining low notes concern intentional component-preserving selection
and bounded per-link enablement work. Individual cards check their precise link,
and handlers revalidate the captured document/session/link; a broad shared
capability flag does not select a different source.

The frozen ordered checkpoint passed `npm run release:check`: type checks, all
1301 unit/component tests across 163 files, build/bundle budget (largest 496.15 kB),
all 283 development native browser cases (31.6 minutes) and all 35 production cases
(2.9 minutes). This includes every new canvas/automatic-preview/alignment/link
workflow, existing sketch/geometry/worker/resource regressions, schema migrations,
security headers, production PNG and native STEP. All 636 captured source/test/
configuration files remained unchanged during the gate; temporary origins used
ports 5292/5293. All 13 focused linked tests and 7 additional native source/repair
workflows also passed.

The already-reviewed STEP fixture from item 2 was copied into the checkpoint only
after its successful full run; all 5 focused STEP tests and type checks then passed.
This was a test-only follow-up, with no runtime changes. README/capability updates
received the complete integration review.

Linked curves show dashed styling, badges and source provenance. Show source
retains the destination component/drawing; Edit source opens its authoring sketch
and protects incomplete drawing/drag/inline-edit input. Repair link and Make
independent retain explicit native/solver guards, while whole-link removal explains
downstream repair. Lost/unsupported references diagnose rather than guessing.

Cadence: 0 completed items since this successful full checkpoint. The next full
gate is due after 5 more requested changes.

### Item 5: unified Save/export goals (2026-10-08)

Prism Anthropic `claude-sonnet-5-5` reviewed the complete eight-file implementation
`98c0f16357ac0512de5534ff4bb366c6`, final selection-guard delta
`ca0e9534db4df05e314ab01ef1b7f2a0` and documentation
`6fefec76871e50e5850fb54d9c3eb1a9`. All actionable findings were addressed:
observable mock assertions, readiness subscriptions, semantic selection currency,
clear busy/handoff labels, accessible values and readable native test steps.
Final delta and documentation reviews have zero findings.

The fully integrated frozen checkout passed `npm run check:item`: type checks,
all 1315 unit/component tests across 164 files, build/bundle budget (largest
496.16 kB), 5 development native smoke cases and 14 production CSP/modeling smoke
cases. All 39 focused hub/PNG tests passed, including deferred-encoding stale
selection and same-part reselection. Three focused native hub/PNG/ORBIT workflows
passed, and a final integrated hub case passed again after the other usability
changes. The built hub's dedicated STEP/PNG CSP case passed on the final integrated
build, with native STEP reimport volume/solid-count/world-bounds proof and real
PNG pixels.

Source/runtime hashes matched the root workspace. The reviewed STEP fixture's
final no-op action was copied after the successful reduced gate; all 5 focused
STEP tests and lint then passed. No runtime/build changes followed the gate.
The successful item-4 full checkpoint is commit `47df069` above.

Save or export presents editable project, printing STL, other-CAD STEP, PNG image
and complete local-library backup goals. STEP and library open their existing
selection/validation controls; opening options never claims a download. A saved
selected sketch opens its drawing for its existing PNG action. Active drawing
retains that workspace's PNG control and must finish/cancel before opening the
hub. Handoffs capture current document/session/result/selection, close the modal
before shared commands run, and reject stale contexts. Part PNG repeats semantic
selection checks after encoding. Editable project history stays in .pcaddoc; STEP
does not introduce editable import or assembly joints.

Cadence: 1 completed item since the successful full checkpoint above. The next
full gate is due after 4 more requested changes.

## Current batch: inviting visual workbench

### Item 1: real project gallery (2026-10-08)

File → Project gallery and New part → examples open a searchable gallery with ten
actual native example images, complexity labels, recent manual-save copies and
optional five-second rotating native previews. Loading retains project replacement
protection. Covers are bounded, hash-matched to the saved copy and optional; damaged
recent copies remain diagnosed through Recovery. The shared cover projection now
matches the modeling viewport's +X/-Y/+Z isometric frame.

Prism Anthropic `claude-sonnet-5-5` reviewed the complete gallery integration
(`1b5ca5b6ac086a3c51b07988599133ca`) with no high/medium findings. Earlier
geometry/orientation, stale-load, resource and cache findings were fixed. Its two
remaining low notes concern awaiting an optional cover and silently declining an
unavailable cover; these keep manual-save/gallery completion deterministic and
preserve the downloaded editable file. Final cover/test review
`201b1dcc07baaf1771c0138bf8105a81` has complete coverage and zero findings.

`npm run check:item` passed: type checks, 1328 unit/component tests, production
build and bundle budget (largest 497.49 kB), 5 development native smoke cases and
14 production CSP/modeling cases. The final overlapping-triangle test was added
after the gate without runtime/build changes; all 14 gallery/cover tests then
passed. The exact integration additionally passed four native gallery/library
workflows and a production gallery CSP/PNG workflow. Recent covers use the actual
native tessellation, not the current studio finish. Browser storage retains at
most five manual copies; downloaded project files remain the portable source.

Cadence: 2 completed items since the successful full checkpoint above. The next
full gate is due after 3 more requested changes.

### Item 2: Saturn instrument-console identity (2026-10-08)

Saturn adds restrained machining, illuminated active controls and numeric readout
treatments to the same workbench layout. Rebuild states use real current success,
working and failure styling; themes do not change geometry or control positions.
No JavaScript, animation or rendering passes are added. Forced-colors removes
custom shadows and textures while preserving usable controls.

Prism Anthropic `claude-sonnet-5-5` reviewed the final change
(`72cf52dcd97d3b2a5a4fdad9de9cf7f9`): complete coverage, no high/medium findings.
The forced-colors specificity finding was fixed; a remaining low scope concern
was disproven by application structure and real computed-style checks.

`npm run check:item` passed: type checks, 1328 unit/component tests, build and
bundle budget (largest 497.49 kB), 5 development native smoke cases and 14
production cases. Focused native acceptance proved actual 80000→failed invalid
parameter→100000 mm³ geometry, unchanged theme layout, keyboard focus, reduced
motion and forced-colors behavior. Visual screenshot inspection passed. The
additional gallery cover unit added afterwards changes no runtime/build bytes.

Cadence: 3 completed items since the successful full checkpoint. The next full
gate is due after 2 more requested changes.

### Item 3: native before/after build stories (2026-10-08)

History hover/focus shows immutable native timeline prefixes with a shared
isometric frame, changed/removed parts, solid counts and native material-volume
changes. A bounded isolated worker rasterizes depth-correct thumbnails using
OffscreenCanvas; the main document/history/result/camera remain unchanged.
Current parameters are used at each step. Edits, leaving and Escape invalidate
old proof. Native/OffscreenCanvas, first-160-step, 25000-triangle/frame and 30-second
limits are documented in TIMELINE_BUILD_STORY.md.

Prism Anthropic `claude-sonnet-5-5` reviewed all source files with complete
coverage (`1778021a8d7a98073ecf4797ed670989`), and the final fixes with zero findings
(`24be26016652503161511bdb0406ccfc`). Native orientation, cavity visibility,
resource limits, cancellation and unknown-feature descriptions were corrected.
Final integration review `bb81ac14434fa6d43c5faeaf95eafd79` has no high/medium
findings; its two low notes concern compact event-handler formatting and a
non-null Map iterator guarded by a four-entry minimum. README/guide links and
limits were checked against source. Saturn integration supplemental review
`526b451c6f84c7f9894dcb8dc91ba9c1` has no high/medium findings; its low styling notes
are intentional theme decoration/forced-color overrides and representative
computed-style coverage backed by the universal reset.

`npm run check:item` passed: type checks, 1338 unit/component tests, build/bundle
budget (largest 498.19 kB), 5 development native smoke cases and 14 production
cases. Ten focused story tests and native/deployed CSP cases passed, proving an
asymmetric 80×50 box and off-center bore at (+20,-10), actual cylindrical vertices,
volume reduction, PNG pixels, stale-proof rejection and unchanged project/camera.
Thumbnail screenshots were visually inspected. The final gallery overlap unit
adds one independently passing test without runtime/build changes.

Cadence: 4 completed items since the successful full checkpoint. The next item
requires the full release gate before its commit.

### Item 4: purposeful workbench motion and native confirmation (2026-10-08)

Docks, selected History steps and contextual controls use short 120–140 ms arrival
transitions. Reduced motion disables effects. The brief “Model updated” notice
requires changed, accepted native positions/indices and valid positive-volume
solids; failed/fallback results, draft clicks, metadata-only changes and project
replacement cannot claim a geometry update. Feedback changes no history/camera
and schedules no idle WebGL frames.

Prism Anthropic `claude-sonnet-5-5` reviewed the final motion change with complete
coverage (`362ea2278b04503fd90e0d190db25146`), no high/medium findings. Its low
notes concern transient UI-test timing and lazy motion styles: native acceptance
passes with a settled renderer before idle assertions, component tests prove the
notice lifetime, and optional motion shares the always-mounted feedback chunk to
preserve the initial bundle budget. Earlier native reviews and final idle-readiness
changes were also reviewed; the development source imports are deliberate test
instrumentation with separate built-app acceptance.

`npm run release:check` passed: type checks, 1343 unit/component tests,
production build/bundle budget (largest 498.48 kB), all 288 development native
browser cases and all 38 production cases. This includes gallery, Saturn, native
History previews, reduced-motion confirmation, idle renderer/resource checks,
project compatibility, save/open and fabrication. Native confirmation proved an
80000→100000 mm³ edit and no idle-frame churn. Studio was developed and validated
in a separate frozen prefix while this checkpoint ran. The interrupted temporary
run was not counted; these are results from the completed fresh full gate.

Cadence: the successful full checkpoint resets the count to 0. The next full gate
is due after 5 more completed requested changes.

### Item 5: product photo studio (2026-10-08)

Render opens a collapsible Photo studio with original, metal and powder-coat
approximate finishes; theme, neutral, warm and midnight backdrops; standard CAD
camera compositions; and full-resolution native project PNG export. Display
settings reuse geometry buffers/materials and stay outside project JSON/history.
Model restores source colors; reopening resets session settings. Studio and Views
load lazily with contained panel failures. Camera and command-load failures produce
specific diagnostics without applying stale settings to another project.

Prism Anthropic `claude-sonnet-5-5` reviewed the final integration with complete
coverage (`78b891d1e24018c8c3aa89382e43b7cf`), no high/medium findings. Earlier
camera-read, command-error and reopen-readiness findings were fixed and tested.
Remaining low notes were assessed: the bounded PNG corner readers are duplicated;
PNG capture synchronously refreshes current appearance at full resolution before
encoding; rejected stale/internal controls deliberately leave the new context
unchanged; Model-mode finish commands are guarded before applying display state.
Native tests additionally verify different rejected finish values. The compact
panel was visually checked and its explanatory copy shortened.

`npm run check:item` passed: type checks, 1356 unit/component tests, production
build/bundle budget (largest 497.44 kB), 5 native development smoke tests and 14
production CSP/modeling smoke tests. Six focused native Render/Studio/motion cases
and two production Render/Studio cases passed. They prove changed PNG pixels,
CAD camera axes, native geometry preservation, stale-control rejection, unchanged
history/camera/resources, idle rendering, save/open resets and reduced-motion
keyboard operation. The approximate metal finish has no directional brush texture,
shadow maps or additional render passes; see PHOTO_STUDIO.md.

Cadence: 1 completed item since the successful full checkpoint. The next full
gate is due after 4 more requested changes.


## AI canvas workflow batch (2026-10-08)

### Item 1: assistant inside the modeling canvas

The compact AI launcher and expandable assistant now live inside the main viewport
in Workbench, Minimal and Full layouts. Opening it preserves camera, geometry and
dock sizes; hiding it retains descriptions while pending native work is canceled.
The bottom AI control is a launcher. Lazy assistant failures are contained and
command failures report an actionable diagnostic.

Prism Anthropic `claude-sonnet-5-5` reviewed the final 20-file integration
(`6acfe986f5caa0e50fd853952c213c53`), complete coverage, no high/medium findings.
The missing outer lazy-chunk boundary was fixed. Two low notes were assessed:
focus occurs after the lazy textarea commits and existing child focus effects
cover reopening; the two small entry-point error handlers intentionally contain
failures independently. Earlier isolated browser-runner origin configuration was
corrected before the successful gate; failed runs are not counted.

`npm run check:item` passed: type checks, 1364 unit/component tests, production
build/bundle budget (largest 497.24 kB), 5 development native modeling/stale-result
cases and 14 production modeling/AI/CSP cases. Five focused native cases and two
production canvas-shell cases also passed, covering retained drafts, three
layouts/themes, native editing, stale targets, undo, STL export and lazy loading.

Cadence: 2 completed items since the successful full checkpoint. The next full
gate is due after 3 more requested changes.


### Item 2: selected targets and direct native face picking

The embedded assistant follows a single current part, supported feature, sketch
or planar face, with explicit scope overrides and read-only target highlights.
Body selection allows only independent drivers affecting that body. Invalid,
shared, multiple, stale, hidden and unsupported targets fail with clear diagnostics.
Clicking a supported model face routes bounded additions, retaining fresh sharing
consent. Captured selection/visibility changes invalidate responses and Apply.
Starting AI is guarded during manual operations; closing it remains available.

Prism Anthropic `claude-sonnet-5-5` reviewed the final 14-file integration
(`497e8c003087a851cd330334aeec2c96`), complete coverage. Actionable scope/opening,
visibility, picking order and stale-test findings were fixed. Two medium reports
were assessed as false with source evidence: targetPickerActive explicitly includes
guidedHoleActive; cancel is memoized with useCallback([]), so Follow cannot reset
on callback identity churn. Low duplicated-reset/catch notes were assessed; initial
face-status wording is improved by the next canvas-preview change. The sibling
review independently reported the same two false medium findings.

`npm run check:item` passed on the final frozen source: type checks, 1370
unit/component tests, build/bundle budget (largest 499.36 kB), 5 development
native smoke cases and 14 production modeling/AI/CSP cases. Two focused native
selection cases passed (8.9 s), proving narrow provider context, rejected expanded
edits, delayed stale-response rejection, and a deliberate face click followed by
a real native inward cut with unchanged project/history until Apply.

Cadence: 3 completed items since the successful full checkpoint. The next full
gate is due after 2 more requested changes.


### Item 3: native proposals in the existing drawing/model viewport

Native AI part and feature proposals now render full-project geometry through the
existing CadViewer and camera, highlight affected bodies, and offer Before/After.
Solved sketch proposals overlay the existing drawing coordinates in cyan. Apply
requires the same displayed proposal and current native frame. Cancel, close,
selection/project changes and unmount release runtime geometry. Export/picking are
guarded, including cancellation and immediate PNG capture before buffer disposal.
The main viewer is lazy-loaded to keep the measured JavaScript budget below 500 kB;
its identity is retained through sketch/layout transitions.

Prism Anthropic `claude-sonnet-5-5` reviewed the final 26-file integration
(`dc7bb12c1f79fab841ed3abac3f3dcc2`), complete coverage. Native export-race handling,
stable ownership callbacks, development subscription cleanup and explicit stale
sketch status were fixed. The medium body-ID/JSON.parse note was assessed against
captureAiFeatureAddition: facePocketFaces requires a live bodyId and selection is
locally captured with JSON.stringify. Low reactive-frame, ownership, per-body
material, visibility and DEV-only diagnostics notes were assessed against source
and focused native tests; no unresolved actionable findings remain.

`npm run check:item` passed on final frozen source: type checks, 1396 unit/component
tests, production build/bundle budget (largest 459.23 kB), 5 development native
smoke cases and 14 production modeling/AI/CSP cases. Nine focused native AI cases
passed, including all three provider choices, XY/XZ/YZ feature cuts, actual chamfer,
camera/orientation checks, cancel/PNG transition, stable IDs, save/open and STL.
Twenty-six focused sketch/overlay tests passed. An initial parallel test-output
collision was corrected with separate trace directories before successful reruns.

Cadence: 4 completed items since the successful full checkpoint. The next requested
change requires the full release gate before commit.

## AI canvas item 4 — guarded undo and redo (2026-10-08)

Each AI Apply is one normal project-history transaction. Canvas controls expose
ordinary project Undo/Redo and guarded latest-AI Undo/Redo; local “undo that” and
“redo that” use the same command availability without a provider request. Exact
session/document/history adjacency prevents undoing intervening manual changes.
Project replacement clears runtime provenance. Keyboard requests respect busy and
file-operation guards, including active sketches. Generation waits for a settled
current accepted rebuild and explains pending/failed source readiness.

Prism Anthropic `claude-sonnet-5-5` reviewed the final 26-file integration
(`674c37dc2ea861829a19b22602612cfd`), complete coverage: no high findings, one medium
and five low notes assessed against source and native tests. The medium suggestion
to remove source readiness conflicts with the reproduced new-project accepted-result
race and the main-canvas proposal contract. Busy keyboard handling and misleading
sketch feedback were corrected; store reset, active-sketch setup and fresh command
availability claims were checked. No unresolved actionable findings remain.

`npm run release:check` passed: type checks, 1411 unit/component tests, production
build and bundle budget (largest 460.61 kB), all 301 development browser cases
(33.1 minutes) and all 40 production cases (3.4 minutes). This satisfies the
per-item reduced gate and resets the five-item cadence. Focused native history,
sketch-history, 13 AI regression cases and contextual-target regression also passed.
Earlier incomplete runs exposed a genuine unsettled-source race and legacy tests
assuming creation after automatic feature targeting; both were corrected before
the successful full run. Controlled provider responses test modeling behavior;
Prism uses the requested live Anthropic model.

Cadence: **0** completed items since this successful full checkpoint.

## AI canvas item 5 — contextual follow-ups and proposal repair (2026-10-08)

After Apply, canvas conversations retain bounded complete turns and refresh the
current editable target. Automatic selection follows a single new body; explicit
scope choices remain explicit. Exact relative requests such as “make it half as
thick” or “increase width by 2mm” resolve current parameter values, require a clear
target and preserve stable IDs. Compound/negated requests are not partially applied.
“Fix that” carries the original failed request and latest bounded diagnostic,
without nesting older repairs or changing the project before explicit Apply.
Project/selection/source changes expire failure context. Sketch and face follow-ups
require fresh sharing consent and current native geometry; lost faces ask for a
new target. New requests clear older failures, including when the new request
times out; timeouts require a fresh description rather than replaying stale repair
context. Runtime conversation/provenance data stays out of project JSON.

Prism Anthropic `claude-sonnet-5-5` reviewed the final 18-file delta
(`7c8f6d117e3933166d6831205ce654cb`), complete coverage: no high findings, one medium
and ten low notes assessed. Its medium component-mocking note is covered by
separate real capture/currentness/Apply command tests and native same-face
hole→pocket acceptance. The timeout stale-failure issue found during the earlier
review was reproduced and fixed in both panels, with regression tests; file-busy
history coverage now seeds an actual reversible AI transaction. The memo catch
uses its explicit follow-up input. Other notes concern intentional DEV-only test
imports, current store subscriptions, timer cleanup, fixture isolation, optional
refactoring and retaining existing CAD precision rather than silently rounding
persisted dimensions. No unresolved actionable findings remain.

`npm run check:item` passed on final frozen source: type checks, 1484 unit/component
tests, production build/bundle budget (largest 460.61 kB), 5 development native
modeling/stale-result smoke tests and 14 production modeling/AI/CSP cases. Eight
focused native follow-up/repair cases passed (44.5 seconds), including actual
OpenCascade volumes, stable IDs, one-step undo/redo, original-request diagnostics,
same-face and same-sketch follow-ups, fresh consent, all three provider choices
and shared bindings. Component timeout regressions verify no unintended provider
call or document mutation. Provider responses are controlled in browser tests;
Prism used the requested live Anthropic model.

Cadence: **1** completed item since the full release checkpoint recorded for
AI canvas item 4 (commit `db2533a`). Run the next full gate after four more items.

## Docked AI text and controls (2026-10-08)

AI now uses the shared resizable bottom dock in Workbench, alongside History and
Issues. Focused and Full layouts expose the same docked AI content. Descriptions,
input, responses, settings and history controls stay inside the scrolling dock;
geometry proposals still use the existing model/sketch canvas. One retained editor
preserves descriptions across closing, tab switching and layout changes. Switching
away or collapsing cancels previews and requests. Opening focuses the visible
input; closing restores the tab focus. Shared idempotent ai.close prevents repeated
close requests from reopening AI. Hidden content is guarded in all three layouts.

Prism Anthropic `claude-sonnet-5-5` reviewed the final change with complete coverage
(`6931a9ba3895458db411d7943d7f59e1`): no high/medium findings, five low notes assessed.
Earlier actionable findings were fixed: one reconciliation effect, idempotent
close, focus keyed on actual dock visibility, hidden-panel styles, deterministic
late-response checks and resize assertions based on initial values. Remaining
notes concern isolated route teardown, clearer test preconditions, the existing
command-error channel and optional store consolidation. All three panel wrappers
use bottom-dock-body; ai.close and runCommand perform synchronous store edits.
No unresolved actionable findings remain.

`npm run check:item` passed: type checks, 1487 unit/component tests, production
build/bundle budget (largest 461.86 kB), 5 development native modeling/stale-result
smoke tests and 14 production modeling/AI/CSP cases. Twelve focused native AI
checks passed (51.5s): all layout/theme combinations, containment/resizing, retained
input/focus, cancelled native proposal and delayed-response rejection, actual
OpenCascade create/relative edit/undo/repair, selected-body/native-face targeting,
and all three provider sketch paths. Four final layout/cancellation checks passed
again after the final hidden-style adjustment. The extra built-app dock/CSP test
passed with actual STL volume 3072 mm³ and preserved input. Provider replies in
these browser tests are controlled; Prism uses the requested live Anthropic model.
Full release checks are not due at this item.

Cadence: **2** completed items since full checkpoint `db2533a`. Run the next full
gate after three more completed items.
