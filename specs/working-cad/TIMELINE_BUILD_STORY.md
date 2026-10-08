# Native timeline build stories

Hover or focus a modeling feature in History to inspect its before/after geometry.
Authored feature names remain intact, with a plain-language operation description.
The frames share a scale and the main viewer's +X/-Y/+Z isometric orientation.
Changed parts appear cyan; solid counts, removed parts and native volume changes
explain the result. Escape dismisses the story.

Stories rebuild immutable timeline prefixes using the project's current parameter
values. They are not snapshots of previous parameter values. Future sketches and
features are omitted from each prefix. Failed or unsupported native geometry
produces a visible diagnostic rather than an approximate successful story.

One isolated worker owns the OpenCascade rebuild and OffscreenCanvas depth-buffer
rasterization. Only PNG images and native proof summaries reach the UI. Hover has
a 350 ms delay, leaving or changing the project aborts the job, and obsolete images
are hidden immediately. Up to four feature pairs are cached while the story surface
remains mounted for the current document revision. The main project, selection,
history, rebuild result and camera stay unchanged. Idle stories schedule no frames.

The preview requires native OpenCascade and OffscreenCanvas, supports the first
160 timeline steps, limits each frame to 25,000 triangles and each worker job to
30 seconds. Each PNG is bounded to 100,000 bytes. These are presentation limits,
not changes to modeling availability or export fidelity.

Native and production CSP acceptance verify an asymmetric box with an off-center
bore, actual vertex orientation, native volume change, stale-result cancellation,
unchanged project/camera and depth-correct thumbnail pixels.
