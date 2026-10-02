// Read-only development diagnostics used by browser acceptance tests. No runtime
// geometry, camera, or store mutation is exposed to the browser tests here.
export interface ViewerSnapshot {
  cameraUp: number[];
  cameraTarget: number[];
  measurementLine: number[];
  gridNormal: number[];
  meshes: Array<{ bodyId: string; visible: boolean; positions: number[]; indices: number[] }>;
  sketchPoints: Array<{ id: string; position: number[] }>;
  sketchCircles: Array<{ id: string; normal: number[] }>;
}

let inspect: (() => ViewerSnapshot) | undefined;

export function registerViewerDiagnostics(reader: () => ViewerSnapshot): () => void {
  inspect = reader;
  return () => { if (inspect === reader) inspect = undefined; };
}

export function inspectViewer(): ViewerSnapshot | undefined {
  return inspect?.();
}
