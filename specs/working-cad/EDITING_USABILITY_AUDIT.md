# Automated editing usability checks

This increment uses automated checks only. It does not claim a beginner/maker/expert human pilot, live screen-reader speech testing, actual browser zoom or an operating-system accessibility session.

## Regression coverage

`cross-browser-e2e/editing-usability.spec.ts` runs against the production build in Chromium, Firefox and WebKit. It uses imported authored fixtures and named public UI actions, with CSS containers for rebuild readiness and layout checks; there are no development-only browser source imports or internal store mutations.

| Check | Evidence asserted |
| --- | --- |
| Compact sketch at 685 × 740 | Finish, Select, item selection, relation preview/Apply and Trim controls can be scrolled into view and hit at their centers without an overlapping surface |
| Reduced layout at 683 × 450 | Same drawing controls remain reachable; document width does not overflow horizontally |
| Contextual relation | Keyboard-assisted named-control activation reaches a successful native preview; Escape removes the staged Apply action and returns focus to the originating Preview button |
| Trim validation | Missing pick coordinates produce an alert and an unchanged-project status; Apply stays disabled; Escape returns focus to Trim |
| Face selection | Draw here starts disabled, a supported keyboard-selected card exposes pressed state, selected target and inward direction, then enables Draw here; Cancel exits without creating a sketch |
| Solid dimension | Negative depth produces an alert and disabled Apply; a valid edit produces native preview status; Apply/Cancel remain reachable at both viewport sizes |
| Native dialog focus | Tab traversal stays inside the dimension dialog; Escape returns focus to the driving-dimension button |
| Runtime | New workflows report no page exceptions |

Keyboard-assisted means tests activate named controls with Enter/Escape and inspect focus behavior. They also use public selection controls and fill fields. This is not a claim that every step was discovered or performed through uninterrupted Tab navigation by a person. On macOS WebKit the dialog test uses Option-Tab, matching Safari's default policy for traversing buttons; Chromium/Firefox and other platforms use Tab.

The 683 × 450 viewport provides approximately the layout space of a 1366 × 900 viewport reduced at 200%. It is a responsive reflow simulation. Browser scaling, text rasterization, device pixel ratio, OS zoom, magnification and screen-reader speech were not tested by this resize.

Existing `cross-browser-e2e/workbench.spec.ts` separately covers the non-template native modeling/save/open/STL workflow, compact dock navigation and selected opaque text/action contrast samples in Light, Dark and Saturn Command. Those checks are retained; sampled contrast is not an audit of every color or state.

## Findings corrected

- At short compact heights, fixed sketch header/tool/selection rows consumed the whole drawing area. Scrolling the entire compact sketch workspace now keeps the drawing and precision controls reachable.
- Canceling contextual and Trim/Extend tasks removed the focused control. Explicit keyboard cancellation now restores focus to its trigger; successful Apply returns focus to Select. Automatic source invalidation leaves the user's current navigation focus alone.
- Reading a failed or stale sketch context inside the relation panel previously threw during rendering. The panel now preserves repairable intent, displays source diagnostics and disables new relations when repair is required.
- Resizing an open dimension dialog caused a WebKit ResizeObserver delivery warning. Position writes are now coalesced into a later animation frame rather than performed during observer delivery.
- Draw on face is exposed in the Draw toolbar, with supported faces represented by named keyboard-activatable cards.

Focused component regressions also check Cancel/Apply focus and retain existing invalid-dimension, lost-reference and stale-canvas repair behavior. Geometry and durability assertions remain in the modeling acceptance suites; reachability and status semantics alone do not prove fabrication correctness.

## Recorded validation

The six new production browser cases passed in Chromium, Firefox and WebKit (26.4 seconds) after the compact scroll, focus-return, render-repair and observer-delivery fixes. The targeted repair regression group passed 43 tests; the dimension/contextual/Trim panel group passed 14 tests. Production build passed with the existing large CAD kernel/viewer chunk warning.

The final production cross-browser matrix passed all 12 cases (45.1 seconds),
including the six new editing checks and the six retained modeling/dock/theme
checks. This result uses the final built application; the reflow simulation and
keyboard-assisted scope described above still apply.

Prism reviews used Anthropic `claude-sonnet-5-5`. Retrying reachability and width checks wait for reflow; dialog traversal records movement among controls so containment cannot pass through stationary focus. Vitest enables global hooks in `vite.config.ts`, allowing React Testing Library to register automatic cleanup; `src/tests/setup.ts` supplies DOM matchers and the jsdom dialog shim.

## Remaining scope

Automated roles, names, status/alert behavior and focus checks are useful regression evidence. They do not establish overall accessibility conformance, ease of learning, live assistive-technology announcement quality or usability for people with different CAD experience. Those require separate explicit validation; no human sessions are included in this increment.
