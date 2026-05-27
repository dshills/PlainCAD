import initOpenCascadeModule from "opencascade.js/dist/opencascade.wasm.js";
import openCascadeWasmUrl from "opencascade.js/dist/opencascade.wasm.wasm?url";
import { createId } from "../document/ids";
import { RevolveAxisReference } from "../document/schema";
import { KernelAdapter, KernelShape, RenderMesh, TessellationOptions } from "./KernelAdapter";
import { computeNormals, createBoxMesh, createCylinderAroundYMesh, createCylinderMesh, createPlateWithCircularHolesMesh } from "./meshConversion";
import { exportMeshesToStl } from "./stlExport";
import { SketchProfile } from "../sketch/profileDetection";

const BOOLEAN_FALLBACK_EPSILON = 1e-7;

type KernelHandle =
  | { kind: "box"; width: number; height: number; depth: number; occtShape?: unknown }
  | { kind: "extrusion"; profile: SketchProfile; distance: number; occtShape?: unknown }
  | { kind: "revolve"; profile: SketchProfile; axis: RevolveAxisReference; angle: number; occtShape?: unknown }
  | { kind: "boolean"; operation: "cut" | "fuse"; base: KernelHandle; tool: KernelHandle; occtShape?: unknown };

function fallbackCut(base: KernelHandle, tool: KernelHandle): KernelHandle | undefined {
  const resolvedBase = resolveFallbackHandle(base);
  if (!resolvedBase || resolvedBase.kind !== "extrusion" || tool.kind !== "extrusion") return undefined;
  if (tool.distance + BOOLEAN_FALLBACK_EPSILON < resolvedBase.distance) return undefined;
  if (resolvedBase.profile.outerLoop.type !== "polygon" || tool.profile.outerLoop.type !== "circle") return undefined;
  const radius = (tool.profile.bounds.maxX - tool.profile.bounds.minX) / 2;
  const x = (tool.profile.bounds.minX + tool.profile.bounds.maxX) / 2;
  const y = (tool.profile.bounds.minY + tool.profile.bounds.maxY) / 2;
  const holeId = tool.profile.outerLoop.entityIds[0];
  if (!holeId) return undefined;
  if (![radius, x, y, resolvedBase.profile.bounds.minX, resolvedBase.profile.bounds.maxX, resolvedBase.profile.bounds.minY, resolvedBase.profile.bounds.maxY].every(Number.isFinite)) return undefined;
  if (x - radius <= resolvedBase.profile.bounds.minX || x + radius >= resolvedBase.profile.bounds.maxX || y - radius <= resolvedBase.profile.bounds.minY || y + radius >= resolvedBase.profile.bounds.maxY) return undefined;
  const fallback: KernelHandle = {
    ...resolvedBase,
    occtShape: undefined,
    profile: {
      ...resolvedBase.profile,
      innerLoops: [...(resolvedBase.profile.innerLoops ?? []), tool.profile.outerLoop],
      holes: [...(resolvedBase.profile.holes ?? []), { id: holeId, x, y, radius }],
    },
  };
  return fallback;
}

function resolveFallbackHandle(handle: KernelHandle): KernelHandle | undefined {
  if (handle.kind !== "boolean") return handle;
  if (handle.occtShape) return handle;
  if (handle.operation !== "cut") return undefined;
  return fallbackCut(handle.base, handle.tool);
}

export class OpenCascadeKernel implements KernelAdapter {
  private static openCascade: Record<string, any> | undefined;
  private static initPromise: Promise<Record<string, any>> | undefined;

  static async initialize(): Promise<void> {
    if (!OpenCascadeKernel.initPromise) {
      OpenCascadeKernel.initPromise = initOpenCascadeModule({
        locateFile(path) {
          return path.endsWith(".wasm") ? openCascadeWasmUrl : path;
        },
      });
    }
    OpenCascadeKernel.openCascade = await OpenCascadeKernel.initPromise;
  }

  createBox(width: number, height: number, depth: number): KernelShape {
    return {
      id: createId("shape"),
      kernelHandle: {
        kind: "box",
        width,
        height,
        depth,
        occtShape: this.createOcctBox(-width / 2, -height / 2, 0, width, height, depth),
      } satisfies KernelHandle,
    };
  }

