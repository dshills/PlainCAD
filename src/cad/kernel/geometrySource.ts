export type NativeGeometrySource = "opencascade" | "plainsolid";
export type GeometrySource = NativeGeometrySource | "fallback";

export function isNativeGeometrySource(source: unknown): source is NativeGeometrySource {
  return source === "opencascade" || source === "plainsolid";
}
