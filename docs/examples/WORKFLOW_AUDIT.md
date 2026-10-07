# Example-project workflow audit

The CAD geometry worked in all ten examples. The biggest usability risks are
keeping the model visible as docks open, maintaining clear part identity, and
making successful sketching look successful. Fix those before adding more tools.

This audit accompanies [ten editable example projects](README.md). All screenshots
were captured during this task in the Codex in-app browser against PlainCAD
commit `2733e69`. The natural compact page area was 685 × 954. A temporary
1440 × 1000 viewport checked whether findings persisted at desktop width; it was
reset afterward. Light theme and Docked Workbench were used. Screenshots are
unaltered captures of the actual application. Screenshots 07–15 were refreshed using the corrected
fixture after the geometry review. [The complete corrected fixture](audit/16-corrected-fixture.jpg)
was also reopened in the app. Gallery PNGs and validation measurements describe
the same distributed files.

## Scope and evidence

A manual walkthrough used visible controls to name a part, choose Top (XY), draw a
rectangle with the mouse, set its dimensions to 58 × 28 mm, finish the sketch,
preview a 5 mm extrusion, and Apply. The native preview reported 8,120 mm³, matching
58 × 28 × 5. A separate walkthrough opened the forty-part rotary fixture, searched
and activated its platter, isolated it, edited `platter_thickness` from 14 to 16 mm,
observed the completed value, undid the edit, restored all bodies through command
search, and examined STL export selection and its footer.

The ten gallery files were authored through immutable document helpers. Technical
browser automation separately opened **each** file and checked native BRep validity,
single-solid bodies, positive exact volumes, the documented parameter change,
undo, saved-file equality, reopening, and full separate-body mesh export. Automated
store actions were used for those geometry checks; they are not evidence that every
project can be authored easily through the UI. See [VALIDATION.json](VALIDATION.json).

These are heuristic findings, not measured user confusion. No participants,
screen-reader session, keyboard-only end-to-end session, OS zoom test, AI-provider
flow, or fabrication/fit study was performed. The in-app download-event listener
could not confirm the manual Save download; technical Chromium downloads and
save/open equality passed for all ten. That automation limitation is not classified
as a product defect. No runtime fixes are included in this change.

## Audited steps

| Step | Action and observed result | Health | Evidence |
|---|---|---|---|
| 1 | Start a project and name its first part. The entry choices are understandable; project and part names remain separate. | Mostly healthy | [Start](audit/01-compact-start.jpg) |
| 2 | Choose a plane. Top is recommended and orientation is explained; the compact panel requires scrolling to reach all controls. | Friction | [Plane chooser](audit/02-plane-selection.jpg) |
| 3 | Draw and size a rectangle. Mouse placement and exact driving sizes work; duplicate tools and dimension labels compete. | Needs improvement | [Tools](audit/03-empty-sketch-tools.jpg), [dimensions](audit/04-sized-sketch.jpg) |
| 4 | Finish sketch, preview extrusion, Apply. Guidance and native volume work; the single-region handoff adds a click, and the preview is clipped. | Needs improvement | [Handoff](audit/05-sketch-handoff.jpg), [preview](audit/06-extrusion-preview.jpg) |
| 5 | Open the forty-part project. Geometry loads correctly and is initially fitted; browsing components crowds the model. | Friction | [Opened project](audit/07-complex-project-open.jpg), [browser](audit/08-component-browser.jpg) |
| 6 | Search, activate, isolate, and restore parts. These actions work; body names are feature names, and restoring visibility requires another command. | Friction | [Isolated platter](audit/09-isolated-platter.jpg), [restored project](audit/15-desktop-project.jpg) |
| 7 | Edit a design parameter and undo. Rebuild succeeds; the parameter name is unreadable at the default dock width and briefly shows “Unavailable.” | Friction | [During rebuild](audit/10-parameter-edit.jpg), [completed](audit/11-parameter-rebuilt.jpg), [desktop](audit/12-desktop-parameters.jpg) |
| 8 | Inspect multi-body STL export. Selection and ZIP summary are clear; repeated names, nested scrolling, and advanced language slow the task. Technical downloads pass. | Needs improvement | [Export selection](audit/13-multi-body-export.jpg), [footer](audit/14-export-footer.jpg) |

Health summarizes usability of the observed step; it is not a geometry failure
classification or accessibility-compliance score.

## Prioritized findings

### P1 — Keep geometry visible when a dock opens

**Observed:** the extrusion preview clips the left side of the new foot when the
right task dock opens. Opening Project on the complex model also clips geometry;
isolating the platter leaves its left side obscured by the dock. The complete
project fits initially, and explicit Fit works at desktop width.

