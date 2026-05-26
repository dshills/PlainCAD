declare module "opencascade.js/dist/opencascade.wasm.js" {
  export default function initOpenCascadeModule(options?: {
    locateFile?: (path: string) => string;
    wasmBinary?: ArrayBuffer | Uint8Array;
  }): Promise<Record<string, any>>;
}
