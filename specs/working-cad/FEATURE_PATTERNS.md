# Associative hole and pocket patterns

Select a Hole or Cut Extrude in the Parts browser or timeline, then choose
**Pattern** in Solid tools (or **Repeat Hole or Pocket** in the command palette).
Set a linear or circular arrangement, inspect the native preview, and Apply.
Double-click the pattern in the timeline or choose Edit Feature to change it.
Cancel leaves the document unchanged; Apply records one Undo step.

Patterns are durable `pattern` features referencing an upstream source feature.
Changing the source hole diameter/depth, pocket profile/depth, source sketch, or
bound parameters updates every copy on rebuild. Count includes the existing
original and accepts an integer scalar expression from 2 through 32. Suppressing
the pattern restores the source-only geometry. Deleting, suppressing, or changing
the source to an unsupported feature reports a source-linked diagnostic; the
pattern remains saved and can be repaired by choosing a supported upstream source
in Edit Feature.

Supported sources are single-center Holes (blind or through all, positive or
negative) and distance Cut Extrudes (positive, negative, or symmetric). Pattern
targets match the source’s explicit target-body scope in the active component.
Revolve, additive features, multi-center Hole groups, other patterns, and to-face
or through-all Cut Extrudes are unavailable as sources.

Linear spacing is measured along the source sketch X or Y axis, with negative
spacing reversing direction. Circular rotation is about the source sketch normal,
using center X/Y in source-sketch coordinates. A signed sweep up to 360 degrees
is supported: full circles use equal angular spacing without duplicating the
original, while partial sweeps include both endpoints. Sketch planes may be
origin, offset, or supported feature-owned faces; world-axis coordinates are not
substituted for the source plane.

The geometry worker recreates the current source tool for each instance and
requires native OpenCascade geometry. Conservative analytic envelopes skip native
pairwise checks only for provably disjoint tools; unknown or overlapping envelopes
retain native proof. Native common-volume checks reject tool
overlaps, including overlap with the original. Atomic scoped cuts reject copies
that remove no new material and targets that do not lose volume. Native BRep
validity, exact volume reduction, solid count and resource limits are enforced
before publishing. Failed patterns retain the last upstream body and block
downstream operations on their targets. Every temporary tool and output is owned
by the rebuild’s disposal scope; pattern JSON contains no kernel or mesh data.

Validation includes pure source-plane placement and bounds tests, malformed/lost
reference imports, parameter binding and dependency tests, stale/forged preview
guards, native browser linear holes and circular YZ pockets, exact-volume checks,
parameter edits, Undo/Redo, save/open and STL export. A schema 14 pattern fixture
has a dedicated production native edit/save/open/export acceptance test.
Native browser volume comparisons use the unrounded exact BRep mass with a
relative tolerance of 1e-8 for floating-point integration; the production UI
readout is checked at its displayed three-decimal precision. Exported triangle
volume separately allows 0.1% curved-surface chord error and requires outward
triangle winding.

The arrangement plan also offers direct spacing, center and signed sweep handles.
Numeric fields remain available, and formulas require explicit replacement
consent before dragging. See [direct pattern controls](PATTERN_CONTROLS.md) for
gesture behavior and limits.
