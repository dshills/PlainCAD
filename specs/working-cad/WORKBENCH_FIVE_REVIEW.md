# Workbench follow-up review record

This batch implements readiness guidance, named Draw/Describe entry points,
consistent modeling tasks, authored solid dimension labels, and expanded default
Workbench validation. Each item received a separate staged Prism review with
Anthropic `claude-sonnet-5-5`. Every final item review reported complete coverage,
with no skipped or truncated files and no high-severity findings.

## Review disposition

| Item | Final reviewed files | Reported medium / low | Disposition |
| --- | --- | --- | --- |
| Readiness guidance | 5 | 0 / 3 | Initial rebuild scheduling rules out indefinite idle guidance. Native analytic volume checks remain strict. The UI action test verifies history preservation; the pure-helper assertion adds no independent proof. |
| Named first part | 12 | 2 / 3 | Both command handlers trim and bound names before publication; synchronous preparation and workflow identity checks prevent duplicate publication. Added regressions exercise padded names and duplicate callbacks. SVG uses `preserveAspectRatio="none"`; bounds assertions now use numerical tolerance. Shared name-validation cleanup remains optional. |
| Modeling tasks | 19 | 0 / 6 | Tests create fresh drafts in `beforeEach`. The kernel explicitly supports authored profile aliases, which are preserved and regression-tested. Modal focus and native preview guards remain owned by existing dialogs. Advanced name-error routing uses the existing string error API. Optional disclosure-state and structured-error cleanup remain follow-ups. Hole retains the accessible name “Cancel hole,” which includes its visible Cancel label; other consumers use the default Cancel name. |
| Solid dimensions | 7 | 0 / 0 | Fixed edit-command enablement, cached layout measurements and removed fragile post-command focus lookup before the final review. |
| Workbench validation | 6 | 0 / 3 | Added an explicit fixture-profile diagnostic. Hole status is explicitly named; other tested dialogs each have one status region. Analytic native volume assertions remain independent from STL tessellation tolerances. |

The additional first-part regression review raised one medium concern about
unawaited command calls. Those tests intentionally invoke synchronous preparation
twice in the same event tick to exercise duplicate-callback protection; they do
not invoke asynchronous modeling or provider calls. Documentation review raised
one cross-diff link concern; the linked implementation documents exist in this
batch. Reported findings were assessed against surrounding source and observed
behavior, rather than treated as proof of a defect by themselves.

Follow-up production review prompted explicit body selection, numeric readout
validation, observable empty-project state before reopen, retrying Cancel/load
checks, an idempotent file menu and a relative keyboard dock-resize assertion.
After those test-only changes, the two-file production/fixture review reported
zero findings with complete coverage. The final keyboard test review also reported
zero findings after explicitly excluding the enabled operation-target command
from the disabled-command Enter scenario.

## Validation

The final uninterrupted `npm run release:check` passed on all final reviewed tests:

- TypeScript checking passed.
- All 742 unit/component tests passed across 92 files.
- The production build passed.
- All 187 development native browser cases passed in 20.3 minutes.
- All 27 production CSP/native-worker cases passed in 2.1 minutes.

All application behavior and acceptance-test changes were complete before this
gate began. Only this documentation record was updated afterwards. The application
patch relative to base commit `3ce4490634fca7ff5d1d047a61fd59eaf9e2be79` had SHA-256
`6dee1bf37f0584a4ed145c3f95efc7404e2f92017bd2d2aae47185182fde60ef`
both before and after the gate. After this batch is committed, reproduce it with
`git diff 3ce4490634fca7ff5d1d047a61fd59eaf9e2be79 HEAD -- src server | shasum -a 256`.

Visual inspection confirmed the dimension label, retained formula, native edit
preview, Cancel behavior and restored keyboard focus. The screenshot is an ignored
local design artifact, not project data.

Human usability sessions have not been conducted. See
[the prepared pilot](WORKBENCH_VALIDATION.md) for recruitment groups, tasks and
observable success measures. AI browser acceptance uses deterministic provider
responses with real native geometry; live paid provider calls are outside this
release gate. The CAD kernel/viewer still emit the documented large-chunk build
warning.
