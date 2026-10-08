# Save or export hub

Save or Export presents five goals in one place:

- **Editable project** preserves sketches, parameters and feature history in
  `.pcaddoc`, even when geometry needs repair.
- **Printing** keeps the existing STL body selection, per-part/combined outputs,
  mesh validation and explicit warning review.
- **Other CAD** opens the native STEP exporter. Choose parts, generate an export
  verified by native reimport, then download. Separate solids retain world poses;
  PlainCAD feature history is not transferred.
- **Image** downloads the project view or a selected rebuilt part as PNG through
  the shared image commands. The hub identifies the captured scope and explains
  missing selections or failed rebuilds. A selected sketch opens its drawing;
  the existing Download sketch PNG action captures its visible annotations.
  Opening a drawing does not itself download an image.
- **Library backup** opens the local library for review and its Download library
  backup action. The pack includes all saved library copies, not merely the open
  project. Existing storage validation and bounded transfer rules apply.

The hub cannot open during an active sketch session or unfinished modeling task.
Finish or cancel drawing gestures before using its image choices. Existing
sketch PNG controls remain in the drawing workspace. This avoids discarding
unfinished gestures to change file tasks.

The hub ends its modal state before opening another shared command. Handoff
checks the captured document, session, rebuild result and selection, including a
second check after close subscribers run. Existing commands own async validation,
encoding, storage and download errors; the hub never claims that opening their
options produced a file. Direct STL options retain their previous labels and
behavior.

Part PNG downloads also verify that the captured part selection remains current
after image encoding and byte conversion. Changing selection prevents the stale
download and allows an explicit retry.
