import { expect, it, vi } from "vitest";
import { measureNativeBores } from "../cad/kernel/nativeDrawing";
import { getDisposableScopeMetrics } from "../cad/kernel/disposableScope";
interface Face { cylinder: boolean; reversed: boolean; handedness: 1 | -1; trimmed?: boolean; radius?: number }
function fakeKernel(faces: Face[]) {
  const deleted = vi.fn(), handle = <T extends object>(value: T) => ({ ...value, delete: deleted });
  class Vector { values: number[]; constructor(x: number, y: number, z: number) { this.values = [x, y, z]; } X() { return this.values[0]; } Y() { return this.values[1]; } Z() { return this.values[2]; } delete = deleted; }
  class Surface { data: Face; constructor(face: { data: Face }) { this.data = face.data; } delete = deleted;
    GetType() { return { value: this.data.cylinder ? 1 : 0 }; }
    FirstUParameter() { return 0; } LastUParameter() { return 2 * Math.PI; } FirstVParameter() { return 0; } LastVParameter() { return 5; }
    Cylinder() { return handle({ Radius: () => this.data.radius ?? 1, Axis: () => handle({ Direction: () => new Vector(0, 0, 1), Location: () => new Vector(3, 4, 7) }) }); }
    D1(_u: number, _v: number, p: Vector, du: Vector, dv: Vector) { const radius = this.data.radius ?? 1; p.values = [3 + radius, 4, 9.5]; du.values = [0, radius * this.data.handedness, 0]; dv.values = [0, 0, 1]; }
  }
  const oc = { TopAbs_ShapeEnum: { TopAbs_FACE: 1, TopAbs_SHAPE: 0 }, TopAbs_Orientation: { TopAbs_FORWARD: { value: 0 }, TopAbs_REVERSED: { value: 1 } }, GeomAbs_SurfaceType: { GeomAbs_Cylinder: { value: 1 } },
    TopExp_Explorer_2: class { index = 0; More() { return this.index < faces.length; } Next() { this.index++; } Current() { return handle({ data: faces[this.index] }); } delete = deleted; },
    TopoDS: { Face_1: (current: { data: Face }) => handle({ data: current.data, Orientation_1: () => handle({ value: current.data.reversed ? 1 : 0 }) }) },
    BRepAdaptor_Surface_2: Surface, gp_Pnt_3: Vector, gp_Vec_4: Vector,
    GProp_GProps_1: class { mass = 0; Mass() { return this.mass; } delete = deleted; },
    BRepGProp: { SurfaceProperties_1: (face: { data: Face }, props: { mass: number }) => { props.mass = 2 * Math.PI * (face.data.radius ?? 1) * 5 * (face.data.trimmed ? 0.75 : 1); } },
  }; return { oc, deleted };
}
it("classifies inward cylinders from derivatives and topology, including reversed native drilling", () => {
  const { oc } = fakeKernel([{ cylinder: true, reversed: true, handedness: 1 }, { cylinder: true, reversed: false, handedness: -1 }, { cylinder: true, reversed: false, handedness: 1 }]);
  const result = measureNativeBores(oc, {}); expect(result.bores).toHaveLength(2); expect(result.bores[0]).toEqual({ diameter: 2, length: 5, direction: [0, 0, 1], start: [3, 4, 7] }); expect(result.warnings).toEqual([]);
});
it("omits trimmed cylindrical walls with an actionable warning and disposes on failures", () => {
  const { oc } = fakeKernel([{ cylinder: true, reversed: true, handedness: 1, trimmed: true }]); const result = measureNativeBores(oc, {}); expect(result.bores).toEqual([]); expect(result.warnings[0]).toMatch(/Trimmed/);
  const before = getDisposableScopeMetrics(), invalid = fakeKernel([{ cylinder: true, reversed: true, handedness: 1, radius: NaN }]); expect(() => measureNativeBores(invalid.oc, {})).toThrow(/invalid/); const after = getDisposableScopeMetrics(); expect(after.registered - before.registered).toBe(after.disposed - before.disposed); expect(after.failures).toBe(before.failures);
});
it("enforces a native-face inspection limit without retaining disposable handles", () => {
  const { oc } = fakeKernel(Array.from({ length: 4097 }, () => ({ cylinder: false, reversed: false, handedness: 1 as const }))), before = getDisposableScopeMetrics(); expect(() => measureNativeBores(oc, {})).toThrow(/4096/); const after = getDisposableScopeMetrics(); expect(after.registered - before.registered).toBe(after.disposed - before.disposed);
});
