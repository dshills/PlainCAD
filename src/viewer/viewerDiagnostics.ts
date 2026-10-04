// Read-only development diagnostics used by browser acceptance tests. No runtime
// geometry, camera, or store mutation is exposed to the browser tests here.
export interface ViewerSnapshot {
  background: string;
  resources: { geometries: number; textures: number; programs: number };
  cameraUp: number[];
  cameraPosition: number[];
  sectionPlane?: { normal: number[]; constant: number };
  cameraTarget: number[];
  measurementLine: number[];
  gridNormal: number[];
  meshes: Array<{ bodyId: string; visible: boolean; clippingEnabled: boolean; positions: number[]; indices: number[] }>;
  sketchPoints: Array<{ id: string; position: number[] }>;
  sketchCircles: Array<{ id: string; normal: number[] }>;
}

let project: ((point: [number,number,number]) => {x:number;y:number;depth:number}) | undefined;

let inspect: (() => ViewerSnapshot) | undefined;

export function registerViewerDiagnostics(reader: () => ViewerSnapshot, projector: NonNullable<typeof project>): () => void {
  inspect = reader;
  project = projector;
  return () => { if (inspect === reader) { inspect = undefined; project = undefined; } };
}

export function inspectViewer(): ViewerSnapshot | undefined {
  return inspect?.();
}

export function projectViewerPoint(point: [number,number,number]) { return point.every(Number.isFinite) ? project?.(point) : undefined; }
