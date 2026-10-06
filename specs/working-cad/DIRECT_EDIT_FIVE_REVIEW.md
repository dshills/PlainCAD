# Direct-edit workflow review and validation

Date: 2026-10-06. This batch implements five priorities in parallel and integrates
shared task ownership before handoff. Implementation is separated into five commits;
the full release gate validates the integrated implementation.

1. Finish an unmodeled Workbench sketch, explicitly choose its highlighted closed
   region, Make solid, inspect native geometry and Apply. Selection elsewhere in
   Project cannot change the captured sketch/profile or Edit sketch destination.
2. Edit authored solid driving fields in a compact native preview. Explicitly
   choose a shared parameter or feature-formula replacement. Preserve IDs/bindings,
   one Undo, Cancel and exact stale-frame/worker-result rejection.
3. Pan sketches without CAD edits; expose Move/Translate/Deform, analytic bounded
   intersection/tangent inference and Alt snap bypass. Preserve completed click
   drafts while cancelling interrupted press-drag shapes.
4. Refine rectangles and selected horizontal/vertical lines through local bounded
   AI intent. Review/preview/Apply preserve existing expressions and IDs. Authored
   unbound solved seeds restore geometry on Undo. Worker proof rejects cross-plan
   result reuse, even with the same project ID.
5. Validate native first-part creation in Chromium, Firefox and WebKit under CSP,
   repair compact dock occlusion and preference semantics, and prepare human and
   assistive-technology follow-up without inventing participant results.

## Prism review

All reviews used Prism with Anthropic `claude-sonnet-5-5`, without a substitute.
Item reviews, the complete integrated diff and subsequent scoped fixes were
reviewed. Coverage was complete with zero skipped chunks and zero truncated bytes.
No high-severity findings were returned.

Actionable findings led to regressions and fixes for draft preservation during
pan, interrupted pointer capture, deterministic snap ordering, bounded outline
filtering and small-segment intersections; dimension editor size, stale result
subscriptions and provenance; parameter/formula choices and shared task guards;
AI positive lengths, no-op/timeout guards, source/result identity and Undo seeds;
and compact dock preferences, keyboard state, opaque contrast calculations and
independent cross-engine CI coverage. Shared runtime edit stores were moved to a
leaf module to remove their initialization cycle.

Remaining low notes were checked against implementation: dev-only source imports
are confined to development acceptance; the native modal really has dialog
semantics; feature fields are revalidated at command entry; complete profiles
refer to solved lines; bounded schema limits prevent unbounded preview arrays.
AI prompt state lives in the mounted parent, and its sketch branch now also has
the advertised aria-controls target. Edit sketch deliberately selects the captured
sketch as part of navigation; it creates no CAD history. Test titles now describe
selection/currency checks, while separate tests prove exact Make solid ownership.
A primitive capture starts only when there is no earlier click draft, so discarding
that interrupted press-drag does not remove a completed anchor. The new inline
limit document exists and is linked from the capability matrix.

The five coherent commit snapshots were checked independently. Shared-wiring
reviews raised hypotheses that were checked against their helpers: Make solid
intentionally consumes its existing operation frame, and that frame rejects
scope capture and competing drafts; `canMakeSketchSolid` has a current-store
argument default; `runCommand` rechecks enablement before dispatch; and inline
editing's availability helper already checks file jobs, canvas, export and
competing tasks. Shared commands cannot open those tasks during an inline edit.
The leaf module removes runtime-store initialization cycles; command entry modules
still import the functions they execute. Intermediate pre-AI commits deliberately
use a false refinement flag, replaced by the real store in the AI commit.

The final keyboard review found that Space over native sketch help summaries
could prevent their activation. Summary/link/ARIA-control activation is now
preserved, with a regression test, while canvas Space and toolbar navigation
remain available. Gesture cancellation uses the latest committed callback through
a layout effect. The final low-priority suggestion to override Space on SVG
ARIA buttons was declined: those controls retain their advertised keyboard
action, while the canvas background still supports Space panning.

Review files are local evidence in `/tmp/plaincad-next-*-review.json`; the named
run IDs and final check outcomes are recorded below after the release gate.

## Browser and usability evidence

The six-case production matrix passed on Chromium, Firefox and WebKit against the
current build. Each engine created a non-template 30 × 20 × 6 mm part, inspected
one solid with native volume 3600 mm³, saved, cleared/reopened the project, and
exported STL with positive matching signed volume. No page errors or CSP violations
were reported. This covers one concrete workflow, not all operations on all engines.

