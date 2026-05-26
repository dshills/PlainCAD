import { RenderMesh } from "./KernelAdapter";
import { meshToAsciiStl } from "./meshConversion";

export function exportMeshesToStl(meshes: RenderMesh[], name = "PlainCAD"): ArrayBuffer {
  const text = meshes.map((mesh, index) => meshToAsciiStl(mesh, `${name}_${index + 1}`)).join("\n");
  return new TextEncoder().encode(text).buffer;
}