  extrudeProfile(profile: SketchProfile, distance: number): KernelShape {
    return {
      id: createId("shape"),
      kernelHandle: {
        kind: "extrusion",
        profile,
        distance,
        occtShape: this.createOcctExtrusion(profile, distance),
      } satisfies KernelHandle,
    };
  }

  revolveProfile(profile: SketchProfile, axis: RevolveAxisReference, angle: number): KernelShape {
    return {
      id: createId("shape"),
      kernelHandle: {
        kind: "revolve",
        profile,
        axis,
        angle,
      } satisfies KernelHandle,
    };
  }

  cut(base: KernelShape, tool: KernelShape): KernelShape {
    const oc = OpenCascadeKernel.openCascade;
    const baseHandle = base.kernelHandle as KernelHandle;
    const toolHandle = tool.kernelHandle as KernelHandle;
    if (!oc || !baseHandle.occtShape || !toolHandle.occtShape) {
      const fallback = fallbackCut(baseHandle, toolHandle);
      if (fallback && oc && !fallback.occtShape && fallback.kind === "extrusion") {
        fallback.occtShape = this.createOcctExtrusion(fallback.profile, fallback.distance);
      }
      if (fallback) return { ...base, kernelHandle: fallback };
      throw new Error("Boolean cut failed: OpenCascade shape handles are not available.");
    }
    const cut = new oc.BRepAlgoAPI_Cut_3(baseHandle.occtShape, toolHandle.occtShape);
    try {
      if (!cut.IsDone()) {
        throw new Error("Boolean cut failed.");
      }
      const nextShape = cut.Shape();
      return { ...base, kernelHandle: { kind: "boolean", operation: "cut", base: baseHandle, tool: toolHandle, occtShape: nextShape } satisfies KernelHandle };
    } finally {
      deleteOcct(cut);
    }
  }

  cutAll(base: KernelShape, tools: KernelShape[]): KernelShape {
    let current = base;
    for (const tool of tools) {
      const next = this.cut(current, tool);
      if (current !== base) this.disposeShape(current);
      current = next;
    }
    return current;
  }

  fuse(a: KernelShape, b: KernelShape): KernelShape {
    const oc = OpenCascadeKernel.openCascade;
    const aHandle = a.kernelHandle as KernelHandle;
    const bHandle = b.kernelHandle as KernelHandle;
    if (!oc || !aHandle.occtShape || !bHandle.occtShape) {
      throw new Error("Boolean join failed: OpenCascade shape handles are not available.");
    }
    const fuse = new oc.BRepAlgoAPI_Fuse_3(aHandle.occtShape, bHandle.occtShape);
    try {
      if (!fuse.IsDone()) throw new Error("Boolean join failed.");
      return { ...a, kernelHandle: { kind: "boolean", operation: "fuse", base: aHandle, tool: bHandle, occtShape: fuse.Shape() } satisfies KernelHandle };
    } finally {
      deleteOcct(fuse);
    }
  }

