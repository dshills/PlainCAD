import * as THREE from "three";

export interface StudioEffectsSettings {
  ambientOcclusion: boolean;
  groundShadow: boolean;
}

const SHADOW_SIZE = 256;
const MAX_OCCLUSION_EDGE = 720;

export function occlusionBufferSize(width: number, height: number): [number, number] {
  const scale = Math.min(.5, MAX_OCCLUSION_EDGE / Math.max(width, height));
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}

const screenVertex = /* glsl */ `
  varying vec2 screenUv;
  void main() {
    screenUv = uv;
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
  }
`;

const occlusionFragment = /* glsl */ `
  varying vec2 screenUv;
  uniform sampler2D normals;
  uniform sampler2D depth;
  uniform mat4 inverseProjection;
  uniform vec2 texel;
  uniform float radius;

  vec3 positionAt(vec2 uv, float z) {
    vec4 point = inverseProjection * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
    return point.xyz / point.w;
  }

  void main() {
    vec4 normalSample = texture2D(normals, screenUv);
    if (normalSample.a < 0.5) { gl_FragColor = vec4(0.0); return; }
    vec3 normal = normalize(normalSample.xyz * 2.0 - 1.0);
    vec3 center = positionAt(screenUv, texture2D(depth, screenUv).r);
    float pixelSize = max(0.000001, length(positionAt(screenUv + vec2(texel.x, 0.0), texture2D(depth, screenUv).r) - center));
    float pixelRadius = clamp(radius / pixelSize, 2.0, 22.0);
    float phase = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y) * 2.0, 4.0) * 0.18;
    float occlusion = 0.0;
    for (int i = 0; i < 12; i++) {
      float t = (float(i) + 0.5) / 12.0;
      float angle = float(i) * 2.399963 + phase;
      vec2 uv = screenUv + vec2(cos(angle), sin(angle)) * texel * pixelRadius * sqrt(t);
      if (texture2D(normals, uv).a < 0.5) continue;
      vec3 offset = positionAt(uv, texture2D(depth, uv).r) - center;
      float distanceToSample = length(offset);
      float horizon = dot(normal, offset) / max(0.000001, distanceToSample);
      occlusion += max(0.0, horizon - 0.12) * (1.0 - smoothstep(radius * 0.12, radius, distanceToSample));
    }
    gl_FragColor = vec4(min(occlusion * 0.105, 0.30), 0.0, 0.0, 1.0);
  }
`;

const occlusionOverlayFragment = /* glsl */ `
  varying vec2 screenUv;
  uniform sampler2D occlusion;
  uniform vec2 texel;

  void main() {
    vec4 center = texture2D(occlusion, screenUv);
    // Fade at the low-resolution silhouette to keep the background clean.
    float mask = smoothstep(0.65, 0.99, center.a);
    float opacity = center.r * 0.4;
    for (int i = 0; i < 4; i++) {
      float angle = float(i) * 1.570796;
      vec4 neighbor = texture2D(occlusion, screenUv + vec2(cos(angle), sin(angle)) * texel);
      opacity += neighbor.r * 0.15;
      mask *= smoothstep(0.40, 0.90, neighbor.a);
    }
    gl_FragColor = vec4(0.0, 0.0, 0.0, opacity * mask);
  }
`;

const shadowDirection = new THREE.Vector2(.28, .2);
const shadowVertex = /* glsl */ `
  uniform vec4 footprint;
  uniform float ground;
  uniform vec2 direction;
  varying vec3 worldPosition;
  void main() {
    worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vec2 projected = worldPosition.xy + direction * (worldPosition.z - ground);
    gl_Position = vec4((projected - footprint.xy) / footprint.zw * 2.0 - 1.0, 0.0, 1.0);
  }
`;
const shadowFragment = /* glsl */ `
  uniform vec4 clipPlane;
  varying vec3 worldPosition;
  void main() {
    if (dot(vec4(worldPosition, 1.0), clipPlane) < 0.0) discard;
    gl_FragColor = vec4(1.0);
  }
`;
const groundVertex = /* glsl */ `
  varying vec2 shadowUv;
  void main() {
    shadowUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const groundFragment = /* glsl */ `
  uniform sampler2D shadow;
  varying vec2 shadowUv;
  void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(shadow, shadowUv).r * 0.22);
  }
`;
const shadowBlurFragment = /* glsl */ `
  varying vec2 screenUv;
  uniform sampler2D source;
  uniform vec2 texelStep;
  void main() {
    float mask = 0.0;
    for (int i = -2; i <= 2; i++) {
      mask += texture2D(source, screenUv + float(i) * texelStep).r * (3.0 - abs(float(i)));
    }
    gl_FragColor = vec4(mask / 9.0, 0.0, 0.0, 1.0);
  }
