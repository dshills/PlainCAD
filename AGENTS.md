# PlainCAD agent guide

## Project and scope

PlainCAD is a browser-first, local-first parametric CAD application for mechanical
parts. It uses React 19, TypeScript, Vite, Zustand, Three.js, and OpenCascade.js.
CAD remains local with no modeling backend. An optional loopback-only Vite AI
gateway in `server/` keeps provider credentials out of the browser. Prioritize predictable rebuilds, durable
project files, and useful diagnostics when extending CAD capabilities.

Read `README.md` for setup and workflows. `specs/initial/` contains the original
MVP specification and completion notes; `specs/working-cad/SPEC.md` and `PLAN.md`
describe the next-stage roadmap. The working-CAD capability matrix records reviewed implementation limits.
Verify current behavior in source and tests; a roadmap item or schema type alone does not prove
that a capability works end to end.

## Setup and checks

- Use Node.js `^20.19.0` or `>=22.12.0` and npm.
- Use `npm ci` for a clean installation from `package-lock.json`.
- `npm run dev` starts Vite on port 5278 with `strictPort` enabled. To override it, use
  `npm run dev -- --host 127.0.0.1 --port 5279`.
- `npm run lint` runs TypeScript checking; it is not an ESLint/style check.
- `npm test` runs Vitest once; `npm run test:watch` starts watch mode.
- Run focused tests with `npm test -- src/tests/document.test.ts` (substitute
  the relevant file).
- `npm run build` checks TypeScript and creates `dist/`.
- Run `npm run check:item` and Prism for every completed item before handoff or
  commit. The reduced gate runs type checking, all unit/component tests, the
  production build and bundle-size budget, development native modeling/stale-result
  smoke tests, and focused built-app modeling/AI/CSP browser tests. Add focused
  tests for affected behavior that the smoke set does not cover.
- Run `npm run release:check` after every fifth completed item, before handing off
  or committing that fifth item. It runs the complete development and production
  browser suites as well as type checking, unit/component tests, and build.
  The full gate includes the reduced checks, so it satisfies both test gates for
  that item; Prism review is still required.
  Track completed items and the last successful full gate in
  `specs/working-cad/VALIDATION_LOG.md`; an item is a completed requested change,
  not each fixup commit. Update the log with each item; reset the count only after a
  successful full gate. If the count is missing or uncertain, run the full gate
  to establish a new baseline. A failed gate must be fixed before proceeding.
- Install Chromium once with `npx playwright install chromium`. `npm run test:browser`
  runs real-kernel acceptance tests using a dedicated server on port 5279.
  Screenshots/downloads/traces are in ignored `test-results/`. Run `npm run build`
  before standalone `npm run test:production`; its strict preview server uses port
  5280 and verifies native workers under the production security headers.
  The development suite also writes a controlled native benchmark `performance.json`
  with timing/resource samples; see `specs/working-cad/PERFORMANCE.md` for its scope.

The production build enforces a 500 kB uncompressed JavaScript bundle budget,
including workers. Report relevant warnings and fix bundle-budget failures.
Do not commit generated `dist/`, `node_modules/`, `*.tsbuildinfo`, or emitted Vite
configuration files. Keep `package-lock.json` consistent with dependency changes.

## Code map

- `src/app/App.tsx`: application shell, layout, and keyboard workflows.
- `src/cad/document/`: serializable schema, IDs, document operations, validation,
  migrations, and timeline ordering.
- `src/cad/parameters/`: units and parameter expression evaluation.
- `src/cad/sketch/`: sketch entities, planes, solving, and profile detection.
- `src/cad/features/`: dependency planning, rebuild orchestration, stable body
  identities, and supported topology references.
- `src/cad/kernel/`: kernel adapter, OpenCascade integration, mesh conversion,
  tessellation cache, disposal helpers, and STL generation.
- `src/cad/worker/`: geometry worker, request/response protocol, and lifecycle rules.
- `src/state/`: Zustand document history, selection, rebuild state, and selectors.
- `src/persistence/`: import safety, project load/save, and deterministic exports.
- `src/commands/`: canonical runtime registry, JSON protocol, UI/native adapters
  and browser API; `scripts/plaincad-cli.mjs`: Chromium CLI using that same API.
  `scripts/command-instrumentation.ts`: Vite source coverage and source-map adapter.
- `src/ui/commands/`: CAD command metadata and shared enablement; `src/ui/panels/`:
  parameter, sketch, feature, inspector, and diagnostic controls.
