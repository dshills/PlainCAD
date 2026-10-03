import { assertMeshBudget } from "../resourceLimits";
import initOpenCascadeModule from "opencascade.js/dist/opencascade.wasm.js";
import openCascadeWasmUrl from "opencascade.js/dist/opencascade.wasm.wasm?url";
import { createId } from "../document/ids";
import { RevolveAxisReference, TopologyRef } from "../document/schema";
import {
  HoleScopeError,
  KernelAdapter,
  KernelShape,
  RenderMesh,
  TessellationOptions,
  ResolvedRevolveAxis,
  GeometryAssertions,
} from "./KernelAdapter";
import {
  computeNormals,
  createBoxMesh,
  createCylinderAroundYMesh,
  createCylinderMesh,
  createPlateWithCircularHolesMesh,
} from "./meshConversion";
import { exportMeshesToStl } from "./stlExport";
import { linearProfileExtents } from "../sketch/profileExtents";
import { SketchProfile } from "../sketch/profileDetection";
import {
  SketchPlaneTransform,
  sketchPlaneTransform,
  transformPoint,
  sketchVectorToWorld,
} from "../sketch/planes";
import {
  extrudedProfileMesh,
  orientedSegments,
  transformProfileMesh,
} from "./profileMesh";
import {
  DisposableHandle,
  DisposableScope,
  withDisposableScope,
} from "./disposableScope";

import { KERNEL_LINEAR_TOLERANCE } from "../sketch/tolerances";

import {
  dot,
  subtract,
  near,
  measureShape,
  volumeTolerance,
  planarFaces,
  surfaceArea,
} from "./occtGeometry";

const BOOLEAN_FALLBACK_EPSILON = KERNEL_LINEAR_TOLERANCE;

type KernelHandle =
  | {
      kind: "box";
      width: number;
      height: number;
      depth: number;
      occtShape?: unknown;
    }
  | {
      kind: "extrusion";
      profile: SketchProfile;
      distance: number;
      transform?: SketchPlaneTransform;
      occtShape?: unknown;
    }
  | {
      kind: "revolve";
      profile: SketchProfile;
      axis: RevolveAxisReference;
      transform?: SketchPlaneTransform;
      angle: number;
      occtShape?: unknown;
    }
  | {
      kind: "fillet" | "chamfer" | "toFace";
      base: KernelHandle;
      occtShape?: unknown;
    }
  | {
      kind: "boolean";
      operation: "cut" | "fuse";
      base: KernelHandle;
      tool: KernelHandle;
      occtShape?: unknown;
    };

