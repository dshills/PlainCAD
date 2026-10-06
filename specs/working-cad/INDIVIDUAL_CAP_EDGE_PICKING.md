# Pick individual authored cap edges

Fillet and Chamfer operation tokens offer both original whole-cap perimeter groups
and individual complete authored cap boundaries on untouched native distance/
new-body Extrude owners. Line and arc paths remain open; circles are closed.
Source IDs are preserved in supported edge references. Fragmented/split boundaries,
vertical side edges, boolean-created topology and modified owners are unavailable.

Choose an operation, click an eligible viewer edge or use its exact keyboard card,
review native geometry and Apply. Individual edges take precedence over their
coincident whole-cap group. Adjacent overlapping edge picks require an explicit
card, while whole-cap cards remain available. Supported ownership and exact
references are validated again by the kernel; no nearest-edge guess is saved.

The target limit remains 128. Whole-cap cards across eligible owners are reserved
before individual edges fill the remaining slots. Viewer sampling is separately
bounded to 8192 vertices per target and 65536 total. Geometry exceeding the overlay
budget keeps its explicit card. Overlays allocate no kernel handles and dispose
Three.js resources when task ownership changes or closes.

Existing command enablement, native operation proofs, Cancel/Apply, one Undo,
source result/session checks and downstream validation remain shared. Unsupported,
lost and unchanged treatments produce diagnostics rather than successful no-ops.

Native-WASM tests assert individual fillet/chamfer volume against the authored
edge length and treatment size. Chromium tests pick one visible cap edge on
XY/XZ/YZ and prove changed exact BRep volume, orientation, one Undo/Redo,
parameter edits, durable source references, save/open and signed STL volume. These
checks do not establish arbitrary BRep topology selection or unrestricted fillets.
