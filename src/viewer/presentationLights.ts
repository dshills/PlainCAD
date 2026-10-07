import * as THREE from "three";
import type { PresentationMode } from "../state/viewerState";

/** Cheap fixed studio lighting: no shadow maps, textures or additional passes. */
export function createPresentationLights(scene: THREE.Scene) {
  const ambient = new THREE.HemisphereLight("#ffffff", "#a8b0ad", 2.6);
  const key = new THREE.DirectionalLight("#ffffff", 2);
  const fill = new THREE.DirectionalLight("#c8dfff", 0);
  const rim = new THREE.DirectionalLight("#fff2db", 0);
  key.position.set(80, -80, 120);
  fill.position.set(-100, -30, 55);
  rim.position.set(45, 100, 90);
  scene.add(ambient, key, fill, rim);
  return {
    setMode(mode: PresentationMode) {
      ambient.intensity = mode === "render" ? 1.7 : 2.6;
      key.intensity = mode === "render" ? 3.1 : 2;
      fill.intensity = mode === "render" ? 1.2 : 0;
      rim.intensity = mode === "render" ? 2 : 0;
      // Zero-intensity directional lights are still considered by Three.js;
      // visibility excludes the inactive lights from the Model shader.
      fill.visible = rim.visible = mode === "render";
    },
  };
}
