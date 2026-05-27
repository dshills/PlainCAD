# MVP Completion Review

This document records the completion state of the initial implementation plan.

## Implemented Phases

- Phase 0: project skeleton and tooling.
- Phase 1: document model, IDs, validation, and state.
- Phase 2: parameters, units, expressions, and errors.
- Phase 3: command system and undo/redo foundation.
- Phase 4: worker rebuild protocol and kernel proof.
- Phase 5: viewer interaction, selection, and inspection.
- Phase 6: sketch model and helper-created geometry.
- Phase 7: profile detection.
- Phase 8: feature graph and extrude.
- Phase 9: mounting plate template and end-to-end MVP workflow.
- Phase 10: persistence and project import/export.
- Phase 11: STL export.
- Phase 12: command palette, inspector, errors, and usability pass.
- Phase 13: testing, performance, and release hardening.

## MVP Checklist

- App runs locally from a clean checkout with `npm install` and `npm run dev`.
- App creates new CAD documents and template documents.
- Users can add and edit parameters with unit expressions.
- Expressions reference parameters and report structured errors.
- CAD kernel initialization is isolated behind the kernel adapter and worker protocol.
- Rebuild output is transient and does not pollute project documents.
- Viewer renders rebuilt meshes and supports orbit, pan, zoom, fit, reset, and selection.
- Mounting plate template has a rectangular body and four parameter-driven holes.
- Editing mounting plate parameters rebuilds the model.
- Project save/load works through deterministic JSON.
- STL export works after successful rebuilds.
- Rebuild, import, and export errors are visible in the UI.
- Core parameter, sketch, profile, rebuild, persistence, command, inspector, and export logic is covered by tests.
- Unimplemented future features are omitted or explicitly unavailable.

## Verification Command

```sh
npm run release:check
```

Latest expected result: TypeScript check passes, Vitest passes, and production build passes with the known OpenCascade chunk-size warning.

## Known Limitations

- STEP export is omitted from the MVP UI.
- Join and cut extrude operations are marked unavailable.
- Sketch solving is intentionally simple and scoped to MVP helper workflows.
- Performance budgets are recorded in tests and compared manually during release hardening instead of enforced as brittle CI timing gates.