function fallbackCut(
  base: KernelHandle,
  tool: KernelHandle,
): KernelHandle | undefined {
  const resolvedBase = resolveFallbackHandle(base);
  if (
    !resolvedBase ||
    resolvedBase.kind !== "extrusion" ||
    tool.kind !== "extrusion"
  )
    return undefined;
  if (JSON.stringify(resolvedBase.transform) !== JSON.stringify(tool.transform))
    return undefined;
  if (tool.distance + BOOLEAN_FALLBACK_EPSILON < resolvedBase.distance)
    return undefined;
  if (
    resolvedBase.profile.outerLoop.type !== "polygon" ||
    tool.profile.outerLoop.type !== "circle"
  )
    return undefined;
  if (
    !resolvedBase.profile.alternateIds?.includes(
      `${resolvedBase.profile.sketchId}:profile:rectangle`,
    )
  )
    return undefined;
  const radius = (tool.profile.bounds.maxX - tool.profile.bounds.minX) / 2;
  const x = (tool.profile.bounds.minX + tool.profile.bounds.maxX) / 2;
  const y = (tool.profile.bounds.minY + tool.profile.bounds.maxY) / 2;
  const holeId = tool.profile.outerLoop.entityIds[0];
  if (!holeId) return undefined;
  if (
    ![
      radius,
      x,
      y,
      resolvedBase.profile.bounds.minX,
      resolvedBase.profile.bounds.maxX,
      resolvedBase.profile.bounds.minY,
      resolvedBase.profile.bounds.maxY,
    ].every(Number.isFinite)
  )
    return undefined;
  if (
    x - radius <= resolvedBase.profile.bounds.minX ||
    x + radius >= resolvedBase.profile.bounds.maxX ||
    y - radius <= resolvedBase.profile.bounds.minY ||
    y + radius >= resolvedBase.profile.bounds.maxY
  )
    return undefined;
  const fallback: KernelHandle = {
    ...resolvedBase,
    occtShape: undefined,
    profile: {
      ...resolvedBase.profile,
      innerLoops: [
        ...(resolvedBase.profile.innerLoops ?? []),
        tool.profile.outerLoop,
      ],
      holes: [
        ...(resolvedBase.profile.holes ?? []),
        { id: holeId, x, y, radius },
      ],
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
  private readonly assertions = new WeakMap<object, GeometryAssertions>();

  private measureNative(shape: any): GeometryAssertions {
    const cached = this.assertions.get(shape);
    if (cached) return cached;
    const measured = measureShape(OpenCascadeKernel.openCascade!, shape);
    this.assertions.set(shape, measured);
    return measured;
  }

  private static openCascade: Record<string, any> | undefined;
  private static initPromise: Promise<Record<string, any>> | undefined;

  getWasmHeapCapacityBytes(): number | undefined {
    const bytes = OpenCascadeKernel.openCascade?.HEAPU8?.buffer?.byteLength;
    return typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
  }

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
        occtShape: this.createOcctBox(
          -width / 2,
          -height / 2,
          0,
          width,
          height,
          depth,
        ),
      } satisfies KernelHandle,
    };
  }

  extrudeProfile(
    profile: SketchProfile,
    distance: number,
    transform = sketchPlaneTransform("XY"),
  ): KernelShape {
    if (!Number.isFinite(distance) || distance <= 0)
      throw new Error("Extrude distance must be a positive finite length.");
    return {
      id: createId("shape"),
      kernelHandle: {
        kind: "extrusion",
        profile,
        distance,
        transform,
        occtShape: this.createOcctExtrusion(profile, distance, transform),
      } satisfies KernelHandle,
    };
  }

  revolveProfile(
    profile: SketchProfile,
    axis: RevolveAxisReference,
    angle: number,
    transform: SketchPlaneTransform,
    resolvedAxis: ResolvedRevolveAxis,
  ): KernelShape {
    return {
      id: createId("shape"),
      kernelHandle: {
        kind: "revolve",
        profile,
        axis,
        angle,
        transform,
        occtShape: this.createOcctRevolve(
          profile,
          angle,
          transform,
          resolvedAxis,
        ),
      } satisfies KernelHandle,
    };
  }

  cut(base: KernelShape, tool: KernelShape): KernelShape {
    const oc = OpenCascadeKernel.openCascade;
    const baseHandle = base.kernelHandle as KernelHandle;
    const toolHandle = tool.kernelHandle as KernelHandle;
    if (!oc || !baseHandle.occtShape || !toolHandle.occtShape) {
      const fallback = fallbackCut(baseHandle, toolHandle);
      if (
        fallback &&
        oc &&
        !fallback.occtShape &&
        fallback.kind === "extrusion"
      ) {
        fallback.occtShape = this.createOcctExtrusion(
          fallback.profile,
          fallback.distance,
          fallback.transform,
        );
      }
      if (fallback) return { ...base, kernelHandle: fallback };
      throw new Error(
        "Boolean cut failed: OpenCascade shape handles are not available.",
      );
    }
    return this.booleanResult(base, tool, "cut");
  }

  cutAll(base: KernelShape, tools: KernelShape[]): KernelShape {
    let current = base;
    try {
      for (const tool of tools) {
        const next = this.cut(current, tool);
        if (current !== base) this.disposeShape(current);
        current = next;
      }
      return current;
    } catch (error) {
      if (current !== base) this.disposeShape(current);
      throw error;
    }
  }

  cutScope(targets: KernelShape[], tools: KernelShape[]): KernelShape[] {
    if (!targets.length || !tools.length)
      throw new Error("Hole scope requires target bodies and center tools.");
    const owned = new Set<KernelShape>();
    const combine = (shapes: KernelShape[]) => {
      let current = shapes[0];
      for (const shape of shapes.slice(1)) {
        const next = this.unionSolids(current, shape);
        owned.add(next);
        if (owned.delete(current)) this.disposeShape(current);
        current = next;
      }
      return current;
    };
    try {
      // unionSolids deliberately permits valid multi-solid compounds (also used
      // for STL union export). cut validates reduced volume without requiring a
      // single solid, so separated target bodies are supported here.
      const targetUnion = combine(targets);
      // A center may miss individual bodies but must cut the original scope.
      // Validate against original targets so overlapping tools are order independent.
      for (const [index, tool] of tools.entries()) {
        try {
          const probe = this.cut(targetUnion, tool);
          this.disposeShape(probe);
        } catch (error) {
          throw new HoleScopeError("center", index,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      const toolUnion = combine(tools);
      const outputs = targets.map((target, index) => {
        try {
          const output = this.cut(target, toolUnion);
          owned.add(output);
          return output;
        } catch (error) {
          throw new HoleScopeError("target", index,
            error instanceof Error ? error.message : String(error),
          );
        }
      });
      for (const output of outputs) owned.delete(output);
      return outputs;
    } finally {
      for (const shape of owned) this.disposeShape(shape);
    }
  }

  fuse(a: KernelShape, b: KernelShape): KernelShape {
    return this.booleanResult(a, b, "fuse");
  }

  unionForExport(base: KernelShape, tool: KernelShape): KernelShape {
    return this.unionSolids(base, tool);
  }

  joinAll(targets: KernelShape[], tool: KernelShape): KernelShape {
    if (!targets.length) throw new Error("Boolean join requires target bodies.");
    if (targets.length === 1) return this.fuse(targets[0], tool);
    let current = targets[0];
    let result: KernelShape | undefined;
    try {
      // Intermediate target unions may be disconnected. Only the completed bridge
      // must be one solid, so the saved target order cannot affect connectivity.
      for (const target of targets.slice(1)) {
        const next = this.unionSolids(current, target);
        if (current !== targets[0]) this.disposeShape(current);
        current = next;
      }
      const before = this.measureNative(
        (current.kernelHandle as KernelHandle).occtShape,
      );
      const toolStats = this.measureNative(
        (tool.kernelHandle as KernelHandle).occtShape,
      );
      result = this.unionSolids(current, tool);
      const after = this.measureNative(
        (result.kernelHandle as KernelHandle).occtShape,
      );
      const tolerance = volumeTolerance(before.volume);
      if (after.solidCount !== 1)
        throw new Error(
          "Boolean join requires connected solids. Connect every selected target with the tool.",
        );
      if (after.volume - before.volume <= tolerance)
        throw new Error(
          "Boolean join added no volume beyond the selected target bodies.",
        );
      if (
        after.volume > before.volume + toolStats.volume + tolerance ||
        after.volume < before.volume - tolerance
      )
        throw new Error("Boolean join produced an inconsistent solid volume.");
      return result;
    } catch (error) {
      if (result) this.disposeShape(result);
      throw error;
    } finally {
      if (current !== targets[0]) this.disposeShape(current);
    }
  }

  private unionSolids(base: KernelShape, tool: KernelShape): KernelShape {
    const oc = OpenCascadeKernel.openCascade;
    const a = base.kernelHandle as KernelHandle,
      b = tool.kernelHandle as KernelHandle;
    if (!oc || !a.occtShape || !b.occtShape)
      throw new Error("Union requires native OpenCascade solids.");
    return withDisposableScope((scope) => {
      const before = this.measureNative(a.occtShape);
      const toolStats = this.measureNative(b.occtShape);
      const builder = scope.use(
        new oc.BRepAlgoAPI_Fuse_3(a.occtShape, b.occtShape),
      );
      if (!builder.IsDone())
        throw new Error("OpenCascade rejected the union.");
      const shape = scope.use(builder.Shape());
      const after = this.measureNative(shape);
      const tolerance = volumeTolerance(before.volume + toolStats.volume);
      if (
        after.volume < Math.max(before.volume, toolStats.volume) - tolerance ||
        after.volume > before.volume + toolStats.volume + tolerance
      )
        throw new Error("Union produced an inconsistent solid volume.");
      return {
        ...base,
        kernelHandle: {
          kind: "boolean",
          operation: "fuse",
          base: a,
          tool: b,
          occtShape: scope.release(shape),
        } satisfies KernelHandle,
      };
    });
  }

  private booleanResult(
    base: KernelShape,
    tool: KernelShape,
    operation: "cut" | "fuse",
  ): KernelShape {
    const oc = OpenCascadeKernel.openCascade;
    const a = base.kernelHandle as KernelHandle,
      b = tool.kernelHandle as KernelHandle;
    const label = operation === "cut" ? "Boolean cut" : "Boolean join";
    if (!oc || !a.occtShape || !b.occtShape)
      throw new Error(
        `${label} failed: OpenCascade shape handles are not available.`,
      );
    return withDisposableScope((scope) => {
      const before = this.measureNative(a.occtShape);
      const toolStats = this.measureNative(b.occtShape);
      const builder = scope.use(
        operation === "cut"
          ? new oc.BRepAlgoAPI_Cut_3(a.occtShape, b.occtShape)
          : new oc.BRepAlgoAPI_Fuse_3(a.occtShape, b.occtShape),
      );
      if (!builder.IsDone())
        throw new Error(`${label} failed. Adjust the intersecting geometry.`);
      const result = scope.use(builder.Shape());
      const after = this.measureNative(result);
      const tolerance = volumeTolerance(before.volume);
      if (operation === "cut" && before.volume - after.volume <= tolerance)
        throw new Error(
          "Boolean cut removed no volume. Move the tool into the target body.",
        );
      if (operation === "cut" && after.volume > before.volume + tolerance)
        throw new Error("Boolean cut produced an inconsistent solid volume.");
      if (operation === "fuse" && after.solidCount !== 1)
        throw new Error(
          "Boolean join requires connected solids. Move the tool to intersect or share a face with the target.",
        );
      if (operation === "fuse" && after.volume - before.volume <= tolerance)
        throw new Error(
          "Boolean join added no volume. The tool is already contained in the target body.",
        );
      if (
        operation === "fuse" &&
        (after.volume > before.volume + toolStats.volume + tolerance ||
          after.volume < before.volume - tolerance)
      )
        throw new Error("Boolean join produced an inconsistent solid volume.");
      return {
        ...base,
        kernelHandle: {
          kind: "boolean",
          operation,
          base: a,
          tool: b,
          occtShape: scope.release(result),
        } satisfies KernelHandle,
      };
    });
  }

  fillet(shape: KernelShape, refs: TopologyRef[], radius: number): KernelShape {
    return this.treatEdges(shape, refs, radius, "fillet");
  }

  chamfer(
    shape: KernelShape,
    refs: TopologyRef[],
    distance: number,
  ): KernelShape {
    return this.treatEdges(shape, refs, distance, "chamfer");
  }

  private treatEdges(
    shape: KernelShape,
    refs: TopologyRef[],
    size: number,
    operation: "fillet" | "chamfer",
  ): KernelShape {
    const oc = OpenCascadeKernel.openCascade;
    const base = shape.kernelHandle as KernelHandle;
    if (!oc || !base.occtShape)
      throw new Error(
        `${operation} requires initialized OpenCascade geometry.`,
      );
    if (!Number.isFinite(size) || size <= 0)
      throw new Error(`${operation} size must be a positive finite length.`);
    try {
      return withDisposableScope((scope) => {
        const before = this.measureNative(base.occtShape);
        const edges = this.resolveNativeEdges(base, refs, scope);
        const builder = scope.use(
          operation === "fillet"
            ? new oc.BRepFilletAPI_MakeFillet(
                base.occtShape,
                oc.ChFi3d_FilletShape.ChFi3d_Rational,
              )
            : new oc.BRepFilletAPI_MakeChamfer(base.occtShape),
        );
        for (const edge of edges) builder.Add_2(size, edge);
        if (edges.some((edge) => builder.Contour(edge) === 0))
          throw new Error(
            "Some selected edges are not sharp treatment contours. Reselect sharp edges.",
          );
        if (builder.NbContours() === 0)
          throw new Error("No sharp edge contours were found for treatment.");
        builder.Build();
        if (!builder.IsDone())
          throw new Error(
            "OpenCascade could not build the edge treatment. Reduce its size or reselect edges.",
          );
        const result = scope.use(builder.Shape());
        const after = this.measureNative(result);
        if (after.solidCount !== before.solidCount)
          throw new Error(
            "Edge treatment changed the number of solids. Reduce its size or reselect edges.",
          );
        if (
          Math.abs(before.volume - after.volume) <=
            volumeTolerance(before.volume) &&
          Math.abs(before.surfaceArea - after.surfaceArea) <=
            volumeTolerance(before.surfaceArea)
        )
          throw new Error(
            "Edge treatment left geometry unchanged. Reselect sharp edges or reduce its size.",
          );
        return {
          ...shape,
          kernelHandle: {
            kind: operation,
            base,
            occtShape: scope.release(result),
          } satisfies KernelHandle,
        };
      });
    } catch (error) {
      throw new Error(
        `${operation} failed: ${error instanceof Error ? error.message : "OpenCascade rejected the size or edge configuration. Reduce the size or repair the edge references."}`,
      );
    }
  }

  private resolveNativeEdges(
    handle: KernelHandle,
    refs: TopologyRef[],
    scope: DisposableScope,
  ): any[] {
    const oc = OpenCascadeKernel.openCascade!;
    let source = handle;
    while (source.kind === "fillet" || source.kind === "chamfer")
      source = source.base;
    if (source.kind !== "extrusion" || !source.transform)
      throw new Error(
        "Edge reference requires repair: its owner is no longer an unmodified distance extrusion or an edge treatment of one.",
      );
    const transform = source.transform;
    const explorer = scope.use(
      new oc.TopExp_Explorer_2(
        handle.occtShape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    const candidates: Array<{
      edge: any;
      points: Array<{ x: number; y: number; z: number }>;
    }> = [];
    for (; explorer.More(); explorer.Next()) {
      const current = scope.use(explorer.Current());
      const edge = scope.use(oc.TopoDS.Edge_1(current));
      if (candidates.some((c) => c.edge.IsSame(edge))) continue;
      const curve = scope.use(new oc.BRepAdaptor_Curve_2(edge));
      const first = curve.FirstParameter(),
        last = curve.LastParameter();
      const points = [
        first,
        first + (last - first) * 0.25,
        (first + last) / 2,
        first + (last - first) * 0.75,
        last,
      ].map((t) => {
        return withDisposableScope((pointScope) => {
          const p = pointScope.use(curve.Value(t));
          return { x: p.X(), y: p.Y(), z: p.Z() };
        });
      });
      candidates.push({ edge, points });
    }
    const selected: any[] = [];
    const segments = orientedSegments(source.profile.outerLoop, false).concat(
      ...source.profile.innerLoops.map((l) => orientedSegments(l, true)),
    );
    for (const ref of refs) {
      if (ref.repairRequired || ref.kind !== "edge")
        throw new Error("Edge reference requires repair.");
      const segment = segments.find((s) => s.id === ref.sourceEntityId);
      const height = ref.role === "startCapPerimeter" ? 0 : source.distance;
      const matches = candidates.filter(({ points }) => {
        if (ref.role === "profileEdge") {
          if (!segment || segment.type !== "line") return false;
          return [segment.start, segment.end].some((p) => {
            const start = transformPoint(transform, p.x, p.y),
              end = transformPoint(transform, p.x, p.y, source.distance);
            return (
              (near(points[0], start) && near(points[4], end)) ||
              (near(points[4], start) && near(points[0], end))
            );
          });
        }
        if (ref.role !== "startCapPerimeter" && ref.role !== "endCapPerimeter")
          return false;
        if (
          !points.every(
            (p) =>
              Math.abs(
                dot(subtract(p, transform.origin), transform.normal) - height,
              ) <=
              BOOLEAN_FALLBACK_EPSILON * 10,
          )
        )
          return false;
        if (!ref.sourceEntityId) return true;
        if (!segment) return false;
        const start = transformPoint(
            transform,
            segment.start.x,
            segment.start.y,
            height,
          ),
          end = transformPoint(transform, segment.end.x, segment.end.y, height);
        const mid =
          segment.type === "line"
            ? transformPoint(
                transform,
                (segment.start.x + segment.end.x) / 2,
                (segment.start.y + segment.end.y) / 2,
                height,
              )
            : transformPoint(
                transform,
                segment.center.x +
                  segment.radius *
                    Math.cos(segment.startAngle + segment.sweep / 2),
                segment.center.y +
                  segment.radius *
                    Math.sin(segment.startAngle + segment.sweep / 2),
                height,
              );
        return (
          near(points[2], mid) &&
          ((near(points[0], start) && near(points[4], end)) ||
            (near(points[4], start) && near(points[0], end)))
        );
      });
      if (
        !matches.length ||
        (ref.role === "profileEdge" && matches.length !== 2) ||
        (ref.sourceEntityId &&
          ref.role !== "profileEdge" &&
          matches.length !== 1)
      )
        throw new Error(
          "Edge reference was lost or is ambiguous. Reselect the current feature-owned perimeter.",
        );
      for (const match of matches)
        if (!selected.some((edge) => edge.IsSame(match.edge)))
          selected.push(match.edge);
    }
    if (!selected.length)
      throw new Error("Select at least one supported extrusion edge.");
    return selected;
  }

  tessellate(shape: KernelShape, options: TessellationOptions): RenderMesh {
    const handle = shape.kernelHandle as KernelHandle;
    const occtMesh = this.tessellateOcctShape(
      shape.id,
      handle.occtShape,
      options,
    );
    if (!occtMesh && handle.occtShape)
      throw new Error(
        "OpenCascade generated a shape without tessellatable faces.",
      );
    if (occtMesh)
      return {
        ...occtMesh,
        geometrySource: "opencascade",
        kernelOperation:
          handle.kind === "boolean" ? handle.operation : handle.kind,
        geometryAssertions: this.measureNative(handle.occtShape),
      };
    return {
      ...this.tessellateFallback(shape, options),
      geometrySource: "fallback",
    };
  }

  private tessellateFallback(
    shape: KernelShape,
    _options: TessellationOptions,
  ): RenderMesh {
    const handle = shape.kernelHandle as KernelHandle;
    if (handle.kind === "box") {
      return createBoxMesh(shape.id, handle.width, handle.height, handle.depth);
    }
    if (handle.kind === "extrusion") {
      if (
        handle.profile.outerLoop.segments?.length ||
        handle.profile.innerLoops.some((l) => l.segments?.length)
      )
        return extrudedProfileMesh(
          shape.id,
          handle.profile,
          handle.distance,
          handle.transform ?? sketchPlaneTransform("XY"),
        );
      const bounds = handle.profile.bounds;
      const local =
        handle.profile.outerLoop.type === "circle"
          ? translateMesh(
              createCylinderMesh(
                shape.id,
                (bounds.maxX - bounds.minX) / 2,
                handle.distance,
              ),
              (bounds.minX + bounds.maxX) / 2,
              (bounds.minY + bounds.maxY) / 2,
              0,
            )
          : handle.profile.holes.length
            ? createPlateWithCircularHolesMesh(
                shape.id,
                bounds,
                handle.profile.holes,
                handle.distance,
              )
            : translateMesh(
                createBoxMesh(
                  shape.id,
                  bounds.maxX - bounds.minX,
                  bounds.maxY - bounds.minY,
                  handle.distance,
                ),
                (bounds.minX + bounds.maxX) / 2,
                (bounds.minY + bounds.maxY) / 2,
                0,
              );
      return transformProfileMesh(
        local,
        handle.transform ?? sketchPlaneTransform("XY"),
      );
    }
    if (handle.kind === "revolve") {
      if (
        handle.axis.type !== "origin" ||
        handle.axis.axis !== "Y" ||
        handle.profile.outerLoop.type !== "polygon" ||
        !handle.profile.alternateIds?.some((id) =>
          id.endsWith(":profile:rectangle"),
        ) ||
        JSON.stringify(handle.transform ?? sketchPlaneTransform("XY")) !==
          JSON.stringify(sketchPlaneTransform("XY"))
      ) {
        throw new Error(
          "Revolve fallback supports only rectangular profiles in XY around the origin Y axis. Initialize OpenCascade for other profiles, planes, or axes.",
        );
      }
      if (Math.abs(handle.angle - Math.PI * 2) > 1e-6) {
        throw new Error(
          "Revolve fallback currently supports full 360 degree revolves.",
        );
      }
      if (handle.profile.bounds.minX < -BOOLEAN_FALLBACK_EPSILON) {
        throw new Error("Revolve profile crosses the selected axis.");
      }
      return createCylinderAroundYMesh(
        shape.id,
        handle.profile.bounds.maxX,
        handle.profile.bounds.minY,
        handle.profile.bounds.maxY,
        48,
        Math.max(0, handle.profile.bounds.minX),
      );
    }
    if (handle.kind === "boolean" && handle.operation === "cut") {
      const fallback = fallbackCut(handle.base, handle.tool);
      if (fallback)
        return this.tessellateFallback(
          { ...shape, kernelHandle: fallback },
          _options,
        );
    }
    throw new Error("Unsupported kernel shape.");
  }

  exportStl(shape: KernelShape): ArrayBuffer {
    const mesh = this.tessellate(shape, {
      linearDeflection: 0.5,
      angularDeflection: 0.2,
    });
    return exportMeshesToStl([mesh]);
  }

  createCylinder(radius: number, height: number): RenderMesh {
    return createCylinderMesh(createId("body"), radius, height);
  }

  disposeShape(shape: KernelShape): void {
    const handle = shape.kernelHandle as KernelHandle;
    if (handle.occtShape) this.assertions.delete(handle.occtShape);
    deleteOcct(handle.occtShape);
    handle.occtShape = undefined;
  }

  private createOcctBox(
    minX: number,
    minY: number,
    minZ: number,
    width: number,
    height: number,
    depth: number,
  ): unknown | undefined {
    const oc = OpenCascadeKernel.openCascade;
    if (!oc) return undefined;
    return withDisposableScope((scope) => {
      const point = scope.use(new oc.gp_Pnt_3(minX, minY, minZ));
      const box = scope.use(
        new oc.BRepPrimAPI_MakeBox_2(point, width, height, depth),
      );
      return box.Shape();
    });
  }

  private createOcctFace(
    profile: SketchProfile,
    transform: SketchPlaneTransform,
    scope: DisposableScope,
  ): any {
    const oc = OpenCascadeKernel.openCascade!;
    const pnt = (p: { x: number; y: number }) => {
      const w = transformPoint(transform, p.x, p.y);
      return scope.use(new oc.gp_Pnt_3(w.x, w.y, w.z));
    };
    const makeWire = (loop: SketchProfile["outerLoop"], clockwise: boolean) => {
      const builder = scope.use(new oc.BRepBuilderAPI_MakeWire_1());
      if (loop.type === "circle") {
        const hole = profile.holes.find((h) => loop.entityIds.includes(h.id));
        if (loop !== profile.outerLoop && !hole)
          throw new Error(
            "Inner circle profile is missing its center and radius geometry.",
          );
        const radius =
          hole?.radius ?? (profile.bounds.maxX - profile.bounds.minX) / 2;
        const center = hole ?? {
          x: (profile.bounds.minX + profile.bounds.maxX) / 2,
          y: (profile.bounds.minY + profile.bounds.maxY) / 2,
        };
        const normal = scope.use(
          new oc.gp_Dir_4(
            transform.normal.x,
            transform.normal.y,
            transform.normal.z,
          ),
        );
        const axis = scope.use(new oc.gp_Ax2_3(pnt(center), normal));
        const circle = scope.use(new oc.gp_Circ_2(axis, radius));
        const edge = scope.use(new oc.BRepBuilderAPI_MakeEdge_8(circle));
        const shape = scope.use(edge.Edge());
        if (clockwise) shape.Reverse();
        builder.Add_1(shape);
      } else {
        for (const segment of orientedSegments(loop, clockwise)) {
          let edge;
          if (segment.type === "line")
            edge = scope.use(
              new oc.BRepBuilderAPI_MakeEdge_3(
                pnt(segment.start),
                pnt(segment.end),
              ),
            );
          else {
            const normal = scope.use(
              new oc.gp_Dir_4(
                transform.normal.x,
                transform.normal.y,
                transform.normal.z,
              ),
            );
            const u = scope.use(
              new oc.gp_Dir_4(transform.u.x, transform.u.y, transform.u.z),
            );
            const axis = scope.use(
              new oc.gp_Ax2_2(pnt(segment.center), normal, u),
            );
            const circle = scope.use(new oc.gp_Circ_2(axis, segment.radius));
            const first =
              segment.sweep > 0
                ? segment.startAngle
                : segment.startAngle + segment.sweep;
            edge = scope.use(
              new oc.BRepBuilderAPI_MakeEdge_9(
                circle,
                first,
                first + Math.abs(segment.sweep),
              ),
            );
          }
          if (!edge.IsDone())
            throw new Error("OpenCascade could not construct a sketch edge.");
          const shape = scope.use(edge.Edge());
          if (segment.type === "arc" && segment.sweep < 0) shape.Reverse();
          builder.Add_1(shape);
        }
      }
      if (!builder.IsDone())
        throw new Error(
          "OpenCascade could not construct a closed sketch wire.",
        );
      return scope.use(builder.Wire());
    };
    const outer = makeWire(profile.outerLoop, false);
    const face = scope.use(new oc.BRepBuilderAPI_MakeFace_15(outer, true));
    for (const inner of profile.innerLoops) face.Add(makeWire(inner, true));
    if (!face.IsDone())
      throw new Error("OpenCascade could not construct a planar sketch face.");
    return scope.use(face.Face());
  }

  private createOcctExtrusion(
    profile: SketchProfile,
    distance: number,
    transform = sketchPlaneTransform("XY"),
  ): unknown | undefined {
    const oc = OpenCascadeKernel.openCascade;
    if (!oc) return undefined;
    return withDisposableScope((scope) => {
      const face = this.createOcctFace(profile, transform, scope);
      const vector = sketchVectorToWorld(transform, 0, 0, distance);
      const direction = scope.use(
        new oc.gp_Vec_4(vector.x, vector.y, vector.z),
      );
      const prism = scope.use(
        new oc.BRepPrimAPI_MakePrism_1(face, direction, false, true),
      );
      if (!prism.IsDone())
        throw new Error("OpenCascade sketch extrusion failed.");
      const result = scope.use(prism.Shape());
      this.measureNative(result);
      return scope.release(result);
    });
  }

  private createOcctRevolve(
    profile: SketchProfile,
    angle: number,
    transform: SketchPlaneTransform,
    resolved: ResolvedRevolveAxis,
  ): unknown | undefined {
    const oc = OpenCascadeKernel.openCascade;
    if (!oc) return undefined;
    if (!resolved) throw new Error("Revolve axis could not be resolved.");
    return withDisposableScope((scope) => {
      const face = this.createOcctFace(profile, transform, scope);
      const origin = scope.use(
        new oc.gp_Pnt_3(
          resolved.origin.x,
          resolved.origin.y,
          resolved.origin.z,
        ),
      );
      const direction = scope.use(
        new oc.gp_Dir_4(
          resolved.direction.x,
          resolved.direction.y,
          resolved.direction.z,
        ),
      );
      const axis = scope.use(new oc.gp_Ax1_2(origin, direction));
      const builder = scope.use(
        new oc.BRepPrimAPI_MakeRevol_1(face, axis, angle, true),
      );
      if (!builder.IsDone())
        throw new Error(
          "OpenCascade revolve failed. Check the axis and profile.",
        );
      const result = scope.use(builder.Shape());
      this.measureNative(result);
      return scope.release(result);
    });
  }

  extrudeToFace(
    profile: SketchProfile,
    transform: SketchPlaneTransform,
    target: KernelShape,
    plane: SketchPlaneTransform,
  ): KernelShape {
    const oc = OpenCascadeKernel.openCascade;
    const owner = target.kernelHandle as KernelHandle;
    if (!oc || !owner.occtShape)
      throw new Error(
        "Extrude to face requires initialized OpenCascade geometry.",
      );
    if (owner.kind !== "extrusion")
      throw new Error(
        "To-face reference requires repair: its owner body was modified.",
      );
    const denominator = dot(plane.normal, transform.normal);
    if (Math.abs(denominator) < 1e-9)
      throw new Error(
        "Extrude to face failed: the target face is parallel to the extrusion direction.",
      );
    const bounds = profile.bounds;
    const constant =
      dot(subtract(plane.origin, transform.origin), plane.normal) / denominator;
    const extents = linearProfileExtents(
      profile,
      -dot(transform.u, plane.normal) / denominator,
      -dot(transform.v, plane.normal) / denominator,
    );
    const minimum = constant + extents.min,
      maximum = constant + extents.max;
    if (minimum <= BOOLEAN_FALLBACK_EPSILON)
      throw new Error(
        "Extrude to face requires the entire profile to lie before the target in the positive extrusion direction.",
      );
    return withDisposableScope((scope) => {
      const faces = planarFaces(oc, owner.occtShape, plane, scope);
      if (faces.length !== 1)
        throw new Error(
          "To-face reference was lost or is ambiguous. Reselect an unmodified planar face.",
        );
      const raw = this.createOcctExtrusion(
        profile,
        maximum + BOOLEAN_FALLBACK_EPSILON * 10,
        transform,
      );
      scope.use(raw as DisposableHandle);
      // A boundary point is guaranteed to lie on the retained side of the plane.
      const local =
        profile.outerLoop.type === "circle"
          ? { x: bounds.maxX, y: (bounds.minY + bounds.maxY) / 2 }
          : orientedSegments(profile.outerLoop, false)[0].start;
      const p = transformPoint(transform, local.x, local.y);
      const inside = scope.use(new oc.gp_Pnt_3(p.x, p.y, p.z));
      const planeOrigin = scope.use(
        new oc.gp_Pnt_3(plane.origin.x, plane.origin.y, plane.origin.z),
      );
      const planeNormal = scope.use(
        new oc.gp_Dir_4(plane.normal.x, plane.normal.y, plane.normal.z),
      );
      const nativePlane = scope.use(new oc.gp_Pln_3(planeOrigin, planeNormal));
      const infiniteBuilder = scope.use(
        new oc.BRepBuilderAPI_MakeFace_3(nativePlane),
      );
      const infiniteFace = scope.use(infiniteBuilder.Face());
      const halfSpace = scope.use(
        new oc.BRepPrimAPI_MakeHalfSpace_1(infiniteFace, inside),
      );
      const solid = scope.use(halfSpace.Solid());
      const trim = scope.use(new oc.BRepAlgoAPI_Common_3(raw, solid));
      if (!trim.IsDone())
        throw new Error(
          "OpenCascade could not terminate the extrusion on the target face.",
        );
      const result = scope.use(trim.Shape());
      this.measureNative(result);
      const caps = planarFaces(oc, result, plane, scope);
      if (!caps.length)
        throw new Error("Extrude did not reach the selected face.");
      const sourceFace = this.createOcctFace(profile, transform, scope);
      const expectedArea =
        surfaceArea(oc, sourceFace, scope) / Math.abs(denominator);
      const capArea = caps.reduce(
        (sum, cap) => sum + surfaceArea(oc, cap, scope),
        0,
      );
      if (
        Math.abs(capArea - expectedArea) > Math.max(1e-7, expectedArea * 1e-8)
      )
        throw new Error(
          "Extrude profile extends outside the finite target face or crosses a face hole. Reselect a covering planar face.",
        );
      for (const cap of caps) {
        const common = scope.use(new oc.BRepAlgoAPI_Common_3(cap, faces[0]));
        if (!common.IsDone())
          throw new Error("Could not verify the finite target face boundary.");
        const shared = scope.use(common.Shape());
        const area = surfaceArea(oc, cap, scope);
        if (area - surfaceArea(oc, shared, scope) > Math.max(1e-7, area * 1e-8))
          throw new Error(
            "Extrude profile extends outside the finite target face or crosses a face hole. Reselect a covering planar face.",
          );
      }
      return {
        id: createId("shape"),
        kernelHandle: {
          kind: "toFace",
          base: owner,
          occtShape: scope.release(result),
        } satisfies KernelHandle,
      };
    });
  }

  private createOcctCylinder(
    x: number,
    y: number,
    radius: number,
    height: number,
    z = 0,
  ): unknown | undefined {
    const oc = OpenCascadeKernel.openCascade;
    if (!oc) return undefined;
    return withDisposableScope((scope) => {
      const point = scope.use(new oc.gp_Pnt_3(x, y, z));
      const direction = scope.use(new oc.gp_Dir_4(0, 0, 1));
      const axis = scope.use(new oc.gp_Ax2_3(point, direction));
      const cylinder = scope.use(
        new oc.BRepPrimAPI_MakeCylinder_3(axis, radius, height),
      );
      return cylinder.Shape();
    });
  }

  private tessellateOcctShape(
    bodyId: string,
    shape: unknown | undefined,
    options: TessellationOptions,
  ): RenderMesh | undefined {
    const oc = OpenCascadeKernel.openCascade;
    if (!oc || !shape) return undefined;

    const mesh = new oc.BRepMesh_IncrementalMesh_2(
      shape,
      options.linearDeflection,
      false,
      options.angularDeflection,
      false,
    );
    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
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
            const placement = location.Transformation();
            try {
              assertMeshBudget(
                positions.length / 3 + triangulation.NbNodes(),
                indices.length / 3 + triangulation.NbTriangles(),
              );
              const offset = positions.length / 3;
              for (
                let index = 1;
                index <= triangulation.NbNodes();
                index += 1
              ) {
                const point = triangulation.Node(index);
                try {
                  point.Transform(placement);
                  positions.push(point.X(), point.Y(), point.Z());
                } finally {
                  deleteOcct(point);
                }
              }
              const orientation = face.Orientation_1();
              let reversed: boolean;
              try {
                reversed =
                  orientation.value ===
                  oc.TopAbs_Orientation.TopAbs_REVERSED.value;
              } finally {
                deleteOcct(orientation);
              }
              for (
                let index = 1;
                index <= triangulation.NbTriangles();
                index++
              ) {
                const triangle = triangulation.Triangle(index);
                try {
                  const a = offset + triangle.Value(1) - 1,
                    b = offset + triangle.Value(2) - 1,
                    c = offset + triangle.Value(3) - 1;
                  indices.push(...(reversed ? [a, c, b] : [a, b, c]));
                } finally {
                  deleteOcct(triangle);
                }
              }
            } finally {
              deleteOcct(placement);
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
  const disposable = value as
    { delete?: () => void; isDeleted?: () => boolean } | undefined;
  if (!disposable?.delete) return;
  if (disposable.isDeleted?.()) return;
  disposable.delete();
}

function translateMesh(
  mesh: RenderMesh,
  x: number,
  y: number,
  z: number,
): RenderMesh {
  if (
    Math.abs(x) <= BOOLEAN_FALLBACK_EPSILON &&
    Math.abs(y) <= BOOLEAN_FALLBACK_EPSILON &&
    Math.abs(z) <= BOOLEAN_FALLBACK_EPSILON
  )
    return mesh;
  const positions = ArrayBuffer.isView(mesh.positions)
    ? new Float32Array(mesh.positions)
    : Array.from(mesh.positions);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] += x;
    positions[index + 1] += y;
    positions[index + 2] += z;
  }
  return {
    ...mesh,
    positions,
    bounds: {
      min: [
        mesh.bounds.min[0] + x,
        mesh.bounds.min[1] + y,
        mesh.bounds.min[2] + z,
      ],
      max: [
        mesh.bounds.max[0] + x,
        mesh.bounds.max[1] + y,
        mesh.bounds.max[2] + z,
      ],
    },
  };
}

function boundsFromPositions(positions: number[]): {
  min: [number, number, number];
  max: [number, number, number];
} {
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
