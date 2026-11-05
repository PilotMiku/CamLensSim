import * as THREE from 'three';
import { createModeling, type Point } from './modeling';
import { addFixedBeam } from './sunlight';

const DOWN = new THREE.Vector3(0, -1, 0);

/** A real, open-bottom metal shade. Its emitter sits above the light's origin. */
function addLampHead(parent: THREE.Group, position: Point, target: Point, name: string) {
  const head = new THREE.Group();
  head.name = `${name}-head`;
  head.position.set(...position);
  head.quaternion.setFromUnitVectors(DOWN, new THREE.Vector3(...target).sub(head.position).normalize());
  parent.add(head);
  const model = createModeling(head);
  const metal = new THREE.MeshStandardMaterial({ color: '#283b35', metalness: 0.7, roughness: 0.36, side: THREE.DoubleSide });
  const profile = [[0, 0.26], [0.045, 0.26], [0.065, 0.21], [0.13, 0.16],
    [0.21, 0.06], [0.25, 0.015], [0.25, 0], [0.225, 0], [0.19, 0.055],
    [0.11, 0.14], [0.04, 0.20], [0, 0.20]];
  const shade = model.mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 48), metal);
  shade.name = `${name}-shade`;
  const rim = model.mesh(new THREE.TorusGeometry(0.235, 0.012, 8, 48).rotateX(Math.PI / 2), metal);
  rim.name = `${name}-rim`;
  // The analytic source carries the lamp's power; keep the visible diffuser's
  // emission modest so it does not add a second, noisy high-energy source.
  const emitterMaterial = new THREE.MeshStandardMaterial({ color: '#fff4da', emissive: '#ffda9b',
    emissiveIntensity: 1, roughness: 0.4, side: THREE.DoubleSide });
  const emitter = model.mesh(new THREE.CircleGeometry(0.17, 48).rotateX(Math.PI / 2), emitterMaterial, [0, -0.012, 0]);
  emitter.name = `${name}-emitter`;
  // Keep both the shadow rays and the physical light below the luminous diffuser.
  const origin = new THREE.Vector3(0, -0.045, 0).applyQuaternion(head.quaternion).add(head.position);
  return { head, origin };
}

/** Park lamp on a grounded plinth, with a swan-neck arm reaching over the trail. */
export function addStreetLamp(scene: THREE.Scene, base: Point, height: number, arm: Point,
  target: Point, intensity: number, range: number) {
  const fixture = new THREE.Group();
  fixture.name = 'street-lamp'; fixture.position.set(...base);
  fixture.userData.fixtureType = 'street';
  scene.add(fixture);
  const model = createModeling(fixture);
  const metal = new THREE.MeshStandardMaterial({ color: '#283b35', metalness: 0.7, roughness: 0.42 });
  const stone = new THREE.MeshStandardMaterial({ color: '#99998b', roughness: 0.94 });
  model.mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.12, 32), stone, [0, 0.06, 0]).name = 'street-lamp-footing';
  model.mesh(new THREE.CylinderGeometry(0.038, 0.065, height, 24), metal, [0, height / 2, 0]).name = 'street-lamp-pole';
  for (const y of [0.18, 0.35, height - 0.18]) {
    model.mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.045, 24), metal, [0, y, 0]);
  }
  for (const x of [-0.09, 0.09]) for (const z of [-0.09, 0.09]) {
    model.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 6), metal, [x, 0.128, z]);
  }
  const localTarget = new THREE.Vector3(...target).sub(fixture.position);
  const position: Point = [arm[0], height + arm[1], arm[2]];
  const { head, origin } = addLampHead(fixture, position, localTarget.toArray() as Point, 'street-lamp');
  const crown = new THREE.Vector3(0, 0.25, 0).applyQuaternion(head.quaternion).add(head.position);
  model.tube(metal, [[0, height - 0.20, 0], [0, height + 0.27, 0],
    [arm[0] * 0.55, height + 0.35, arm[2] * 0.55], crown.toArray() as Point], 0.028, 24).name = 'street-lamp-arm';
  origin.add(fixture.position);
  const light = addFixedBeam(scene, origin.toArray() as Point, target, intensity, range, 0.46);
  light.name = 'street-lamp-light'; light.userData.fixture = fixture.name;
  fixture.userData.light = light.name;
  return light;
}

/** Ceiling-mounted canopy, suspension cable and a downward-facing pendant shade. */
export function addPendantLamp(scene: THREE.Scene, anchor: Point, drop: number, intensity = 40) {
  const fixture = new THREE.Group();
  fixture.name = 'ceiling-pendant'; fixture.position.set(...anchor);
  fixture.userData.fixtureType = 'pendant';
  scene.add(fixture);
  const model = createModeling(fixture);
  const metal = new THREE.MeshStandardMaterial({ color: '#4a4538', metalness: 0.75, roughness: 0.3 });
  const cable = new THREE.MeshStandardMaterial({ color: '#242322', roughness: 0.8 });
  model.mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.035, 32), metal, [0, -0.0175, 0]).name = 'ceiling-pendant-canopy';
  const cableLength = drop - 0.26;
  model.mesh(new THREE.CylinderGeometry(0.007, 0.007, cableLength, 12), cable, [0, -cableLength / 2, 0]).name = 'ceiling-pendant-cable';
  const { origin } = addLampHead(fixture, [0, -drop, 0], [0, -drop - 1, 0], 'ceiling-pendant');
  origin.add(fixture.position);
  const light = addFixedBeam(scene, origin.toArray() as Point, [anchor[0], 0.02, anchor[2]], intensity, 10, 1.2);
  light.name = 'ceiling-pendant-light'; light.userData.fixture = fixture.name;
  fixture.userData.light = light.name;
  return light;
}
