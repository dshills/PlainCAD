# Curve, copy, offset, edge and AI feature batch

Implemented on 2026-10-06 after the user requested parallel work with the established
Prism review → release checks → separate commit workflow. Independent CAD planners
and panels ran in parallel; shared command ownership, UI integration, browser
servers, release validation and commits were coordinated serially.

## Scope

1. Finite analytic line/arc/circle Trim and line/arc Extend.
2. Mirror and bounded linear sketch copies with supported internal intent.
3. Convex straight-outline and analytic-circle Offset.
4. Individual complete authored cap-edge Fillet/Chamfer picking.
5. Bounded AI additions to one explicit existing native face/body.

Each exposes Preview/Apply/Cancel with immutable history, source/session/selection
checks, diagnostic refusals and private native proof where geometry is claimed.
No persisted format, dependencies or provider secrets were added. Creation-time
copies are not associative pattern/offset features. Unsupported general topology,
concave/arc offsets and arbitrary AI CAD remain unavailable.

## Prism coverage and dispositions

Every changed source/test file was reviewed with Prism Anthropic
`claude-sonnet-5-5`, with complete scoped coverage and no fallback provider/model.
Initial findings were addressed or checked against actual code and geometry;
follow-up reports cover source repairs. Final scoped follow-ups have no high or
medium findings. The review report details below record evidence, rather than
claiming every model-generated suggestion was a real defect.

- Curve all 8-file review `edafdae12c5d81e5bb7a48abb3893167` followed by finite-overlap
  repair review `474248ad8610dbaa3488d0d1b7358e04` (5 files, zero findings). Disjoint
  collinear lines and sibling arcs no longer falsely block valid finite edits;
  positive overlaps still diagnose. Tolerance, dedupe, sweep and cleanup safeguards
  were hardened. Earlier curve/test reports supplemented that coverage.
- Mirror/pattern initial `311448f28c3091a00b6679fcdc0588ef` and full follow-up
  `927f7db1264bb0b0a788e81688a8270c` reports cover all 8 files. Axis-specific
  diagnostics, owner invalidation, exact private preview proofs and geometry/STL
  precision were fixed. Unsigned mirrored dimension behavior matches the solver
  and has a regression. The final test report covers corrected accessible selectors
  and actual/expected volume messages. Native tolerance remains relative 1e-7;
  STL permits 0.1% faceting, below the change caused by a missing hole.
- Offset full review `d5991ed1b96abb25eab4ce0308051ac3` (8 files) and proof follow-up
  `00ea9047a77e2014ab0abe4f0a99e2f9` (3 files) have no high/medium findings. Authored
  units for scalar parameters, exponent formatting, diagnostic availability and
  malformed empty/point-only/missing-entity proofs were fixed. Analytic radius and
  exact BRep volume assertions remain distinct from sampled tessellation bounds.
- Edge review `a09eb9068815de5f7726d8c97c6a34f9`, follow-up
  `b69e05ff6ab697666cf54a6f4489c0f0` and final assertion review
  `94848e9b893f321f4bfa266e5877f3eb` cover all changed edge files with no high/medium
  findings. Shared profile lookup guards, target caching, labels, picker lookup,
  resource assertions and whole-cap budget reservation were fixed. STL tolerance
  is relative 1e-5: 0.0134 mm³ at 1340 mm³, below a missing 2 mm³ chamfer.
- Root full source reviews `27b810c32856dd229b2a89b1ba47c70a` (24 files) and
  `1d715220f8557b8b144e8777f851c1d7` (19 files) cover AI, gateway and shared integration.
  Repairs include rectangle/opening fit, provider-string parsing, bounded errors,
  explicit file-busy guards, inactive computation, mode/conversation preservation,
  provider preference and failed-Apply proof cleanup. Follow-up
  `ad17b9c2105e353e1ec03a5b19720f0f` (5 files) has no high/medium findings.
  Cross-action combined validation already exists: every native stage and the
  full project rebuild are mandatory. A duplicate-cut regression proves refusal.
  Additive extrudes are unavailable; the supported extrude action is an inward
  pocket cut. An explicit private-preview guard now rejects additive misuse.
- Browser/usability review `93a6f239ab9e96f01e60066566db2195` (2 files) has no
  high/medium findings. Native analytic volume tolerance is relative 1e-7, distinct
  from STL faceting. Final selection-refresh/compact-consent review
  `7324e80e12a93a5a7d1fe525641e249c` (3 files) has no high/medium findings; the sole
  low is comment placement. Stable accessible-role selector follow-up
  `aee6d9a17e8b07dc5e47d8eca87f23d2` has zero findings.

Remaining lows are bounded style preferences or deliberate invariants: ordered
selection is exact intent; failed Apply discards proof to require fresh validation;
history only accepts complete alternating turns; zero-action clarifications stay
outside the planner; explicit hidden CSS is present. Closure-narrowing claims did
not reproduce in actual TypeScript checks; final route holders also make intent
clear. Shared enablement now subscribes canvas selection, with a regression proving
availability changes without a document edit. Documentation received a local diff
review.

## Geometry and provider evidence

The new 15 development browser cases use actual native workers: 2 curve, 2 copy,
4 offset, 3 individual-edge and 4 AI addition workflows. Geometry assertions cover native
source, valid BRep, solid count and volume, coordinate orientation, unchanged Cancel,
Undo/Redo, relevant parameter edits, save/open and signed STL. AI flows exercise
Anthropic/OpenAI/Google interfaces with controlled replies, source-bound consent,
clarification, canceled late replies, kept conversations and one explicit Apply.
An additional native-WASM positive fillet/chamfer test verifies AI source references.

Separate live smoke requests sent only synthetic 40 × 30 mm plate face context, asking
for one 3 mm through-all hole at local (10 mm, 10 mm). Anthropic `claude-sonnet-5-5`,
OpenAI `gpt-5-mini` and Google `gemini-3-flash-preview` each returned HTTP 200 and
that validated hole action. Existing env keys remained on the loopback gateway.
These live responses establish configured transport availability at that time,
not general natural-language modeling or continued future availability.

## Release evidence

The final production Chromium/Firefox/WebKit matrix passed all 15 cases
(54.5 seconds). Checks include reachable compact sketch copy/offset controls,
Escape focus return, AI mode descriptions and active consent reset at 685×740 and
683×450. They do not claim whole-app accessibility, human usability, live
screen-reader speech or actual browser/OS zoom. Human sessions remain deferred
per the requested automated-only scope.

All five prepared intermediate snapshots passed TypeScript and each feature's
focused regression group. A temporary test harness allowed reading their shared
symlinked dependencies after Vite initially refused the external WASM path; the
repository server/security configuration was not changed.

The frozen final source passed `npm run release:check`: TypeScript, 935 tests in
116 files, production build, all 218 development browser cases (23.3 minutes),
and all 27 built-app production CSP cases (2.0 minutes). The build retains the
existing warning about large CAD/kernel/viewer chunks. The earlier interrupted
gate was superseded by this complete run after shared selection enablement was
fixed; its failure is not counted as a passing run.

The five commit snapshots separately passed TypeScript and focused groups of
31, 17, 17, 17 and 34 tests. Native workflows were verified in focused runs and
the final integrated gate; the complete release gate was run once on the final
combined source, rather than repeated five times. Separate commits retain the
feature boundaries while shared integration is introduced at its first needed
step. Final documentation and stable browser-selector corrections do not change
the production source validated by the gate.