  tessellate(shape: KernelShape, _options: TessellationOptions): RenderMesh {
    const handle = shape.kernelHandle as KernelHandle;
    const occtMesh = this.tessellateOcctShape(shape.id, handle.occtShape, _options);
    if (occtMesh) return occtMesh;
    if (handle.kind === "box") {
      return createBoxMesh(shape.id, handle.width, handle.height, handle.depth);
    }
    if (handle.kind === "extrusion") {
      if (handle.profile.outerLoop.type === "circle") {
        const radius = (handle.profile.bounds.maxX - handle.profile.bounds.minX) / 2;
        const centerX = (handle.profile.bounds.minX + handle.profile.bounds.maxX) / 2;
        const centerY = (handle.profile.bounds.minY + handle.profile.bounds.maxY) / 2;
        return translateMesh(createCylinderMesh(shape.id, radius, handle.distance), centerX, centerY, 0);
      }
      const bounds = handle.profile.bounds;
      const mesh =
        handle.profile.holes.length > 0
          ? createPlateWithCircularHolesMesh(shape.id, bounds, handle.profile.holes, handle.distance)
          : translateMesh(createBoxMesh(shape.id, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, handle.distance), (bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0);
      return { ...mesh, id: shape.id, bodyId: shape.id };
    }
    if (handle.kind === "revolve") {
      if (handle.axis.type !== "origin" || handle.axis.axis !== "Y" || handle.profile.outerLoop.type !== "polygon") {
        throw new Error("Revolve fallback supports closed polygon profiles around the origin Y axis.");
      }
      if (Math.abs(handle.angle - Math.PI * 2) > 1e-6) {
        throw new Error("Revolve fallback currently supports full 360 degree revolves.");
      }
      if (handle.profile.bounds.minX < -BOOLEAN_FALLBACK_EPSILON) {
        throw new Error("Revolve profile crosses the selected axis.");
      }
      return createCylinderAroundYMesh(shape.id, handle.profile.bounds.maxX, handle.profile.bounds.minY, handle.profile.bounds.maxY, 48, Math.max(0, handle.profile.bounds.minX));
    }
    if (handle.kind === "boolean" && handle.operation === "cut") {
      const fallback = fallbackCut(handle.base, handle.tool);
      if (fallback) return this.tessellate({ ...shape, kernelHandle: fallback }, _options);
    }
    throw new Error("Unsupported kernel shape.");
  }

  exportStl(shape: KernelShape): ArrayBuffer {
    const mesh = this.tessellate(shape, { linearDeflection: 0.5, angularDeflection: 0.2 });
    return exportMeshesToStl([mesh]);
  }

  createCylinder(radius: number, height: number): RenderMesh {
    return createCylinderMesh(createId("body"), radius, height);
  }

  disposeShape(shape: KernelShape): void {
    const handle = shape.kernelHandle as KernelHandle;
    deleteOcct(handle.occtShape);
    handle.occtShape = undefined;
  }

  private createOcctBox(minX: number, minY: number, minZ: number, width: number, height: number, depth: number): unknown | undefined {
    const oc = OpenCascadeKernel.openCascade;
    if (!oc) return undefined;
    const point = new oc.gp_Pnt_3(minX, minY, minZ);
    const box = new oc.BRepPrimAPI_MakeBox_2(point, width, height, depth);
    try {
      return box.Shape();
    } finally {
      deleteOcct(box);
      deleteOcct(point);
    }
  }

  private createOcctExtrusion(profile: SketchProfile, distance: number): unknown | undefined {
    const oc = OpenCascadeKernel.openCascade;
    if (!oc) return undefined;
    let shape: unknown | undefined;
    if (profile.outerLoop.type === "circle") {
      const radius = (profile.bounds.maxX - profile.bounds.minX) / 2;
      const centerX = (profile.bounds.minX + profile.bounds.maxX) / 2;
      const centerY = (profile.bounds.minY + profile.bounds.maxY) / 2;
      shape = this.createOcctCylinder(centerX, centerY, radius, distance);
    } else {
      shape = this.createOcctBox(
        profile.bounds.minX,
        profile.bounds.minY,
        0,
        profile.bounds.maxX - profile.bounds.minX,
        profile.bounds.maxY - profile.bounds.minY,
        distance,
      );
    }
    for (const hole of profile.holes) {
      const tool = this.createOcctCylinder(hole.x, hole.y, hole.radius, distance * 1.5, -distance * 0.25);
      if (shape && tool) {
        const previousShape = shape;
        let cut: unknown | undefined;
        try {
          cut = new oc.BRepAlgoAPI_Cut_3(previousShape, tool);
          shape = (cut as { Shape: () => unknown }).Shape();
        } finally {
          deleteOcct(cut);
          deleteOcct(previousShape);
          deleteOcct(tool);
        }
      }
    }
    return shape;
  }

  private createOcctCylinder(x: number, y: number, radius: number, height: number, z = 0): unknown | undefined {
    const oc = OpenCascadeKernel.openCascade;
    if (!oc) return undefined;
    const point = new oc.gp_Pnt_3(x, y, z);
    const direction = new oc.gp_Dir_4(0, 0, 1);
    const axis = new oc.gp_Ax2_3(point, direction);
    const cylinder = new oc.BRepPrimAPI_MakeCylinder_3(axis, radius, height);
    try {
      return cylinder.Shape();
    } finally {
      deleteOcct(cylinder);
      deleteOcct(axis);
      deleteOcct(direction);
      deleteOcct(point);
    }
  }

  private tessellateOcctShape(bodyId: string, shape: unknown | undefined, options: TessellationOptions): RenderMesh | undefined {
    const oc = OpenCascadeKernel.openCascade;
    if (!oc || !shape) return undefined;

    const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, options.linearDeflection, false, options.angularDeflection, false);
    const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    const positions: number[] = [];
    const indices: number[] = [];
    try {
      for (; explorer.More(); explorer.Next()) {
        const faceShape = explorer.Current();
        const face = oc.TopoDS.Face_1(faceShape);
        const location = new oc.TopLoc_Location_1();
        const triangulationHandle = oc.BRep_Tool.Triangulation(face, location);
        try {
          if (!triangulationHandle || triangulationHandle.IsNull()) continue;
          const triangulation = triangulationHandle.get();
          try {
            const offset = positions.length / 3;
            for (let index = 1; index <= triangulation.NbNodes(); index += 1) {
              const point = triangulation.Node(index);
              positions.push(point.X(), point.Y(), point.Z());
              deleteOcct(point);
            }
            const orientation = face.Orientation_1();
            const reversed = orientation.isAliasOf?.(oc.TopAbs_Orientation.TopAbs_REVERSED) ?? false;
            deleteOcct(orientation);
            for (let index = 1; index <= triangulation.NbTriangles(); index += 1) {
              const triangle = triangulation.Triangle(index);
              const a = offset + triangle.Value(1) - 1;
              const b = offset + triangle.Value(2) - 1;
              const c = offset + triangle.Value(3) - 1;
              indices.push(...(reversed ? [a, c, b] : [a, b, c]));
              deleteOcct(triangle);
            }
          } finally {
            // The underlying triangulation is owned by triangulationHandle.
          }
        } finally {
          deleteOcct(triangulationHandle);
          deleteOcct(location);
          deleteOcct(face);
          deleteOcct(faceShape);
        }
      }
    } finally {
      deleteOcct(explorer);
      deleteOcct(mesh);
    }
    if (positions.length === 0 || indices.length === 0) return undefined;
    return {
      id: bodyId,
      bodyId,
      positions,
      normals: computeNormals(positions, indices),
      indices,
      color: "#8fb7b4",
      bounds: boundsFromPositions(positions),
    };
  }
}

