# Sketch mirror and linear copies

Select sketch primitives with Select, then choose Mirror or Linear pattern.
Referenced endpoints and centers join the selection automatically. Preview solves
the proposed sketch and checks downstream modeling in a private worker; Apply
publishes one immutable edit. Cancel leaves the document and history unchanged.
One Undo restores the source, and Redo restores the same copied IDs.

Mirror uses a current line or construction line as its axis. A selected axis is
excluded from copied geometry. Linear pattern accepts X, Y, or a finite nonzero
vector (normalized), positive length spacing including parameter expressions,
and an integer total instance count from 2 through 16, including the source.
There may be at most 64 explicitly selected items, 750 resulting sketch entities,
and 512 constraints plus dimensions, subject also to solver resource limits.
Spacing and resulting coordinate magnitude are bounded to 100,000,000 mm.

Copies are ordinary points, lines, circles and arcs with new IDs. Source IDs and
objects remain unchanged. Arc reflection reverses sweep direction. Internal
constraints and dimensions receive new IDs and remapped references; their
expressions and stable parameter bindings remain shared. Angle dimensions use
the solver's unsigned angle between two directed lines, which a reflection
preserves. Horizontal/vertical intent is preserved for horizontal/vertical axes,
and exchanged for a 45-degree axis. An oblique mirror with directional intent is
refused. Constraints or dimensions crossing the selection are refused with the
intent ID and instructions to select all referenced geometry. Intent referencing
the excluded mirror axis requires an independent axis or explicit intent edit;
selecting the axis cannot satisfy this case. Solver conflicts,
coincident no-op copies, invalidated profiles and ambiguous feature references
produce diagnostics; intent is never silently removed.

Adding a hole changes the enclosing profile signature. An existing Extrude or
Revolve reference is repaired only if its unchanged outer boundary maps uniquely
to the resulting region. Feature IDs remain stable; ambiguous or lost outer
boundaries require explicit repair rather than guessing another region.

These are creation-time copies, not persistent associative pattern features.
Count, mirror axis, and vector are not saved as editable pattern settings. Later
source geometry edits do not automatically regenerate copies. Copies and their
dimensions can be edited independently, while existing parameter expressions
remain shared. A parameter used as spacing remains in copied coordinate
expressions; changing it updates the offsets. Unbound coordinates and radii copy
the actual solved values as independent numeric seeds. No schema change is needed.

A bare-sketch preview reports that no solid was modeled. With downstream
features, Apply requires successful current OpenCascade results, valid BReps,
one solid per exported mesh, and finite positive volumes. Results are tied to
the exact immutable plan, file session, component, canvas session and selected
IDs. Canceled, competing, stale and cross-proposal worker results cannot Apply.

`src/tests/sketchReplication.test.ts` covers immutable geometry, expressions,
reflection orientation, directional intent, explicit limits and private preview
proof. Panel tests cover Cancel, one Undo, focus restoration and stale results.
`e2e/sketch-replication.spec.ts` exercises both modes through public UI controls:
dimension-driven holes in a real extruded plate, exact native volumes and XY/Z
orientation, Cancel, one Undo/Redo, shared radius edit, save/open, and signed STL
volume. Browser results must be reported separately; unit tests alone do not
establish OpenCascade or WebGL behavior.
