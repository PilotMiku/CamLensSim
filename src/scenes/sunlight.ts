import * as THREE from 'three';
import { createSolarBackground } from './solarBackground';
import { createSolarDisc } from './solarDisc';
import { SOLAR_ANGULAR_RADIUS } from '../optics/sun';

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

/** Independent solar model, lighting/shadow source and sampled path emitter share one sun. */
export function addVisibleSun(scene: THREE.Scene, sun: THREE.DirectionalLight, distance: number) {
  sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false);
  const target = new THREE.Vector3().setFromMatrixPosition(sun.target.matrixWorld);
  const direction = new THREE.Vector3().setFromMatrixPosition(sun.matrixWorld).sub(target).normalize();
  if (direction.lengthSq() === 0) direction.set(0, 1, 0);
  const group = new THREE.Group();
  group.name = 'visible-sun';
  group.userData.lightSourceId = sun.uuid;
  group.userData.angularRadius = SOLAR_ANGULAR_RADIUS;
  group.position.copy(direction).multiplyScalar(distance).add(target);
  group.lookAt(target);
  // Keep sky rendering separate; the independently rendered disc owns all direct
  // solar appearance. The lighting environment never contains the solar disk.
  const background = createSolarBackground(scene, sun, false);
  if (background) group.add(background);
  group.add(createSolarDisc(sun));
  scene.add(group);
  return group;
}
