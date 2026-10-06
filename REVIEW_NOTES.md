# Docked workbench review

Prism reviewed the staged change with Anthropic `claude-sonnet-5-5` on 2026-10-06.
The first run covered 37 files / 13 chunks without truncation: zero high, five
medium and nineteen low findings. The lockfile was inspected separately; the
compatible `source-map-js` patch removed the install-time alert (`npm audit`: zero
vulnerabilities). Review reports are local `/tmp/plaincad-workbench-prism*.json`.

## Findings addressed

- `setPanel("auto")` no longer opens Properties or writes layout preferences.
- Shared command buttons catch synchronous throws and asynchronous failures and
  report them in the existing visible banner as a command error. Tests cover both.
- Dock CSS dimensions have default tokens; App supplies bounded local overrides.
- App/bottom dock subscriptions select their actual inputs. Resize notification
  is coalesced with animation frames and cancelled on cleanup.
- Details focus return uses a stable opener ID. Bottom and Project close/escape
  return focus to controls that remain visible.
- Feature headers/action rows size intrinsically; duplicate CSS blocks are merged.
  The storage notice is anchored below its location bar.
- Extrude instructions follow termination. Advanced disclosure has its own state
  and stays open when its own select returns to Distance; Chromium covers focus
  retention and cancellation without a document edit.
- Hole's context warning no longer uses preview-success styling. Actual preview
  status distinguishes ready from pending/unavailable.
- The new browser coordinate helper checks both bounds and the SVG viewBox.

## Findings checked against source and browser evidence

- AI remains mounted when `WorkbenchBottomDock.enabled` is false. The legacy AI
  tests and native Minimal workspace flows pass; it was a cross-chunk uncertainty.
- `WorkbenchBreadcrumb` supplies `workspace-parts-toggle`; the close-focus tests
  verify it. The global viewer query observes a permanently mounted region;
  CSS bounds provide fallback and observers/listeners dispose on unmount.
- Dedicated development browser suites intentionally bind layout seed origins to
  strict port 5279. The existing Full seed uses the same contract. Production
  tests seed their own strict port 5280. This is not a portable deployment value.
- Workbench intentionally shares Minimal's progressive sketch disclosure; Full
  retains expanded controls. `.docked-workbench [hidden]` explicitly wins the
  cascade, including filtered component nodes.
- Full-width selects are the deliberate feature-form contract. Preview meshes
  were uniformly cyan before this change; the new uniform draft color is also
  intentional. The color effect follows mesh creation, updates after meshes/theme
  change, and never changes CAD mesh data. Grid/material resources are disposed
  by their owning preview.

No review finding is accepted as justification to silently weaken native geometry,
preview freshness, explicit Apply, history, persistence or export validation.

## Final staged review and responsive corrections

The second staged review covered 39 files / 13 chunks completely, with zero high,
four medium and eighteen low findings. Two medium cross-chunk uncertainties
(AI legacy rendering and Project focus target) repeat the verified dispositions
above. Two responsive cascade findings were actionable: dialog and preview-frame
base rules now precede breakpoint overrides. The native browser test additionally
asserts a 220px phone preview and zero left offset, with reachable Thickness/Apply.

Additional low findings addressed: global stubs always restore in afterEach;
remaining documentation names Minimal workspace consistently and labels captures
local-only; Breadcrumb/Details select only their required workbench fields;
dialog cleanup removes positioning properties; Through All guidance reflects
whether bodies are selected.

Other reviewed suggestions are intentional contracts: left tab/open preferences
are durable local navigation preferences; bottom open/task tabs are transient;
registry enablement is context-independent and rechecks current state when run;
file/model commands already guard busy/draft state; native modal tasks prevent
background dock movement; users may deliberately close Advanced after choosing
termination, with validation still requiring valid input. Geometry assertions in
each acceptance helper differ by operation; no unrelated helper refactor was made.

The follow-up review of ten changed files completed with no findings. Additional
manual phone checking then exposed reversed-flex scrolling that could place a
focused control behind the bottom dock. Phone content uses explicit preview-first
grid rows instead; the browser assertion checks Thickness bounds against the
actual visible scroll area, not merely the browser viewport.

The final correction review (`plaincad-workbench-prism-grid.json`) also covered
ten files / two chunks completely with no findings, using Anthropic
`claude-sonnet-5-5`. No provider/model substitution was used.

## Production compatibility fixture correction

The release run passed type checking, 705 unit tests, build and all 182 development
browser tests. Its two production Minimal-workspace cases initially assumed that
fresh storage still defaulted to Focused. They now explicitly seed that retained
layout for production port 5280. Development and production compatibility cases
share `focusedWorkspaceStorageState`; Full fixtures retain the same payload. No
application code or built assets changed for this test-fixture correction.

## Validation result

- Type checking passed, including the final shared fixture.
- All 705 unit/component tests passed.
- Production build passed, with the expected large CAD/viewer chunk warning.
- The full development acceptance suite passed all 182 tests.
- After fixing the production-only layout assumption, the clean, isolated
  production acceptance suite passed all 21 tests. A briefly overlapping rerun
  invalidated test downloads because development cleans the parent output folder;
  it was discarded and both suites were rerun serially.
- The final shared-fixture/default-workbench compatibility rerun passed 13 cases.
- Prism reviewed the five fixture/document changes completely with zero findings
  using Anthropic `claude-sonnet-5-5`. The earlier complete staged review plus
  correction reviews cover the implementation; actionable findings are resolved.

`npm run release:check` was run as required. Its initial production phase failed
two compatibility fixtures; all phases subsequently passed on the unchanged
application code/built assets after correcting and reviewing only test fixtures.
The already-passing full development suite was not repeated for that fixture-only
correction; the affected development cases and full production phase were rerun.
No release test was disabled or weakened.