**Evidence:** [preview](audit/06-extrusion-preview.jpg),
[component browser](audit/08-component-browser.jpg),
[isolation](audit/09-isolated-platter.jpg),
[desktop after Fit](audit/15-desktop-project.jpg).

**Impact:** users cannot confidently inspect the operation they are about to Apply.
At compact width the contextual Fit button is absent, making recovery less obvious.

**Change:** preserve a fully visible fitted subject when docks change the available
canvas, and expose Fit beside the viewer at compact widths. Keep Apply/Cancel and
preview readiness visible together. Respect deliberate user camera poses rather
than resetting the camera on every rebuild.

**Acceptance:** at both audited widths, opening either dock while a model is fitted
keeps the complete subject visible; fitting remains one visible action during preview.

### P1 — Present valid sketch freedom as guidance, not failure

**Observed:** a 58 × 28 rectangle has valid dimensions and an exportable native
extrusion, yet the bottom tab shows **Issues (1)**. The handoff explains that two
position degrees of freedom remain. This is a nonblocking underconstraint warning,
not failed geometry.

**Evidence:** [sized rectangle](audit/04-sized-sketch.jpg),
[successful handoff](audit/05-sketch-handoff.jpg),
[native preview](audit/06-extrusion-preview.jpg).

**Impact:** precise, successful drawing can look broken to a beginner.

**Change:** distinguish blocking errors from “This shape can still move” advice.
Offer an explicit position/anchor action and allow the valid extrusion to continue.

**Acceptance:** this rectangle reads as ready to extrude, with optional anchoring
advice; genuinely invalid/open profiles still receive prominent blocking diagnostics.

### P1 — Use component identity consistently for bodies and export

**Observed:** activating **Slotted platter** exposes a body named **Underside edge
break**. The STL dialog labels the fixture base **Soft perimeter** and repeats
**Clamp blank**, **Fastener shank**, and **Washer** across distinct components. Visible
component suffixes help, but accessible checkbox names omit those suffixes and
repeat. Generated ZIP filenames use those feature-derived body names with numeric
suffixes, e.g. `Clamp_blank-2.stl`, rather than component identities.

**Evidence:** [platter browser](audit/09-isolated-platter.jpg),
[export dialog](audit/13-multi-body-export.jpg),
[actual ZIP filenames in validation](VALIDATION.json).

**Impact:** users must translate feature names into physical parts. Repeated
accessible labels present a navigation risk; a screen-reader impact has not been tested.

**Change:** default body presentation and STL naming to a clear component/part name,
retain feature names in History, and include both component and body identity in
accessible export labels. Provide explicit body rename where multiple bodies exist.

**Acceptance:** every exported part can be matched to its component without relying
on an arbitrary numeric suffix, and repeated checkbox labels remain distinguishable.

### P2 — Consolidate rectangle entry points and drawing dimensions

**Observed:** the contextual ribbon and mouse canvas expose **Rectangle** controls
at the same time. The ribbon's accessible action identifies Add Center Rectangle;
the mouse tool enters a placement gesture. A sized rectangle shows driving D1/D2
labels as well as repeated L58/L28 measurements for the same outline.

**Evidence:** [drawing controls](audit/03-empty-sketch-tools.jpg),
[dimension labels](audit/04-sized-sketch.jpg).

**Impact:** beginners cannot predict which similarly named control draws a shape,
and repeated labels obscure the edit target. Different creation behavior is inferred
from the action names/source; the alternate ribbon action was not exercised here.

**Change:** use one primary gesture-based Rectangle tool, with center/corner mode
inside it. Render one clear editable dimension per driven edge, with reference
measurements available on selection. Use sensible precision for simple millimeter values.

**Acceptance:** the two creation modes are distinguishable before clicking, and the
58 × 28 outline has two obvious editable size labels without redundant default labels.

### P2 — Simplify parameter editing and rebuild feedback

**Observed:** at the default 256 px dock width, `platter_thickness` displays only its
first characters inside a narrow editable name field. This persists at desktop
width. Its computed value briefly becomes **Unavailable** during a successful
rebuild, then becomes 16.0000 mm; toolbar actions temporarily disable.

**Evidence:** [editing](audit/10-parameter-edit.jpg),
[completed rebuild](audit/11-parameter-rebuilt.jpg),
[desktop dock](audit/12-desktop-parameters.jpg).

**Impact:** users may edit the wrong dimension or confuse rebuild progress with an
invalid formula. Compact mode hides the desktop rebuild badge.

