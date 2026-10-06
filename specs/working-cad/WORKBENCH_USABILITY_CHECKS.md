# Workbench usability and browser checks

This increment adds a reproducible production workflow on Chromium, Firefox and
WebKit, and focused keyboard/contrast checks. It also fixes a concrete compact
layout problem: the default left dock covered the empty-project naming/Draw card
at 685 px width. Compact screens now begin with a clear canvas. A single Project
or Details toggle opens the requested dock; one more closes it. The expanded
accessibility state reflects the dock actually displayed at that breakpoint,
and closing a dock returns focus to its toggle. Desktop dock preferences remain
persisted; this temporary compact choice stays out of project JSON and Undo.
Desktop dock toggles and tab actions do not select a compact dock implicitly;
resizing into compact layout retains its own previous choice (initially none).

## Automated scope

Run `npm run test:cross-browser`; it builds before starting the production preview. Install missing engines
with `npx playwright install chromium firefox webkit`. The strict production
preview uses port 5281. Tests write downloads/traces and measured theme contrast
attachments below ignored `test-results/cross-browser/`.

Each engine exercises a named, non-template part created through Draw, a sized
mouse rectangle, Finish Sketch, the explicit Make solid handoff, native thickness
preview, Apply, and project save/open/STL. The public inspector must report one
native solid with volume 3600 mm³, the reopened project is loaded after clearing
the previous model, and STL has positive signed volume matching that value. CSP
and uncaught-page-error checks run alongside this workflow.

On macOS WebKit, button traversal uses Option-Tab, matching
[Safari's default keyboard policy](https://support.apple.com/guide/safari/keyboard-and-other-shortcuts-cpsh003/mac).
Chromium and Firefox use Tab. This adapts the automated keyboard input to the
browser policy using native keyboard events; it does not rewrite tab order or
change the user's system settings.

The compact case checks 685 × 740 px initial naming/Draw hit targets, keyboard
focus and single-toggle Project/Details behavior. All three themes have measured
contrast checks for the start-card explanatory text and primary Draw button
against their actual computed backgrounds (at least 4.5:1), plus a visible
keyboard focus outline. Contrast calculations require opaque computed RGB colors
and reject unexpected transparent/color-space values rather than silently treating
them as opaque. A 683 × 450 px resized viewport checks reduced layout
space equivalent to a 1366 × 900 desktop at 200%; this is responsive reachability
evidence, not an actual browser/OS zoom session. This is a deliberately bounded accessibility check; it
does not certify every control, theme token, viewer edge, or disabled state.

## Human pilot — still requires participants

The existing [Workbench validation protocol](WORKBENCH_VALIDATION.md) remains the
human pilot plan. No human sessions or participant data are invented by automated
tests. Observe the new region-choice and compact value-edit steps in that same
beginner/maker/expert task set, and distinguish “noticed preview” from “understood
Apply.” Record the wrong-target edits, help requests and completion time before
prioritizing further UI changes.

Before calling the application broadly accessible, conduct live screen-reader
sessions (including announcement of current native preview and validation
diagnostics), actual browser zoom at 200% and higher, high-contrast OS preferences,
and keyboard-only modeling with alternatives to drawing. The new cross-engine
workflow is bounded desktop coverage, not a guarantee for mobile input or every
OpenCascade operation on each engine.
