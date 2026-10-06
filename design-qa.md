# Docked Workbench design QA

## Comparison target and evidence

Source visual truth: `/Users/dshills/.codex/generated_images/01a0fda8-ee73-7e03-a4e2-f18231801d82/exec-651c11f2-494a-467a-8134-d0936d5fc791.png`.
Implementation: `http://localhost:5278/`, in the Codex in-app browser.
Screenshot: `design-artifacts/workbench-final.jpg`.
Full comparison: `design-artifacts/comparison-final.jpg`, source and implementation
in the same image. Readable focused comparisons: `comparison-task.jpg` and
`comparison-ai.jpg`. Captures are local QA artifacts, ignored by Git; they cannot be verified from
the repository alone. The local paths are retained for this design handoff.

Both source and final implementation are 1586 × 992 pixels at a 1586 × 992 CSS
viewport, with no device frame/browser chrome. No density scaling was needed;
the comparison is 3172 × 1024 including its 32px label strip. The first capture
was 1588 × 992; the comparison normalized its two extra horizontal pixels before
judging. The final capture uses the exact reference dimensions.

State: Light theme, Mounting Plate project, active Bracket component, 60 × 40mm
profile with four circular holes, positive 8mm extrusion draft, bottom AI open.
The implementation is editing an existing feature, whereas the concept shows a
new feature. Copy correctly says Edit Extrude and native geometry is actually
validated. Existing template profile references require explicit reselection;
that action was performed explicitly in the draft. After visual checking, Apply
committed the validated example edit and a fresh edit task was opened. The one
remaining Issues item is the intentional underconstrained-sketch warning, not a
failed native solid.

## Findings and comparison history

- **[P1, fixed] Preview did not occupy the modeling canvas.** The first combined
  comparison (`comparison-first.jpg`, `workbench-first.jpg`) showed a shallow
  preview above a large unused region. The native preview/frame now fill their
  flex/grid track. `comparison-final.jpg` shows a legible model centered in a
  full-height canvas and controls in the right task region.
- **[P2, fixed] AI scope was below the initial fold.** The source exposes scope
  next to the prompt. The prompt now starts with an accessible scope select and
  actions; provider/details remain available by scrolling. The final AI focused
  comparison shows both prompt and scope above the fold.
- **[P2, fixed] Narrow-screen feature controls could shrink out of reach.** At
  480 × 820 with the bottom drawer open, the preview squeezed the control area.
  The inner feature area now uses positively scrolling grid rows (preview then
  controls) while heading/context and Apply/Cancel keep
  their own rows. `workbench-mobile.jpg` shows focused Thickness and persistent
  Apply. The native browser test scrolls to Thickness and asserts both it and
  Apply are inside the visible scroll area, before applying valid geometry.

A subsequent review moved base dialog/preview rules before responsive overrides;
phone checks assert zero left offset and a 220px preview. A manual focus check
then replaced reversed flex scrolling with explicit grid rows. The final phone
capture shows Thickness, Direction, Operation and Apply in the visible task area.

The pre-comparison native-dialog transform was also removed: its canvas/task
bounds now follow the actual mounted viewer region. Intrinsic header/footer
heights allow wrapping. Advanced options retain their open state and focus when
termination changes back to Distance.

## Fidelity surfaces

- **Fonts/typography:** bundled Inter 400/500/600, 13–14px body controls, 16px
  task headings, muted supporting text. Focused crops show legible labels and
  predictable wrapping. Saturn retains its numeric/console type treatment.
- **Spacing/layout rhythm:** 4/8/12/16/24px tokens, 36px controls, stable left,
  center, right and bottom regions, one tab per dock, explicit reopen controls.
  Smaller default side widths deliberately give the actual CAD canvas more room;
  users can resize them within bounded limits. Phone controls scroll without
  hiding Apply/Cancel. Native modal tasks make background controls inert.
- **Colors/tokens:** existing semantic Light palette with teal accent, amber
  light-theme draft, distinct grid/panel surfaces and text state. The native
  dialog backdrop dims the underlying shell slightly; that is an intentional
  signal that the draft must finish before another command. `workbench-saturn.jpg`
  verifies the same hierarchy with cyan console colors and native geometry.
- **Image quality/assets:** the central object is live OpenCascade BRep geometry
  rendered with Three.js, not a raster reconstruction of the mock. Sharpness and
  aspect are appropriate. UI icons use Phosphor outlines consistently, including
  the cube product mark. No generated illustration is needed in the product.
  Camera angle and draft opacity reflect the existing independent native preview.
- **Copy/content:** Project/Parameters, Draw/Solid/Inspect, Thickness/Direction/
  Operation, History/AI/Issues, explicit Apply/Cancel, source-linked diagnostics
  and provider disclosure are real controls. No unsupported modeling actions from
  an illustrative board were introduced. The UI contains no design-brief copy.

## Accepted product constraints and follow-up polish

This is the selected spatial/workflow direction implemented in the existing CAD
application, rather than a pixel clone. The concept's numbered task rail is
represented by the existing next-action guidance and compact feature form. The
ready message shows actual body count/volume. AI retains its conversation/proposal
and provider controls, so its default drawer is taller than the concept's single
input strip. One bottom surface is shown at a time.

The concept's solid width/depth labels, orientation cube inside the independent
preview, free-floating/redocked windows and arbitrary solid dimension handles are
future work. Existing editable sketch dimensions, extrusion distance arrow,
exact inputs and mouse workflows remain available. New modeling capabilities are
not inferred from decorative source details. See `DESIGN_SYSTEM.md` for scope.

Optional P3 polish: tighten tree rows further for large projects and refine the
native preview's camera framing after large viewport aspect changes.

## Interaction and error verification

In-app browser: edited parameters, searched/navigated Project, switched the bottom
AI scope, opened/cancelled native editing tasks, changed Light/Saturn themes,
focused narrow-screen Thickness, captured screenshots. Error-level console logs
were checked after these interactions: none.

Chromium workbench suite: mouse sketch/dimensions → native extrusion/distance
handle → invalid-preview Apply gating → phone controls → exact BRep
volume/orientation → save/open → STL; Advanced disclosure/focus/cancel; retained
parameter drafts, one Properties panel, search, keyboard resize, three themes and
compact mutually exclusive docks. Both tests passed.

Additional in-app native smoke tests exercised Fillet and Chamfer in the new task
dock. Both produced ready single-body previews with changed volumes
(18235.299 / 18154.667 mm³ versus the original 18295.221 mm³), and were cancelled.
`workbench-fillet.jpg` and `workbench-chamfer.jpg` record those views. The final
non-modal workbench is captured in `workbench-overview.jpg`; the preview tab is
left open, with its temporary viewport override reset.

Release validation completed: type checking, 705 unit tests, production build,
182 development browser cases, 21 isolated production cases and 13 final
compatibility/default-workbench cases passed. Two production fixtures were
corrected to explicitly select the retained Minimal layout. Prism reviewed those
corrections with the required Sonnet model and returned zero findings. Existing
large CAD chunk warnings remain. Provider flows use browser fixtures/status checks;
no live AI recipe generation was needed for this UI change.

Implementation checklist: retain the shared tokens/components for new controls;
keep actual command enablement and geometry diagnostics; run the full release
gate and exact Prism model review before committing.

No actionable P0/P1/P2 visual findings remain in the implemented scope.

final result: passed