function deleteOcct(value: unknown): void {
  const disposable = value as { delete?: () => void; isDeleted?: () => boolean } | undefined;
  if (!disposable?.delete) return;
  if (disposable.isDeleted?.()) return;
  disposable.delete();
}

function translateMesh(mesh: RenderMesh, x: number, y: number, z: number): RenderMesh {
  if (Math.abs(x) <= BOOLEAN_FALLBACK_EPSILON && Math.abs(y) <= BOOLEAN_FALLBACK_EPSILON && Math.abs(z) <= BOOLEAN_FALLBACK_EPSILON) return mesh;
  const positions = ArrayBuffer.isView(mesh.positions) ? new Float32Array(mesh.positions) : Array.from(mesh.positions);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] += x;
    positions[index + 1] += y;
    positions[index + 2] += z;
  }
  return {
    ...mesh,
    positions,
    bounds: {
      min: [mesh.bounds.min[0] + x, mesh.bounds.min[1] + y, mesh.bounds.min[2] + z],
      max: [mesh.bounds.max[0] + x, mesh.bounds.max[1] + y, mesh.bounds.max[2] + z],
    },
  };
}

function boundsFromPositions(positions: number[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    min[0] = Math.min(min[0], positions[index]);
    min[1] = Math.min(min[1], positions[index + 1]);
    min[2] = Math.min(min[2], positions[index + 2]);
    max[0] = Math.max(max[0], positions[index]);
    max[1] = Math.max(max[1], positions[index + 1]);
    max[2] = Math.max(max[2], positions[index + 2]);
  }
  return { min, max };
}
