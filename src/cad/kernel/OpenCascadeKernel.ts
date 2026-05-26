import { createId } from "../document/ids";
import { KernelAdapter, KernelShape, RenderMesh, TessellationOptions } from "./KernelAdapter";
import { createBoxMesh, createCylinderMesh, createPlateWithCircularHolesMesh, meshToAsciiStl } from "./meshConversion";
import { SketchProfile } from "../sketch/profileDetection";

type MockShape =
  | { kind: "box"; width: number; height: number; depth: number }
  | { kind: "extrusion"; profile: SketchProfile; distance: number };

export class OpenCascadeKernel implements KernelAdapter {
  createBox(width: number, height: number, depth: number): KernelShape {
    return { id: createId("shape"), kernelHandle: { kind: "box", width, height, depth } satisfies MockShape };
  }

  extrudeProfile(profile: SketchProfile, distance: number): KernelShape {
    return { id: createId("shape"), kernelHandle: { kind: "extrusion", profile, distance } satisfies MockShape };
  }

  cut(base: KernelShape): KernelShape {
    return base;
  }

  fuse(a: KernelShape): KernelShape {
    return a;
  }

  tessellate(shape: KernelShape, _options: TessellationOptions): RenderMesh {
    const handle = shape.kernelHandle as MockShape;
    if (handle.kind === "box") {
      return createBoxMesh(shape.id, handle.width, handle.height, handle.depth);
    }
    if (handle.kind === "extrusion") {
      if (handle.profile.outerLoop.type === "circle") {
        const radius = (handle.profile.bounds.maxX - handle.profile.bounds.minX) / 2;
        return createCylinderMesh(shape.id, radius, handle.distance);
      }
      const bounds = handle.profile.bounds;
      const mesh =
        handle.profile.holes.length > 0
          ? createPlateWithCircularHolesMesh(shape.id, bounds, handle.profile.holes, handle.distance)
          : createBoxMesh(shape.id, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, handle.distance);
      return { ...mesh, id: shape.id, bodyId: shape.id };
    }
    throw new Error("Unsupported mock kernel shape.");
  }

  exportStl(shape: KernelShape): ArrayBuffer {
    const mesh = this.tessellate(shape, { linearDeflection: 0.5, angularDeflection: 0.2 });
    return new TextEncoder().encode(meshToAsciiStl(mesh, "PlainCAD")).buffer;
  }

  createCylinder(radius: number, height: number): RenderMesh {
    return createCylinderMesh(createId("body"), radius, height);
  }
}
