import type * as THREE from "three";
import type { StudioEffectsSettings } from "./studioEffects";

type StudioEffects = ReturnType<typeof import("./studioEffects").createStudioEffects>;

export function createStudioEffectsController(renderer: THREE.WebGLRenderer, scene: THREE.Scene, model: THREE.Group, invalidate: () => void) {
  let effects: StudioEffects | undefined;
  let pending: Promise<void> | undefined;
  let disposed = false;
  let unavailable = false;

  function prepare() {
    pending ??= import("./studioEffects").then(({ createStudioEffects }) => {
      if (!disposed) {
        effects = createStudioEffects();
        invalidate();
      }
    }).catch(error => {
      if (!disposed) {
        unavailable = true;
        console.warn("Studio effects could not load.", error);
      }
    });
    return pending;
  }
  const enabled = (settings?: StudioEffectsSettings) =>
    Boolean(settings && (settings.ambientOcclusion || settings.groundShadow));

  return {
    async ready(settings?: StudioEffectsSettings) {
      if (!enabled(settings)) return;
      await prepare();
      if (!effects && !disposed) throw new Error("Studio effects are unavailable. Turn off the effects or reload before exporting PNG.");
    },
    draw(camera: THREE.PerspectiveCamera, settings?: StudioEffectsSettings, section?: THREE.Plane, strict = false) {
      if (strict && enabled(settings) && !effects)
        throw new Error("Studio effects are unavailable. Turn off the effects or reload before exporting PNG.");
      if (settings && enabled(settings) && !unavailable) {
        if (effects) {
          try {
            effects.render(renderer, scene, camera, model, settings, section);
            return;
          } catch (error) {
            unavailable = true;
            effects.dispose();
            effects = undefined;
            console.warn("Studio effects could not render.", error);
            if (strict) throw new Error("Studio effects could not render. Turn them off or choose a smaller PNG size.");
          }
        } else void prepare();
      }
      effects?.skip();
      renderer.render(scene, camera);
    },
    contextRestored() {
      effects?.contextRestored();
      if (unavailable) {
        pending = undefined;
        unavailable = false;
      }
    },
    inspect() { return effects?.inspect(); },
    dispose() {
      disposed = true;
      effects?.dispose();
      effects = undefined;
    },
  };
}
