import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createStudioEffects, occlusionBufferSize } from "../viewer/studioEffects";

function setup() {
  const scene = new THREE.Scene(), model = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  const geometry = new THREE.BoxGeometry(2, 4, 6), material = new THREE.MeshStandardMaterial();
  const solid = new THREE.Mesh(geometry, material);
  scene.add(model);
  model.add(solid);
  const target = new THREE.WebGLRenderTarget();
  const color = new THREE.Color("#123456");
  let currentTarget: THREE.WebGLRenderTarget | null = target;
  let currentColor = color.clone();
  let currentAlpha = .25;
  const mock = {
    autoClear: true,
    debug: { onShaderError: null },
    info: { autoReset: true, reset: vi.fn(), render: { calls: 0, triangles: 0 } },
    getClearAlpha: () => currentAlpha,
    getClearColor: (out: THREE.Color) => out.copy(currentColor),
    getRenderTarget: () => currentTarget,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(1920, 1080),
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { currentTarget = next; },
    setClearColor: (value: THREE.ColorRepresentation, alpha: number) => { currentColor.set(value); currentAlpha = alpha; },
    render: vi.fn(),
  };
  const effects = createStudioEffects();
  return { scene, model, camera, solid, geometry, material, effects, mock, target, color, renderer: mock as unknown as THREE.WebGLRenderer };
}

describe("studio effects", () => {
  it("caps occlusion buffers at half resolution and 720 pixels on the longest side", () => {
    expect(occlusionBufferSize(1200, 600)).toEqual([600, 300]);
    expect(occlusionBufferSize(4096, 2048)).toEqual([720, 360]);
    expect(occlusionBufferSize(800, 1600)).toEqual([360, 720]);
    expect(occlusionBufferSize(1, 1)).toEqual([1, 1]);
  });

  it("reuses shadow projection across camera changes and occlusion for unchanged views", () => {
    const { effects, renderer, scene, camera, model, solid, mock, geometry, material } = setup();
    const releaseGeometry = vi.spyOn(geometry, "dispose");
    const settings = { ambientOcclusion: true, groundShadow: true };
    effects.render(renderer, scene, camera, model, settings);
    expect(effects.inspect()).toMatchObject({ shadowRenders: 1, occlusionRenders: 1, occlusionWidth: 720, occlusionHeight: 405 });
    expect(mock.render).toHaveBeenCalledTimes(8);
    effects.render(renderer, scene, camera, model, settings);
    expect(mock.render).toHaveBeenCalledTimes(11);
    camera.position.x = 5;
    effects.render(renderer, scene, camera, model, settings);
    expect(effects.inspect()).toMatchObject({ shadowRenders: 1, occlusionRenders: 2 });
    effects.render(renderer, scene, camera, model, settings, new THREE.Plane(new THREE.Vector3(0, 0, 1), 1));
    expect(effects.inspect()).toMatchObject({ shadowRenders: 2, occlusionRenders: 3 });
    effects.contextRestored();
    effects.render(renderer, scene, camera, model, settings);
    expect(effects.inspect()).toMatchObject({ shadowRenders: 3, occlusionRenders: 4 });
    solid.visible = false;
    effects.render(renderer, scene, camera, model, settings);
    expect(effects.inspect()).toMatchObject({ ambientOcclusion: false, groundShadow: false, shadowRenders: 3, occlusionRenders: 4 });
    effects.dispose();
    expect(releaseGeometry).not.toHaveBeenCalled();
    expect(solid.material).toBe(material);
  });

  it("reports an effect shader error and restores the renderer's error callback", () => {
    const { effects, renderer, scene, camera, model, mock } = setup();
    const previous = vi.fn();
    renderer.debug.onShaderError = previous;
    mock.render.mockImplementationOnce(() => {
      const gl = { getProgramInfoLog: () => "Effects shader unavailable" } as unknown as WebGLRenderingContext;
      type Program = Parameters<NonNullable<typeof renderer.debug.onShaderError>>[1];
      renderer.debug.onShaderError?.(gl, {} as Program, {} as WebGLShader, {} as WebGLShader);
    });
    expect(() => effects.render(renderer, scene, camera, model, { ambientOcclusion: true, groundShadow: true })).toThrow("Effects shader unavailable");
    expect(renderer.debug.onShaderError).toBe(previous);
    expect(previous).not.toHaveBeenCalled();
    effects.dispose();
  });

  it("restores render state when an offscreen pass fails", () => {
    const { effects, renderer, scene, camera, model, mock, target, color } = setup();
    mock.autoClear = false;
    mock.render.mockImplementationOnce(() => { throw new Error("Render unavailable"); });
    expect(() => effects.render(renderer, scene, camera, model, { ambientOcclusion: true, groundShadow: true })).toThrow("Render unavailable");
    expect(mock.getRenderTarget()).toBe(target);
    expect(mock.getClearAlpha()).toBe(.25);
    expect(mock.getClearColor(new THREE.Color())).toEqual(color);
    expect(mock.autoClear).toBe(false);
    expect(mock.info.autoReset).toBe(true);
    effects.dispose();
  });
});