Measured contrast for the opaque start text / Draw button was Light 5.949 / 6.196,
Dark 8.782 / 8.821 and Saturn 8.286 / 10.340. The same samples passed on each engine.
Keyboard focus outline, initial compact hit targets, Project/Details toggles and
preservation of desktop preferences passed. A reduced 683 × 450 viewport checks
layout space equivalent to 200% zoom, not actual browser/OS zoom.

An in-app-browser audit inspected and saved screenshots of the current handoff,
full compact dimension preview with Apply/Cancel visible, and repaired 685 × 954
empty-project layout. Keyboard opening and Escape cancellation restored the value
label without changing the authored dimension. Temporary tabs were closed and the
viewport override reset. Screenshots live in ignored `design-artifacts/direct-edit-audit/`.

Human pilot sessions, live screen-reader speech, real browser zoom and high-contrast
OS sessions are not completed. Use [the usability checks](WORKBENCH_USABILITY_CHECKS.md)
and [human pilot protocol](WORKBENCH_VALIDATION.md) to conduct that work. Automated
contrast samples and semantic/focus checks do not establish global accessibility.

## Review run evidence

| Scope | Run ID | Files | Coverage | High |
| --- | --- | ---: | --- | ---: |
| dimension | `473d4c577a4288dccb00b030cc36c8ca` | 11 | Complete | 0 |
| final | `a89bdb5d115cc1adf3422580e4d28842` | 56 | Complete | 0 |
| handoff | `2eb04dbb3eafac81f5c7f2a24928f5d9` | 12 | Complete | 0 |
| last-fixes | `0419d9e63136777a257405408a2bd1b7` | 20 | Complete | 0 |
| mouse | `231c2f2084760be2ba5d3ab9e3f41292` | 8 | Complete | 0 |
| refine | `f1b8e22396548dd730934654a02d3809` | 10 | Complete | 0 |
| source-binding | `07097e1d39caa48d3b8e41adb9a23d3d` | 3 | Complete | 0 |
| usability | `c0530897a9a0f02b071bb2c1bb6ddb66` | 10 | Complete | 0 |
| verified | `bdf099f6bd6898fce74a483233e5351c` | 59 | Complete | 0 |
| step-1 | `1c618abd0025ddc962f6f420db80a239` | 4 | Complete | 0 |
| step-2 | `ce1e3a34e3028c1dbfdeee9c11e97481` | 5 | Complete | 0 |
| step-3 | `235911d0844d2558b7578574328c96cd` | 4 | Complete | 0 |
| step-4 | `68dbf2bf37a6b5c8df2408f0c12a2e42` | 3 | Complete | 0 |
| keyboard | `9a7dfdc7e9c068a716e2ffdddeee81aa` | 2 | Complete | 0 |
| keyboard-final | `153230c975c290158ea8ed3199d99184` | 2 | Complete | 0 |

| readiness-test adaptation | `62aed521ec292d6423a197d382cceb64` | 1 | Complete | 0 |

## Commit snapshot validation

Each of the five coherent snapshots passed TypeScript checking. Their relevant
focused tests passed: sketch handoff/operation targeting 24; dimension inspection,
editing and UI 13; mouse/snapping 29; refinement/AI drawer 25; compact Workbench and
layout 8. The mouse keyboard regression was rerun in snapshots 3–5 after the final
fix. These checks complement the integrated release gate rather than five separate
full native release runs.

## Integrated release checks

`npm run release:check` passed TypeScript checks, all 100 unit/component test files
(793 tests), and the production build. The development suite passed 192 cases;
two existing readiness assertions expected the old `ready-sketch` task after
Finish. Both now expect the explicit `sketch-handoff` task, and the modeling case
uses Make solid before the native preview. The affected two cases passed on rerun
(6.7 seconds); Prism reviewed that test-only adaptation with no findings. All
194 development browser cases therefore have passing evidence against this
unchanged application source. The complete development suite was not repeated
after those test-only expectation changes. TypeScript was rerun successfully.

The final production cross-engine matrix passed all six cases in 23.0 seconds.
The production build retains expected large viewer/kernel chunk warnings; these
are warnings, not build failures. Production CSP results are recorded below.

The standalone production CSP suite passed all 27 cases in 2.1 minutes, including
native workers, schema migrations, all five inline-edit operations, save/open,
STL and compact keyboard controls. It was run separately because the initial
release command stopped at the two obsolete development assertions. Application
source and the production build were unchanged by their test-only correction.
