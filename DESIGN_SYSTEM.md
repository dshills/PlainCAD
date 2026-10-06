# PlainCAD Workbench design system

The default workbench combines Docked Workbench's stable locations, Guided
Studio's explicit next action, and Canvas Workshop's direct manipulation. A
person should always know what they are editing, what to do next, and whether a
change has actually been applied.

## Spatial contract

| Location        | Responsibility                                            | Interaction                                                                                                                                                             |
| --------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project bar     | Local file, Undo/Redo, command search, Save, Settings     | File menu owns file and example commands. Search exposes the complete supported command registry.                                                                       |
| Context toolbar | Draw, Solid, Inspect                                      | One tool group at a time. Disabled actions retain their names.                                                                                                          |
| Location bar    | Project → active component → selected sketch              | Active component stays visible. Project/Details buttons reopen closed docks.                                                                                            |
| Left dock       | Project and Parameters                                    | One tab at a time. Search matches component, sketch and current body names. Component/project settings and sketch internals are disclosed deliberately.                 |
| Center          | Actual 3D model, sketch drawing or native feature preview | Mouse drawing, editable sketch dimensions, distance dragging/arrow keys, orbit/pan/zoom.                                                                                |
| Right dock      | Task or Properties                                        | Task states the next action. Properties shows one selected inspector, measurement, view, dependency or help panel. Sketch mode replaces this dock with sketch controls. |
| Bottom dock     | History, AI or Issues                                     | One surface at a time; closed by default. AI requests start with a plain text description and explicit scope.                                                           |

Docks have fixed homes rather than arbitrary floating windows. Their desktop
sizes can be dragged or changed with arrow keys on the focusable separators;
Shift changes size by 32px instead of 8px. Escape/pointer cancellation restores
an unfinished resize. Widths and height are bounded to keep the canvas useful.
On narrower viewports, side docks become mutually exclusive overlays, with
Project/Details controls always available. At phone widths sketch controls and
feature controls stack and scroll.

## Task and preview contract

A feature draft replaces the center with an independent native geometry preview
and the right side with its controls. The project viewer remains mounted, keeping
its camera and resources independent. Apply commits one history edit only after
current native geometry passes existing validation. Cancel/Escape preserves the
project. Background commands and AI remain inert under native modal semantics
until the task finishes. Loading, unavailable profile, failure and ready states
are distinct; a color alone never communicates successful modeling.

Extrude starts with shape, thickness, direction and operation. Through All and
To Face are in Advanced options. Formula-driven distances retain their bindings;
the existing diagnostic explains why literal distance dragging is unavailable.
Lost references require explicit reselection. No unsupported Sweep/Loft or
arbitrary topology operations are added by this design.

Sketch creation still chooses a supported plane. Draw with the mouse, enter exact
draft sizes, edit dimensions on the sketch, select/delete whole shapes and Undo.
Precision controls are disclosed initially. Finish Sketch returns to the project
viewer. Existing bounded snapping and geometry limitations still apply.

AI remains optional. Scope, provider configuration, disclosure about sending the
prompt to a provider, preview validation and explicit Apply remain available.
Opening another bottom surface closes AI and cancels its outstanding work through
the existing lifecycle. Conversation and drafts are transient, not project data.

## Tokens and components

The source of visual tokens is `src/ui/design-system/workbench.css`, layered over
existing semantic theme colors. `CommandButton` uses the shared command registry;
`RetainedPanel` preserves form drafts after a tab has been visited; `DockResize`
provides pointer/keyboard size controls. Workbench shell components own layout,
not CAD math, history or feature creation.

| Token    | Value / usage                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Spacing  | 4, 8, 12, 16, 24px; use 16px dock padding and 8px control gaps                                           |
| Type     | Bundled Inter, 13–14px body, 16px task title, 12px support copy, 10px eyebrow                            |
| Numbers  | System monospace stack for numerical readouts                                                            |
| Control  | 36px baseline height, 4px corner radius, visible focus outline                                           |
| Dock tab | 40px high, accent background/underline for active state                                                  |
| Icons    | Phosphor regular outlines, 18px controls, 14–16px compact tree/close controls                            |
| Primary  | Semantic accent fill; reserve for the next action and final Apply                                        |
| Surface  | Toolbar, panel, surface and viewer backgrounds have separate semantic tokens                             |
| Feedback | Muted loading/instructions; success only for validated preview; warnings/errors use existing diagnostics |

Light, Dark and Saturn Command keep identical locations, workflows and control
names. Saturn changes palette/type treatment; it does not introduce a different
layout or workflow. Fonts are local assets and do not require an external font
service. Visible CAD geometry comes from the real viewer, never raster mockups.

## Persistence and compatibility

`plaincad.workspace.v1` remembers the selected workbench/minimal/full layout;
existing version-1 minimal/full choices are honored. First use and invalid data
fall back to Docked Workbench. `plaincad.workbench.v1` stores bounded dock sizes,
left disclosure and selected left tab. Right/bottom task selection is transient.
None of these preferences enter `.pcaddoc` files, document history or rebuilds.
Unavailable browser storage leaves the workspace usable for the current session.

Minimal and Full workspace remain available in Settings for existing workflows;
they retain their prior pin/full-panel behavior. The new default presents one
panel per dock. Arbitrary drag-to-redock, free-floating windows, simultaneous
history/AI, and editable solid dimensions beyond the existing extrusion distance
handle are future work, not implemented claims.

## Acceptance

Use `e2e/workbench.spec.ts` for default-layout coverage: a mouse-drawn rectangle
with a circular hole, driving dimensions, docked extrusion preview/distance handle,
invalid-preview Apply gating, exact native volume/orientation, save/open and STL.
STL volume uses a 0.01% relative tolerance because curved surfaces are tessellated;
native BRep volume is asserted separately to five decimal places. Additional
coverage checks one properties panel, retained uncommitted drafts, search,
keyboard resizing, local preference isolation, three themes and compact overlays.

Keep `design-qa.md` as the visual comparison record. Run exact Prism Anthropic
`claude-sonnet-5-5` review and `npm run release:check` before a handoff or commit.
