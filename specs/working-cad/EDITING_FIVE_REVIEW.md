# Editing workflow increment: review and validation

This increment completes five bounded priorities: finite-line Trim/Extend,
contextual selected-geometry relations, supported planar-face pockets, opt-in
provider sketch conversation, and automated editing usability checks. It does not
claim unrestricted sketch solving, arbitrary face/topology editing, general CAD
synthesis, whole-app accessibility conformance or a completed working-CAD spec.

## Code review

All reviews used Prism with Anthropic `claude-sonnet-5-5`; no provider/model
substitution was made. Full integrated review `720ffa5aba7814eb7d86342e8ab1b1c0`
covered 60 files / 19 chunks with no skipped input or truncation and zero high
findings. Scoped feature reviews and follow-up reviews cover later fixes.
Final integration-fix review `dd6864782a4d18e86dda430117ded704` covered
18 files / five chunks completely with zero high findings. Its remaining medium
asserted that binding-policy selection adds parameter data; source inspection
confirms that referenced data is identical across policies and only the explicitly
selected policy string changes. The source-bound consent guard remains intact.
Reports remain in `/tmp/plaincad-*-review*.json` on the implementation host; this
document retains the coverage and dispositions independently of those temporary
files.

Actionable findings were addressed: protected endpoint reuse, legacy driving
baseline conflicts, camera preflight, successful canvas opening before pocket
intent publication, exact Apply owner checks after cancellation, unavailable
provider configuration, source-bound sharing consent, provider refusal diagnostic
preservation, finite UI coordinates, missing action targets, compact scrolling,
repairable sketch rendering, cancellation focus and deferred resize positioning.

Some reported findings were checked against actual behavior rather than changed:

- New busy errors from direct modeling entry points are intentional. UI commands
  check current shared enablement synchronously before running; command buttons
  and task panels surface failures. Direct programmatic callers receive a useful
  diagnostic instead of bypassing task ownership.
- The face picker remains active after selecting a card because selection only
  highlights a candidate. **Draw here** creates the sketch, opens its canvas and
  clears the picker before drawing. Cap/side native acceptance checks this sequence.
- Pocket profile locking compares the constructed preview feature with the captured
  immutable draft. The dialog keeps settings locally; its guided profile, target
  and direction controls are locked. Native Apply also requires a measurable
  exact volume reduction and one valid solid.
- Provider content supplies its own named container, grid layout and Escape handler.
  The outer method selector additionally cancels the provider task on Escape.
- Transcript limits are even and `validateAiHistory` requires complete alternating
  turns. Context and actual total request bytes are checked before transport.
- RTL cleanup is automatically registered with Vitest globals enabled. New tests
  also reset transient ownership stores; production checks inspect public controls.

## Geometry and durability evidence

- Trim/Extend: authored line sketch on XY and XZ, mouse picks, Cancel, one Undo per
  Apply, native extrusion volume 3,600 mm³, coordinate orientation, save/open and
  signed STL volume.
- Relations: a skewed quadrilateral becomes horizontal with native volume
  2,784 → 3,072 mm³; stale selection cannot Apply; Undo/Redo restores geometry.
- Pockets: supported cap 12,000 → 11,800 mm³ and side 12,000 → 11,920 mm³,
  mouse drawing, locked inward cut, Cancel, Undo/Redo, save/open and signed STL.
- Provider conversation: all three interfaces use controlled provider replies with
  real OpenCascade geometry. Clarification and late cancellation change no CAD;
  explicit Apply produces 60 × 40 × 8 mm / 19,200 mm³, retaining IDs, followed by
  Undo/Redo, save/open and STL. An explicitly bound rectangle shared-width fixture
  proves 3,072 → 4,608 mm³ without replacing its width formula.

The first shared-width fixture constrained only one edge, so its expected rectangle
volume was incorrect: it correctly became a trapezoid. The corrected authored
fixture binds both right-side X coordinates to width and passes the rectangle
assertion. Expected geometry is calculated independently of the edited solver.

Controlled provider replies establish repeatable integration behavior. Separate
live smoke requests on 2026-10-06 sent only a synthetic 24 × 16 mm rectangle through
the isolated loopback gateway. Anthropic `claude-sonnet-5-5`, OpenAI `gpt-5-mini` and
Google `gemini-3-flash-preview` each returned HTTP 200 and a validated rectangle
action for 30 × 20 mm. No project file, user geometry or credentials were included
in the provider prompt. This checks the configured adapters at that time; it does
not establish ongoing availability or unrestricted natural-language understanding.
Unit/fallback results do not stand in for native browser BRep evidence.

## Automated usability scope

Production Chromium, Firefox and WebKit check compact and reduced layout space,
named controls, keyboard-assisted activation, Cancel/Escape focus, native previews,
validation/status semantics and dialog focus containment. WebKit uses macOS
Option-Tab for button traversal. See [audit details](EDITING_USABILITY_AUDIT.md).
The checks found and corrected compact overlap/collapse, lost repair paths, focus
loss and a WebKit ResizeObserver delivery error.

Human pilot sessions, live screen-reader speech, actual browser/OS zoom and
whole-app contrast/conformance remain pending, per the requested automated-only
scope. Screenshots were inspected before and after the compact layout fix.

## Final release checks

The integrated `npm run release:check` completed successfully on 2026-10-06:

- TypeScript checking passed.
- Vitest passed 864 tests in 109 files.
- The production build passed; the existing large CAD/kernel/viewer chunk warning
  remains a bundle-size concern, not a build failure.
- Development browser acceptance passed all 203 cases (22.1 minutes), including
  the new native editing workflows and retained worker-race/resource checks.
- Built-app production CSP acceptance passed all 27 cases (1.9 minutes).

The separate final production Chromium/Firefox/WebKit matrix passed all 12 cases
(45.1 seconds). Each of the five prepared intermediate commit snapshots also
passed TypeScript checking; their UI entry points are exposed only once their
feature integration is included. The full release gate validates the final
integrated source, rather than claiming five separate full-gate runs.

The five commits retain distinct Trim/Extend, contextual relations, face pockets,
provider conversation and usability scopes. The first contains shared task-owner
guards and supporting command modules needed by later steps. No generated build
output, provider credentials or project runtime handles are included.
