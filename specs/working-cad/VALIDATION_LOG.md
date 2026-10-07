# Validation cadence

Run Prism with Anthropic `claude-sonnet-5-5` and `npm run check:item` for every
completed requested change. Run `npm run release:check` on the fifth item, before
its handoff or commit. Fixup commits belong to the same item. Record results here
with each item; reset the count only after the full gate succeeds. If this log is
missing or the count cannot be determined, establish a baseline with the full gate.

## Last successful full gate

- Date: 2026-10-07.
- Change: bundle splitting, commit `f12e025`.
- Result: type checks, build/bundle budget, 960 unit/component tests,
  224 development browser tests, and 29 production browser tests passed.
- Completed items since that full gate: **3**.
- Next full gate: item **5**, after two more completed items.

## Current batch

| Item | Requested change | Prism review | Reduced gate | Full gate |
| --- | --- | --- | --- | --- |
| 1 | Five-item full gate and per-item reduced gate | Anthropic `claude-sonnet-5-5`; no high/medium findings; two low notes assessed | Passed: type checks, build/bundle budget, 960 unit tests, 5 development and 14 production smoke tests | Not due |
| 2 | Keep fitted models and previews visible through dock/canvas resize | Anthropic `claude-sonnet-5-5`; no high/medium findings; actionable fit findings fixed | Passed: type checks, build/bundle budget, 966 unit tests, 5 development and 14 production smoke tests; 7 additional native viewport/preview tests | Not due |
| 3 | Clear success feedback and readable parameter editing | Anthropic `claude-sonnet-5-5`; no high/medium findings; four low notes assessed | Passed: type checks, build/bundle budget, 975 unit tests, 5 development and 14 production smoke tests; 6 native parameter/status/deformation tests | Not due |

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
