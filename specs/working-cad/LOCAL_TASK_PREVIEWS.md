# Local sketch task previews

Offset, Mirror/Linear Pattern, Trim/Extend, and Project part edges use the same editing flow:

1. Choose geometry and enter the required inputs. A local preview starts automatically after a 250 ms pause. Projection first checks upstream native boundaries.
2. Review the sketch outline, changed native bodies where present, and the status. Errors remain visible outside collapsed Details. Preview never changes the saved project or undo history.
3. Apply the validated current proposal as one undo step, or Cancel/Escape to leave the project unchanged. The explicit Preview button remains available for retrying the same inputs after a failure.

Changing an input immediately clears Apply and aborts an outstanding request. Rapid changes replace queued previews. Cancellation, unmount, changed document/session/component/sketch/selection, and competing tasks preserve the existing command guards; obsolete responses cannot authorize Apply. Requests have a two-minute timeout, even if a worker fails to respond after cancellation. A timeout clears the pending proof and provides a retryable diagnostic.

Details contains offset hole policy and implementation limits, copy semantics, projection construction mode, and exact trim/extend pick coordinates. Required hole choices are shown automatically when the chosen outline has holes. Trim/Extend shows manual coordinates until a canvas pick exists, then collapses them to favor drawing with the mouse. Ordinary required inputs remain visible.

These automatic previews only solve and rebuild CAD locally. They never call an AI provider. Sketch-only proposals explicitly say that no solid was modeled; operations with solids retain their existing OpenCascade proof requirements. Geometry support and limits are unchanged.
