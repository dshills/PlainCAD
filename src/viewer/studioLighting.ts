import * as THREE from "three";
import type { PresentationMode, StudioLighting } from "../state/viewerState";

export function createStudioLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, invalidate: () => void) {
  let current: StudioLighting | undefined;
  let texture: THREE.DataTexture | undefined;
  let texturePreset: StudioLighting["environment"] | undefined;
  let disposed = false;
  let factory: typeof import("./studioEnvironment").createStudioEnvironment | undefined;
  let pending: Promise<void> | undefined;
  let loading = false;

  const applyEnvironment = () => {
    if (!current || !factory || disposed) return;
    if (texturePreset !== current.environment) {
      const next = factory(current.environment);
      texture?.dispose();
      texture = next;
      texturePreset = current.environment;
    }
    scene.environment = texture ?? null;
    scene.environmentRotation.set(0, 0, THREE.MathUtils.degToRad(current.rotation));
  };

  return {
    apply(mode: PresentationMode, settings: StudioLighting) {
      current = mode === "render" ? settings : undefined;
      renderer.toneMapping = current ? THREE.NeutralToneMapping : THREE.NoToneMapping;
      renderer.toneMappingExposure = current ? 2 ** current.exposure : 1;
      if (!current) {
        scene.environment = null;
        return;
      }
      if (factory) applyEnvironment();
      else if (!pending) {
        loading = true;
        pending = import("./studioEnvironment").then(module => {
          factory = module.createStudioEnvironment;
          applyEnvironment();
        }).catch(error => {
          if (!disposed) console.warn("Studio environment could not load. Direct lights remain available.", error);
        }).finally(() => {
          loading = false;
          if (!disposed) invalidate();
        });
      }
    },
    isLoading: () => Boolean(current && loading),
    async ready() {
      await pending;
      if (current && !scene.environment)
        throw new Error("Studio lighting is unavailable. Reload the view or switch to Model view before exporting PNG.");
    },
    inspect() {
      return { ...current, ready: Boolean(scene.environment), toneMapped: renderer.toneMapping !== THREE.NoToneMapping };
    },
    dispose() {
      disposed = true;
      scene.environment = null;
      texture?.dispose();
    },
  };
}
