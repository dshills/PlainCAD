# Canvas selection actions

Implemented October 8, 2026. Select a native part to reveal Edit base feature,
Hide part, Isolate part and Draw on face. Right-click a part, or focus the model
canvas and press Shift+F10, for the same menu. Double-click an eligible part to
open its creating Extrude/Revolve editor. Other features remain editable from
the timeline. Deleting the base feature requires an explanatory confirmation;
its sketch stays, dependent features can need repair, and Undo restores it.

Select sketch geometry to reveal Offset, Mirror, Pattern and Delete. Existing
linked/reference protection and whole-shape deletion semantics remain in force.
The sketch canvas also offers Shift+F10 and a right-click menu for the current
selection. It does not infer a different sketch selection from the menu position.

Actions capture the exact document, session, native result and selection. Changed,
hidden, fallback or unsuccessful geometry cannot receive body actions. Measurement
picking and competing tasks retain their own controls. Right-button camera drags
do not open the body menu; menu keys, Escape and focus restoration are supported.
View-only hiding/isolation does not enter document history or project files.
