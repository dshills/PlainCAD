# Click measurements

Open **Measure**, choose **Pick in model**, and click the highlighted geometry.
A single curve shows its analytic length and, for a circle or arc, diameter.
A point shows its world coordinates. Pick a second point for straight-line world
distance, a second straight edge for the smaller undirected angle, or a second
supported planar face for the smaller plane angle. Parallel faces report
**parallel plane separation**: distance between their infinite planes, not the
minimum distance between their finite boundaries. A third click starts a new
measurement. **Done measuring** or Escape releases mouse picking.

Feedback stays visible on the model and in Measure. Measurement units can be
changed independently of project geometry. **Choose model geometry by name**
provides an accessible exact choice for overlapping targets. Existing cross-sketch
point and curve controls remain under **Choose sketch geometry by name**.

Supported model targets are complete native-validated authored extrusion cap
edges, their true endpoints, and currently supported retained planar faces.
Solved sketch points, lines, circles, and arcs are also available when the sketch
is visible. Render view, hidden geometry, rebuilding/failed models, trimmed or
split edges, new boolean topology, arbitrary BRep vertices and curved faces are
unavailable. Mixed pairs and distances involving curved edges produce an explicit
diagnostic rather than an approximation.

Display paths are sampled only for highlighting and mouse hit tolerance. Values
come from solved analytic geometry and native topology eligibility; triangle
edges, sampled chord lengths and mesh bounds never supply measurement values.
Targets are runtime-only, capped at 1,024 targets and 65,536 display vertices, and
cached by document/result identity without retaining documents or results.
Curves and points use two batched draw calls instead of a draw call per target. Native targets receive priority. Very detailed
geometry beyond the overlay budget is excluded. Picks capture the exact current
document and rebuild result; edits, load and rebuild invalidation clear the picks
so Undo cannot revive a stale measurement. No measurement changes project data
or undo history, and PNG export removes measurement overlays.

Validation: analytic and coordinate unit tests in `modelMeasurements.test.ts`,
existing `measurements.test.ts`, and real-kernel mouse acceptance in
`e2e/click-measure.spec.ts`.
