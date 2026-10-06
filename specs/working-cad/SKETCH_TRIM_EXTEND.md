# Sketch line Trim and Extend

Open a sketch, select a line, then choose **Trim** or **Extend**. The task also
provides a line selector. Click the drawing or enter pick X/Y in millimeters.
The pick is projected onto the selected line; the preview makes the proposed
change visible before Apply.
**Preview** solves an immutable candidate; **Apply** adds one Undo step. Cancel,
Escape, a changed pick, or a changed project/sketch invalidates the candidate.

Trim removes the interval containing the pick, between finite line intersections
or an endpoint and an intersection. Picking exactly on an intersection is
ambiguous and produces a diagnostic. A line without an interior intersection is
not implicitly deleted: use Delete for whole-line removal. An internal trim
retains the original line ID on the first surviving fragment and adds one new ID
for the second. Retained endpoint IDs stay stable; superseded unused endpoints
are cleaned without removing standalone points or feature centers.

Extend uses the side of the pick nearest an endpoint, then the nearest intersection
of that endpoint's support line with another finite authored line. The boundary
line is never extended implicitly. Construction lines can be boundaries.
An endpoint that already meets a finite boundary is diagnosed rather than
silently skipped in favor of a farther boundary.

This implementation deliberately supports **lines only**, with a 512-entity
limit. Arcs/circles are neither editable targets nor trimming/extension boundaries.
Duplicate/overlapping lines, midpoint endpoint ambiguity, unsupported curves,
missing boundaries, invalid coordinates, and lost feature profiles produce clear
diagnostics. Constraints and dimensions affecting the target or its endpoints,
parameter-bound target endpoints, and referenced revolve axes require explicit
editing first. Extending an endpoint shared with another curve also requires
explicit repair/separation rather than silently disconnecting authored topology.
No design-intent constraint or dimension is silently discarded.

Every downstream feature profile must still resolve. A sketch-only preview is
reported as a sketch solve; when downstream features exist, Apply additionally
requires a successful OpenCascade preview with native geometry assertions. A
worker-issued result is bound to its exact candidate, and source object identity,
document session, component and sketch session are checked again at Apply.

Pure entry point: `buildSketchTrimExtend(document, sketchId, lineId, mode, pick)`.
Command entry points: `openSketchTrimExtend`, `setSketchTrimExtendPick`,
`previewSketchTrimExtend`, `applySketchTrimExtend`, `cancelSketchTrimExtend`.
Runtime ownership is `useSketchTrimExtend.frame`; it is never serialized.
