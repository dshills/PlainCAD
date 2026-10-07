# Validation cadence

Run Prism with Anthropic `claude-sonnet-5-5` and `npm run check:item` for every
completed requested change. Run `npm run release:check` on the fifth item, before
its handoff or commit. Fixup commits belong to the same item. Record results here
with each item; reset the count only after the full gate succeeds. If this log is
missing or the count cannot be determined, establish a baseline with the full gate.

## Last successful full gate

- Date: 2026-10-07.
- Change: Associative native sketch projection, including the preceding edge-proof cache, click measurement and feature-pattern items.
- Result: type checks, 1071 unit/component tests, build/bundle budget (largest 445.60 kB), all 251 development browser cases and all 32 production browser cases verified.
  The complete release invocation passed development and initially had two production test-step failures. After test-only fixes, the complete production rerun passed 31 cases; the remaining projection case passed its final focused rerun (3.9s). Final type checks passed. Application sources remained unchanged throughout these runs.
- Completed items since that full gate: **1**.
- Next full gate: after **4** more completed items.

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
