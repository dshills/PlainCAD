# Release Hardening Checklist

Phase 13 uses this checklist alongside automated tests so MVP release checks are repeatable.

## Automated Checks

- `npm run release:check`
- Unit and integration coverage includes parameters, sketch helpers, profile detection, feature rebuild, project import/export, STL export, command gating, inspector routing, and MVP workflow performance metric capture.
- Performance budgets are recorded during release hardening and compared manually so shared CI CPU variability does not create flaky release gates.

## Browser Smoke Checks

- App loads without a framework error overlay.
- Command palette opens with `Cmd/Ctrl+K`, focuses the filter input, filters commands, and closes without console errors.
- Mounting plate template loads, shows rebuild success, and exposes editable parameters.
- Editing `plate_width` or `plate_height` updates the document and queues/rebuilds geometry.
- Project save, JSON export, and STL export controls are disabled or enabled according to document/rebuild state.

## Accessibility Checks

- Toolbar buttons have accessible names and visible focus.
- Inspector inputs have labels tied to the selected parameter, sketch, or feature.
- Rebuild and file errors are visible without exposing raw stack traces.
- Keyboard escape clears selection or closes the command palette.

## Performance Targets

- Parameter evaluation: under 20ms for a 40-parameter dependency chain.
- Sketch solve: under 50ms for a plate sketch with a rectangular profile and four circular holes.
- Simple mounting plate rebuild: under 500ms after runtime initialization.
