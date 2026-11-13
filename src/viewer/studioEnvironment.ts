import * as THREE from "three";
import type { StudioEnvironment } from "../state/viewerState";

type Softbox = readonly [direction: readonly [number, number, number], width: number, intensity: number, color: readonly [number, number, number]];

const softboxes: Record<StudioEnvironment, readonly Softbox[]> = {
  softbox: [
    [[-.5, -.8, 1], .3, 6, [1, .95, .88]],
    [[.7, .6, .7], .23, 3, [.76, .87, 1]],
    [[.8, -.3, .05], .32, 1.4, [1, 1, 1]],
  ],
  rim: [
    [[-.9, .3, .6], .17, 9, [.84, .92, 1]],
    [[.8, .6, .85], .2, 7, [1, .88, .74]],
    [[.2, -.7, .9], .38, 1.2, [1, 1, 1]],
  ],
  workshop: [
    [[-.65, -.7, .95], .42, 5, [1, .82, .62]],
    [[.3, .8, .95], .34, 2.8, [.65, .8, 1]],
    [[.9, -.1, .4], .22, 2, [1, .94, .81]],
  ],
};

/** Linear HDR light probes generated locally from broad light sources. */
export function createStudioEnvironment(preset: StudioEnvironment): THREE.DataTexture {
  const width = 256, height = 128;
  const pixels = new Uint16Array(width * height * 4);
  const lights = softboxes[preset].map(([direction, spread, intensity, color]) => ({
    axis: new THREE.Vector3(...direction).normalize(), spread, intensity, color,
  }));
  for (let row = 0; row < height; row++) {
    const latitude = ((row + .5) / height - .5) * Math.PI;
    const y = Math.sin(latitude), radial = Math.cos(latitude);
    for (let column = 0; column < width; column++) {
      const longitude = ((column + .5) / width - .5) * 2 * Math.PI;
      const x = radial * Math.cos(longitude), z = radial * Math.sin(longitude);
      const base = .07 + .17 * Math.max(0, z);
      let red = base, green = base, blue = base;
      for (const { axis, spread, intensity, color } of lights) {
        const cosine = axis.x * x + axis.y * y + axis.z * z;
        const energy = intensity * Math.exp((cosine - 1) / (spread * spread));
        red += energy * color[0]; green += energy * color[1]; blue += energy * color[2];
      }
      const index = (row * width + column) * 4;
      pixels[index] = THREE.DataUtils.toHalfFloat(red);
      pixels[index + 1] = THREE.DataUtils.toHalfFloat(green);
      pixels[index + 2] = THREE.DataUtils.toHalfFloat(blue);
      pixels[index + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
