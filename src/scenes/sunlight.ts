import * as THREE from 'three';
import { createSolarBackground } from './solarBackground';

/** Physical lamp source shared by surface illumination, shadows and airborne dust. */
export function addFixedBeam(scene: THREE.Scene, position: [number, number, number],
  target: [number, number, number], intensity: number, distance: number, angle = 0.22) {
  const light = new THREE.SpotLight('#ffe4ba', intensity, distance, angle, 0.45, 2);
  light.name = 'fixed-volumetric-key';
  light.position.set(...position); light.target.position.set(...target);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.1; light.shadow.camera.far = distance;
  light.shadow.bias = -0.00015; light.shadow.normalBias = 0.003;
  scene.add(light, light.target);
  return light;
}

/** The visible disc and glow share the actual directional light's direction. */
export function addVisibleSun(scene: THREE.Scene, sun: THREE.DirectionalLight, distance: number) {
  const direction = sun.position.clone().sub(sun.target.position).normalize();
  const group = new THREE.Group();
  group.name = 'visible-sun';
  group.position.copy(direction).multiplyScalar(distance).add(sun.target.position);
  group.lookAt(sun.target.position);
  const background = createSolarBackground(scene, sun);
  if (background) group.add(background);
  scene.add(group);
}
