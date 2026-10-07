# Validation cadence

Run Prism with Anthropic `claude-sonnet-5-5` and `npm run check:item` for every
completed requested change. Run `npm run release:check` on the fifth item, before
its handoff or commit. Fixup commits belong to the same item. Record results here
with each item; reset the count only after the full gate succeeds. If this log is
missing or the count cannot be determined, establish a baseline with the full gate.

## Last successful full gate

- Date: 2026-10-07.
- Change: Rectangle workflow and selection-based reference dimensions, commit `dbc4dea`.
- Result: type checks, build/bundle budget, 994 unit/component tests,
  228 development browser tests, and 29 production browser tests passed.
- Completed items since that full gate: **4**.
- Next full gate: item **5**, after one more completed item.

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

## Current batch

| Item | Requested change | Prism review | Reduced gate | Full gate |
| --- | --- | --- | --- | --- |
| 1 | Lightweight Model/Render presets and matching PNG | Anthropic `claude-sonnet-5-5`; no high/medium findings; four low notes assessed | Passed: type checks, 998 unit tests, build/bundle budget, 5 development and 14 production smoke tests; 7 additional native viewer/Render tests and 1 production Render CSP test | Not due |
| 2 | Simplified fabrication options and persistent completion actions | Anthropic `claude-sonnet-5-5`; no high/medium findings; one low test note assessed | Passed: type checks, 1029 unit tests, build/bundle budget, 5 development and 14 production smoke tests; native export/footer/ZIP tests | Not due |
| 3 | Compact Parts browser and contextual actions | Anthropic `claude-sonnet-5-5`; no high/medium findings; final low note assessed | Passed: shared frozen-checkout reduced gate, 1032 unit tests, type checks, build/bundle budget, 5 development and 14 production smoke tests; compact native Parts case | Not due |
| 4 | Associative center rectangles and owned-support deletion | Anthropic `claude-sonnet-5-5`; no high/medium findings; six low notes assessed | Passed: shared frozen-checkout reduced gate; 4 native rectangle workflows including XY/XZ parameter centers, undo/redo, save/open and STL | Not due |

Prism review `42e25361187ae950c8a18d6b6c5ac59a` covered the complete fabrication change. Earlier label, bounds and cancellation findings were fixed. The final low note concerns the scroll-container test: compact native coverage actually scrolls options and verifies reachable footer actions; desktop coverage verifies the footer stays outside that container. Separate-file checks now accurately exclude cross-file overlaps. The reduced gate passed on the integrated checkout, with a largest JavaScript bundle of 417.69 kB.

Prism review `9f83a6142b0afbbf57d91bdaaf2059d5` covered all sixteen Render files. The idle observation begins only after frame scheduling settles. Preset snapshots are private to mode switching; active controls use current grid/edge flags, with switch/reset tests. Fixed light counts/order enforce the bounded studio budget. Render grid visibility is intentionally optional and remembered independently. Final integration sources match the native-tested checkout exactly; geometry buffers, camera/picking, idle rendering, movement quality, PNG pixels and unchanged STL were verified. Largest JavaScript bundle is 414.41 kB within the 500 kB budget.


Prism review `dba73cb49b64e95fc76221217363bca8` covered all nine Parts files. Outside dismissal now blurs a dirty rename before hiding the disclosure; native checks verify rename, Escape cancellation and Undo. The remaining low note concerns unsupported detached-window DOM constructors; current docks all live in the app document. The reduced gate is shared by the parallel, frozen implementation items so identical broad checks need not be repeated. Largest bundle: 417.91 kB.

Prism review `54193d8e6ade405d5238bc5fcb5c68aa` covered all nine centered-rectangle commit files. Numeric native assertions preserve strict centered placement and compare free Corner sizes rather than promising an unconstrained position; project round trips preserve actual bounds. Helper namespaces are documented and tested with borrowed centers, external constraints, holes and reordered entities. Both cleanup predicates now preserve multi-point fixed constraints. Empty validate sketches have no existing intent to change; nonempty validate sketches receive actionable guidance. The shared menu helper supports the older startup card as well as the collapsed menu, keeping intermediate commits usable.

Fabrication test fixup: Prism `f74c1d464c683faa5d4328937254bead` reviewed the Cancel-action keyboard selectors (no high/medium; one low repetition note assessed). Both native keyboard cases passed, including radio-group focus wrapping and recovery. Type checking passed. This test-only fix belongs to item 2 and does not advance cadence.
