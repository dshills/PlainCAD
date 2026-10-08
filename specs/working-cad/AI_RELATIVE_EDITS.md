# Local relative AI dimension edits

The canvas assistant can resolve a narrow relative request into an editable numeric
proposal without contacting a provider. Supported forms are `halve thickness`,
`double width`, `make it half as thick`, `make this twice as thick`, and
`increase/decrease <dimension> by <number> mm/deg/%`. A single polite prefix and
terminal punctuation are supported. Percent amounts change the current value:
increasing 5 mm by 50% proposes 7.5 mm, rather than an absolute 50 mm assignment.
`Halve it/this/that` and `double it/this/that` use an explicitly chosen editable
dimension; without that choice, the assistant asks which dimension should change.
The same explicit choice applies to `increase/decrease it/this/that by <number>
mm/deg/%`, with unit and value validation identical to named dimensions.

Requests use the current resolved CAD values, normalized to millimeters or degrees.
Friendly AI parameter names resolve inside the current component or selected
feature only. A selected extrusion maps thickness to its distance. Missing,
ambiguous, locked or unavailable dimensions require clarification; a conflicting
explicit dimension name is not redirected to another selected dimension. An
absolute millimeter delta cannot change an angle, and thickness needs a length.

Local relative results must be positive, finite, changed, and at most 100000 in
the context unit. Zero/negative results, non-finite input, incompatible units and
out-of-range results produce an actionable diagnostic. Negated, conditional and
compound instructions do not use this local grammar. Existing absolute numeric
assignments and their opposite-direction diagnostics remain separate.

A local recipe is still a proposal. Normal immutable document helpers preserve
stable parameter, feature and body identities. Native OpenCascade preview and
explicit Apply are required before project history changes; the same Undo/Redo
workflow handles the applied result. Relative interpretation alone is not proof
that a proposed modeling operation succeeds.
