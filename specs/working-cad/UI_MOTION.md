# Workbench motion

Dock content, contextual selection controls and selected history steps arrive in
120–140 ms. Buttons transition only their background and border. Dock dimensions
and the WebGL scene do not animate, preserving immediate interaction and idle
rendering. All effects stop under `prefers-reduced-motion: reduce`.

The unobtrusive “Model updated” confirmation follows a changed, accepted native
rebuild with valid finite positive-volume solids. Clicking Apply, draft previews,
failed/fallback rebuilds and metadata-only edits cannot produce this confirmation.
It clears after 1.8 seconds and when another project opens. This is confirmation
of geometry that reached the model, including undo/redo, rather than an optimistic
claim about a button click.

Project data, geometry buffers, camera state and history are unchanged by feedback.