**Change:** show a readable label above a full-width expression editor, put parameter
rename behind a deliberate action, and display “Updating…” with the previous valid
computed value while rebuilding. Link affected parts/features and preserve real
error messages for failed expressions.

**Acceptance:** the full parameter name and value are readable without widening the
dock, and pending rebuilds are visibly distinct from invalid parameters.

### P2 — Scale component navigation beyond a few parts

**Observed:** the initially expanded empty root consumes much of the compact Project
panel, and each component has separate Activate, Visible, and Isolate rows. Only a
few of forty components are visible before scrolling. Search successfully finds
**Slotted platter**, and activation/isolation works.

**Evidence:** [initial browser](audit/08-component-browser.jpg),
[filtered component](audit/09-isolated-platter.jpg).

**Impact:** repeated hardware hides major parts; users need search to navigate a
moderately sized mechanical layout. There is no prominent “Exit isolate” affordance
in the captured component panel; restoration succeeded through command search.

**Change:** use compact tree rows with inline visibility and contextual actions,
collapse an empty reference root by default, and add an obvious isolation breadcrumb
with **Show all**. Consider grouping repeated hardware without implying unsupported
nested assemblies or assembly instances.

**Acceptance:** users can scan the major parts, identify their active component, and
exit isolation without leaving the browser panel.

### P2 — Keep STL export actions in view and clarify check scope

**Observed:** the 1440 × 1000 export dialog initially shows only a couple of body
rows in a separately scrolling list; **Generate STL** and **Close export** require
scrolling the surrounding dialog. Advanced options are expanded. The checkbox
says **Check self-intersections and body overlaps**, including in Separate files
mode. Technical inspection confirms separate-file validation checks each mesh but
does not run cross-body overlap checks.

**Evidence:** [dialog top](audit/13-multi-body-export.jpg),
[scrolled footer](audit/14-export-footer.jpg),
[export scope in validation](VALIDATION.json).

**Impact:** users must manage two scroll areas to select parts and reach completion.
The checkbox can suggest that assembled fit was checked when it was not.

**Change:** keep a compact selected-part summary and sticky Generate/Cancel footer,
collapse genuinely advanced options by default, label the primary choice “One file
per part,” and describe exactly which checks apply to that mode. Give merged-export
risks only when that option is chosen.

**Acceptance:** the completion actions remain visible at both widths; validation
labels match per-body versus cross-body behavior, without implying fit certification.

### P3 — Shorten handoffs and explain identity and direction

**Observed:** Finish Sketch leads to a **Make it solid** action even when the only
region is already selected. Top/Front/Side guidance is helpful, but normal direction,
inner loops, and New Body introduce CAD vocabulary during the first extrusion.
Naming the first part does not rename the still-**Untitled** project. Plane selection
requires a long compact panel; the preview uses minor pluralization such as “1 bodies.”

**Evidence:** [entry](audit/01-compact-start.jpg),
[plane chooser](audit/02-plane-selection.jpg),
[handoff](audit/05-sketch-handoff.jpg),
[extrusion controls](audit/06-extrusion-preview.jpg).

**Change:** optionally go straight to a thickness preview for one unambiguous region,
keep multi-region choice explicit, show an on-model direction arrow, explain “new
part” versus “add to this part,” and prompt for a project name at first save. Keep
Cancel in view in the plane chooser and correct singular/plural labels.

**Acceptance:** a beginner can name, draw, size, preview, and save a first part without
learning normal vectors or the difference between a feature and a body first.

## Preserve what worked

- The first-part entry offers drawing and description paths and a recommended plane.
- Mouse drawing accepts precise driving sizes; the preview reports a meaningful
  native volume and gates Apply on readiness.
- Project search, component activation, isolation, and Undo were successful.
- The STL dialog explains that STL loses editable design intent, names the global
  millimeter frame, distinguishes visibility from export selection, and summarizes
  selected bodies and input triangles.
- All ten final projects rebuilt successfully, including real fillets/chamfers,
  cuts, joins, annuli, holes, and revolved spindle/shaft profiles. No fallback mesh
  or metadata-only modeling was accepted as proof.

## Recommended next implementation order

1. Dock-aware fitting and a compact-view Fit action.
2. Separate nonblocking sketch guidance from errors; reduce duplicate dimensions/tools.
3. Clear body/component identity and readable parameter editing.
4. Dense project navigation with a visible isolation exit.
5. A simpler export dialog with persistent actions and accurate validation scope.

Rerun these eight audited steps against the same projects after each UI change,
with native geometry checks preserved. Human usability sessions remain a useful
follow-up, but no human-results claim is made by this audit.
