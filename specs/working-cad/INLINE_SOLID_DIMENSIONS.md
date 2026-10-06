# Inline solid dimension editing

Selecting a current native solid or feature displays authored driving dimensions.
Click a label to open a compact editor near the label. Enter a changed expression,
inspect the native geometry, then Apply. Cancel and Escape discard the draft.

Supported fields are distance extrusion thickness, revolve angle, hole diameter
and blind depth, fillet radius, and chamfer distance. To Face and Through All do
not expose fictional driving thickness/depth. Labels are authored fields, not
arbitrary face or bounding-box measurements.

## Explicit parameter decisions

For a bound formula, choose either a referenced editable parameter or replacement
of that feature formula. Parameter edits preserve the feature formula and binding
IDs and show all dependent parameters, sketches and features, including shared
uses in other components. Locked and derived parameters cannot be edited here;
use Parameters to edit their sources. Feature replacement leaves parameter values
alone and can author another expression with bindings. Extrude's legacy distance
and distance-termination field remain synchronized, matching its normal editor.

Every preview validates the document and expression units, verifies the edited
operation with native BRep metadata and geometry assertions, then rebuilds the
whole downstream document. Invalid, nonpositive, unchanged or failed operations
keep Apply disabled. The underlying kernel rejects unchanged booleans/treatments.
Input changes abort prior isolated workers. Exact document identity, session,
component and current rebuild identity are checked before publication. Apply
creates one immutable undo step; no preview meshes or handles enter project JSON.

The native modal keeps background controls inert and keyboard focus contained.
Edit feature details opens the full operation task for direction, scope and other
settings. Formula replacement and shared-parameter changes always require an
explicit target choice. This editor does not relocate topology or repair lost refs.

## Validation

Unit/component tests cover formula/binding preservation, shared impacts, invalid
fields, latest-result handling, cancellation and same-ID stale project/results.
Development browser tests verify actual BRep volume and orientation, one Undo/Redo,
save/open and STL. Production Workbench tests exercise all five operation types
under CSP. Unit fixtures alone do not establish native geometry.
