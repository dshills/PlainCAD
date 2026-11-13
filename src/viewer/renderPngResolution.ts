import type { PerspectiveCamera, WebGLRenderer } from "three";
import { Vector2 } from "three";
import { PNG_RESOLUTIONS, type PngResolution } from "../persistence/pngResolution";

export function atPngResolution<T>(
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
  resolution: PngResolution | undefined,
  render: (captureCamera: PerspectiveCamera) => T,
): T {
  if (!resolution || resolution === "viewport") return render(camera);

  const { width, height } = PNG_RESOLUTIONS[resolution];
  const context = renderer.getContext();
  const maxViewport = context.getParameter(context.MAX_VIEWPORT_DIMS) as Int32Array;
  if (width > maxViewport[0] || height > maxViewport[1])
    throw new Error("This device cannot render at the selected PNG size. Choose a smaller size.");

  const previousSize = renderer.getSize(new Vector2());
  const previousRatio = renderer.getPixelRatio();
  const exportCamera = camera.clone();
  exportCamera.aspect = width / height;
  // Keep all geometry inside the source frustum when the output becomes narrower.
  if (exportCamera.aspect < camera.aspect) {
    const halfFov = camera.fov * Math.PI / 360;
    exportCamera.fov = 360 / Math.PI * Math.atan(Math.tan(halfFov) * camera.aspect / exportCamera.aspect);
  }
  exportCamera.updateProjectionMatrix();
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    if (renderer.domElement.width !== width || renderer.domElement.height !== height ||
        context.drawingBufferWidth !== width || context.drawingBufferHeight !== height)
      throw new Error("Could not allocate the selected PNG size. Choose a smaller size.");
    // The callback must copy pixels synchronously before the buffer is resized.
    return render(exportCamera);
  } finally {
    renderer.setSize(previousSize.x, previousSize.y, false);
    renderer.setPixelRatio(previousRatio);
  }
}