`;

function material(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, transparent = false) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, transparent, depthWrite: false, depthTest: false, toneMapped: false,
    blending: transparent ? THREE.NormalBlending : THREE.NoBlending,
  });
}

function quad(geometry: THREE.PlaneGeometry, shader: THREE.ShaderMaterial) {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(geometry, shader);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return scene;
}

function target(width: number, height: number, depthTexture?: THREE.DepthTexture) {
  return new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: Boolean(depthTexture), depthTexture: depthTexture ?? null,
    minFilter: depthTexture ? THREE.NearestFilter : THREE.LinearFilter,
    magFilter: depthTexture ? THREE.NearestFilter : THREE.LinearFilter,
    generateMipmaps: false,
  });
}

function effectPass(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const previousHandler = renderer.debug.onShaderError;
  let failure: string | undefined;
  renderer.debug.onShaderError = (gl, program) => {
    failure = gl.getProgramInfoLog(program) || "Unable to compile a studio effects shader.";
  };
  try {
    renderer.render(scene, camera);
    if (failure) throw new Error(failure);
  } finally {
    renderer.debug.onShaderError = previousHandler;
  }
}

function shadowFootprint(bounds: THREE.Box3, ground: number) {
  // Casting direction has positive XY components. The padded footprint keeps
  // the whole blur inside the texture even when the model touches the ground.
  const minX = bounds.min.x + shadowDirection.x * (bounds.min.z - ground);
  const minY = bounds.min.y + shadowDirection.y * (bounds.min.z - ground);
  const maxX = bounds.max.x + shadowDirection.x * (bounds.max.z - ground);
  const maxY = bounds.max.y + shadowDirection.y * (bounds.max.z - ground);
  const padding = Math.max(maxX - minX, maxY - minY, .001) * .1;
  return new THREE.Vector4(minX - padding, minY - padding, maxX - minX + 2 * padding, maxY - minY + 2 * padding);
}

export function createStudioEffects() {
  const geometry = new THREE.PlaneGeometry();
  const offscreen = new THREE.Scene();
  const screenCamera = new THREE.Camera();
  const normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, blending: THREE.NoBlending });
  const normals = target(1, 1, new THREE.DepthTexture(1, 1, THREE.UnsignedIntType));
  const occlusion = target(1, 1);
  const shadow = target(SHADOW_SIZE, SHADOW_SIZE);
  const shadowBlur = target(SHADOW_SIZE, SHADOW_SIZE);
  const texel = new THREE.Vector2();
  const inverseProjection = new THREE.Matrix4();
  const footprint = new THREE.Vector4();
  const clipPlane = new THREE.Vector4();
  const occlusionUniforms = {
    normals: { value: normals.texture }, depth: { value: normals.depthTexture },
    texel: { value: texel }, inverseProjection: { value: inverseProjection }, radius: { value: 1 },
  };
  const aoShader = material(screenVertex, occlusionFragment, occlusionUniforms);
  const aoScene = quad(geometry, aoShader);
  const overlayShader = material(screenVertex, occlusionOverlayFragment, { texel: { value: texel }, occlusion: { value: occlusion.texture } }, true);
  const overlay = quad(geometry, overlayShader);
  const shadowUniforms = { footprint: { value: footprint }, ground: { value: 0 }, direction: { value: shadowDirection }, clipPlane: { value: clipPlane } };
  const shadowShader = material(shadowVertex, shadowFragment, shadowUniforms);
  shadowShader.side = THREE.DoubleSide;
  const blurUniforms = { source: { value: shadow.texture }, texelStep: { value: new THREE.Vector2() } };
  const shadowBlurShader = material(screenVertex, shadowBlurFragment, blurUniforms);
  const shadowBlurScene = quad(geometry, shadowBlurShader);
  const groundShader = material(groundVertex, groundFragment, { shadow: { value: shadow.texture } }, true);
  groundShader.depthTest = true;
  groundShader.side = THREE.DoubleSide;
  groundShader.forceSinglePass = true;
  const ground = new THREE.Mesh(geometry, groundShader);
  const groundScene = new THREE.Scene();
  groundScene.add(ground);

  const drawBuffer = new THREE.Vector2();
  const bounds = new THREE.Box3();
  const partBounds = new THREE.Box3();
  const size = new THREE.Vector3();
  const clearColor = new THREE.Color();
  const proxies: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
  let shadowKey: string | undefined;
  let occlusionKey: string | undefined;
  let shadowRenders = 0;
  let occlusionRenders = 0;
  let drawCalls = 0, triangles = 0;
  let active = { ambientOcclusion: false, groundShadow: false };

  const clearProxies = () => {
    for (const proxy of proxies) {
      offscreen.remove(proxy);
      // Source geometry is owned by ModelMeshes. The shared plane only serves
      // as an inert reference between frames, including after model disposal.
      proxy.geometry = geometry;
    }
  };
  const fillProxies = (model: THREE.Group, section?: THREE.Plane) => {
    bounds.makeEmpty();
    let count = 0;
    const shapeKey: string[] = [];
    model.updateWorldMatrix(true, true);
    model.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || object.material.transparent) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (!object.geometry.boundingBox || object.geometry.boundingBox.isEmpty()) return;
      const proxy = proxies[count] ?? new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geometry, normalMaterial);
      if (!proxies[count]) proxies.push(proxy);
      count++;
      proxy.geometry = object.geometry;
      proxy.frustumCulled = false;
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(object.matrixWorld);
      proxy.matrixWorldNeedsUpdate = true;
      offscreen.add(proxy);
      bounds.union(partBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));
      shapeKey.push(object.geometry.uuid, object.matrixWorld.elements.join(","));
    });
    // Keep the base renderer's clipping plane authoritative.
    normalMaterial.clippingPlanes = section ? [section] : [];
    if (section) clipPlane.set(section.normal.x, section.normal.y, section.normal.z, section.constant);
    else clipPlane.set(0, 0, 0, 1);
    return shapeKey.join("|") + "|" + clipPlane.toArray().join(",");
  };

  return {
    skip() {
      active = { ambientOcclusion: false, groundShadow: false };
      drawCalls = triangles = 0;
    },
    render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, model: THREE.Group, settings: StudioEffectsSettings, section?: THREE.Plane) {
      const shapeKey = fillProxies(model, section);
      active = bounds.isEmpty() ? { ambientOcclusion: false, groundShadow: false } : { ...settings };
      const previousAutoClear = renderer.autoClear;
      const previousAutoReset = renderer.info.autoReset;
      renderer.info.autoReset = false;
      renderer.info.reset();
      const previousAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clearColor);
      const previousTarget = renderer.getRenderTarget();
      const previousFace = renderer.getActiveCubeFace();
      const previousMip = renderer.getActiveMipmapLevel();
      try {
        if (active.groundShadow && shadowKey !== shapeKey) {
          const z = bounds.min.z - Math.max(bounds.getSize(size).length(), .001) * .0005;
          footprint.copy(shadowFootprint(bounds, z));
          shadowUniforms.ground.value = z;
          ground.position.set(footprint.x + footprint.z / 2, footprint.y + footprint.w / 2, z);
          ground.scale.set(footprint.z, footprint.w, 1);
          proxies.forEach(proxy => { proxy.material = shadowShader; });
          renderer.setRenderTarget(shadow);
          renderer.setClearColor(0, 0);
          renderer.autoClear = true;
          effectPass(renderer, offscreen, screenCamera);
          blurUniforms.source.value = shadow.texture;
          blurUniforms.texelStep.value.set(.01, 0);
          renderer.setRenderTarget(shadowBlur);
          effectPass(renderer, shadowBlurScene, screenCamera);
          blurUniforms.source.value = shadowBlur.texture;
          blurUniforms.texelStep.value.set(0, .01);
          renderer.setRenderTarget(shadow);
          effectPass(renderer, shadowBlurScene, screenCamera);
          shadowKey = shapeKey;
          shadowRenders++;
        }
        if (active.ambientOcclusion) {
          const dimensions = renderer.getDrawingBufferSize(drawBuffer);
          const [width, height] = occlusionBufferSize(dimensions.x, dimensions.y);
          camera.updateWorldMatrix(true, false);
          const key = [shapeKey, width, height, ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements].join("|");
          if (occlusionKey !== key) {
            normals.setSize(width, height);
            occlusion.setSize(width, height);
            texel.set(1 / width, 1 / height);
            inverseProjection.copy(camera.projectionMatrixInverse);
            // Radius follows the current view scale, including small parts in
            // assemblies, with a cap from the visible model's extent.
            occlusionUniforms.radius.value = Math.min(
              Math.max(bounds.getSize(size).length() * .08, .0001),
              Math.max(camera.position.distanceTo(bounds.getCenter(size)) * .07, .0001),
            );
            proxies.forEach(proxy => { proxy.material = normalMaterial; });
            renderer.setRenderTarget(normals);
            renderer.setClearColor(0, 0);
            renderer.autoClear = true;
            effectPass(renderer, offscreen, camera);
            renderer.setRenderTarget(occlusion);
            effectPass(renderer, aoScene, screenCamera);
            occlusionKey = key;
            occlusionRenders++;
          }
        }
        renderer.setRenderTarget(previousTarget, previousFace, previousMip);
        renderer.setClearColor(clearColor, previousAlpha);
        renderer.autoClear = previousAutoClear;
        renderer.render(scene, camera);
        renderer.autoClear = false;
        if (active.groundShadow) effectPass(renderer, groundScene, camera);
        if (active.ambientOcclusion) effectPass(renderer, overlay, screenCamera);
        drawCalls = renderer.info.render.calls;
        triangles = renderer.info.render.triangles;
      } finally {
        renderer.info.autoReset = previousAutoReset;
        renderer.setRenderTarget(previousTarget, previousFace, previousMip);
        renderer.setClearColor(clearColor, previousAlpha);
        renderer.autoClear = previousAutoClear;
        clearProxies();
      }
    },
    contextRestored() { shadowKey = occlusionKey = undefined; },
    inspect() {
      return { ...active, shadowRenders, occlusionRenders, drawCalls, triangles, occlusionWidth: normals.width, occlusionHeight: normals.height };
    },
    dispose() {
      clearProxies();
      geometry.dispose();
      normalMaterial.dispose();
      aoShader.dispose();
      overlayShader.dispose();
      shadowShader.dispose();
      shadowBlurShader.dispose();
      groundShader.dispose();
      normals.dispose();
      occlusion.dispose();
      shadow.dispose();
      shadowBlur.dispose();
    },
  };
}
