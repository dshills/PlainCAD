# Readiness-aware workbench guidance

The Task dock's **Your next step** now reads the settled current rebuild, active
component and selection. It does not solve geometry in React or treat a previous
successful mesh as the current model while a rebuild is pending.

- An empty part invites drawing or AI description.
- A selected empty or construction-only sketch invites drawing a solid boundary.
- An outline without a usable closed profile invites closing or repairing the
  drawing. Extrude remains governed by the shared command registry and its
  prerequisite is shown in the dock.
- A closed sketch invites Extrude. An underconstrained outline can still be
  extruded; the guide explains that dimensions and constraints can lock its shape.
- Solver errors and unavailable sketch planes invite explicit repair. Error
  actions use the same source-linked, current-document repair contexts as Issues.
- A failed model shows its current error and points to repair and Issues rather
  than implying the model is ready for fabrication.
- A current native solid invites supported face-hole placement and History edits.
  Fallback geometry is identified as fallback and does not receive native face
  modeling guidance.
- Selected supported features invite previewed feature editing. Disabled primary
  and advanced actions retain the shared enablement rules and show prerequisites.

The guide is advisory. It does not modify geometry, add constraints automatically,
choose replacement references or save runtime readiness to project files. Existing
manual commands remain available through their usual shared enablement rules.

`src/tests/modelingReadiness.test.tsx` verifies detected outline states, solver and
plane failures, pending/stale result protection, underconstrained readiness,
fallback/native reporting and visible disabled prerequisites. The focused browser
cases in `e2e/workbench-readiness.spec.ts` exercise current diagnostics through
explicit outline and dimension repairs; the outline case verifies real
OpenCascade extrusion volume, BRep validity and solid count.
