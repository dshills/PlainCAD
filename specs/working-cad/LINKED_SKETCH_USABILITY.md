# Linked sketch geometry

Projected boundaries carry a **Linked** badge in their cards and sketch-item
choices. Linked curves use a dashed stroke in the sketch canvas. Selecting a
linked member explains its source part, feature and sketch, and why coordinates
and dimensions cannot be edited independently.

Each boundary exposes these actions:

- **Show source** selects its authored extrusion controls and highlights the
  surviving source body. The destination drawing stays open and its geometry
  selection remains intact.
- **Edit source** opens the extrusion's actual source sketch, activating its
  component as needed. Finished drawing edits are already stored and remain
  undoable. An incomplete drawing or drag gesture vetoes this switch; finish or
  cancel it first. Concurrent modeling/file operations also block navigation.
- **Make independent** retains the current solved geometry and removes its
  projection association in one undo step. It requires a current successful
  rebuild and preserves existing protected dependency checks.
- **Repair link** opens the existing native boundary picker. Repairing the same
  authored boundary retains linked member IDs; changing shape requires explicit
  removal, replacement and downstream reference repair.

Placed world links follow source dimensions and component placement. Legacy
links retain authored design coordinates. Neither display nor navigation changes
that persisted association. Missing or unsupported sources are explained and
cannot be guessed; a surviving compatible boundary must be chosen explicitly.

Source navigation is transient. It adds no undo step and changes no project
geometry. Captured actions reject replaced documents, sessions, canvas sessions
or link identities, including changes during gesture cancellation. Native browser
acceptance covers exact circular and arc projections, source parameter changes,
independence/Undo, cancellation, editable save/open and native STL export.