- `src/viewer/CadViewer.tsx`: Three.js rendering and viewer resource lifecycle.
- `src/ai/`: bounded AI recipes, validation, and immutable CAD generation;
  `server/`: local Anthropic/OpenAI/Google adapters and same-origin AI middleware.
  Never expose API keys through VITE_ variables, client code, responses or project JSON.
- `src/templates/`: built-in models and mounting-plate checks.
- `e2e/` and `playwright.config.ts`: Chromium modeling and worker-race acceptance tests.
- `src/tests/`: Vitest and React Testing Library tests; setup is configured in
  `vite.config.ts` with jsdom and `src/tests/setup.ts`.

## Architectural rules

1. `CadDocument` is the durable source of truth. Keep kernel handles, Three.js
   objects, meshes, current camera state, workers, and rebuild results out of project
   JSON. Explicit saved named camera poses are durable document data.
2. Make document edits immutable through existing document helpers and store
   actions. Preserve undo/redo and rebuild scheduling rather than mutating store
   snapshots or bypassing history from UI code.
3. Preserve stable document, entity, feature, and body IDs. Use explicit
   `timelineStep` ordering and existing legacy fallbacks; do not replace editable
   timeline order with timestamps or array order alone.
4. Evolve persisted data through `schema.ts`, `migrations.ts`, and `validate.ts`
   together. Add a version migration when the file format requires one, preserve
   supported older projects, and verify import/export round trips.
5. Treat imported JSON as untrusted. Preserve unsafe-key rejection, depth and
   entity limits, migration, and final validation before replacing project state.
   Do not merge arbitrary imported objects into the store.
6. Keep OpenCascade integration behind the kernel adapter and geometry worker.
   Worker messages must remain structured-clone compatible. Preserve request ID
   and epoch checks, timeout handling, and rejection of stale rebuild results.
7. Dispose OpenCascade objects and Three.js resources at their ownership boundary,
   including failure paths. Do not serialize runtime handles or retain them in
   caches after their owning shapes have been disposed.
8. Route every UI, script and agent action through `src/commands/registry.ts`.
   Prefer explicit domain bindings for reusable business actions. JSX controls
   and native input listeners use the build-time command adapters; preserve their
   coverage tests and registration/unmount lifecycle. Never accept runtime proof
   objects or callbacks as JSON command arguments. Generated UI IDs are discovered
   from current bindings; durable project IDs remain separate. See `docs/COMMANDS.md`.
   Keep CAD enablement in `ui/commands/commandRegistry.ts`. Keep ribbon,
   palette, and timeline availability consistent. Export must use a successful
   rebuild matching the current document and containing exportable meshes.
9. Return actionable, source-linked diagnostics for invalid parameters, sketches,
   features, and kernel operations. Preserve user-visible import/export errors.
10. Distinguish real kernel geometry from fallback meshes and metadata-only
    operations. Native modeling must validate BRep validity, solid count, and exact
    volume; no-op booleans and unchanged edge treatments fail explicitly. Revolve
    retains a narrow full-Y/XY rectangular fallback without the kernel. Keep
    face/edge references limited to supported feature-owned roles and diagnose lost or modified geometry.
    Keep unsupported operations explicitly unavailable or
    diagnostic rather than silently reporting success.

## Implementation and validation

Always use Prism with the Anthropic `claude-sonnet-5-5` model for code reviews. Run that
review before handing off code changes or committing them, address actionable
findings, and report the review result. Do not substitute another provider or
model without the user's authorization. If Prism or the requested model is
unavailable, report the limitation explicitly; do not claim that review passed.

Follow the surrounding TypeScript/React style: strict types, ES modules, named
helpers, double-quoted strings, and semicolons. Keep CAD calculations in the CAD
modules rather than React components. Avoid unrelated refactors and dependencies.

For behavior changes, extend the relevant existing tests with observable results:
document compatibility, expression/unit errors, profile geometry, feature
dependencies, worker lifecycle, command availability, or save/load/export behavior.
Prefer geometry assertions over assertions that only confirm a feature object
exists. Documentation-only changes generally need a diff review.

jsdom tests and fallback rebuilds do not establish that WebAssembly, WebGL, or
OpenCascade geometry works in a browser. For changes to the worker/kernel/viewer
or modeling UI, run the reduced native browser suite for each item and focused
acceptance tests for additional affected behavior; run the complete browser
suite on the five-item cadence above. Smoke-test affected workflows when possible:
create or load a model, edit a parameter, rebuild, inspect the geometry, save/open,
and export STL. Report any browser validation that was not performed.

When reporting work, state the behavior changed, checks run and their results,
and material limitations. Update the README or capability matrix when changing
documented feature availability; keep planned work distinct from working behavior.
