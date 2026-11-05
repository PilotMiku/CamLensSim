import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PathTracingSceneGenerator } from 'three-gpu-pathtracer';
import { addPendantLamp, addStreetLamp } from './fixtures';
import { disposeScene } from './modeling';
import { createPathTracingScene } from '../renderer/pathTracingScene';

describe('physical light fixtures', () => {
  for (const kind of ['street', 'pendant'] as const) {
    it(`${kind}: traces an independent sun, lamp and emitting surface without the housing blocking the light`, () => {
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight('#ffecd0', 4);
      sun.name = 'independent-sun'; sun.position.set(-4, 6, -8);
      scene.add(sun, sun.target);
      const light = kind === 'street'
        ? addStreetLamp(scene, [2, 0.5, -3], 3, [-0.6, 0, 0], [1, 0.55, -1], 200, 12)
        : addPendantLamp(scene, [-0.8, 3.6, -1], 1.4, 110);
      scene.updateMatrixWorld(true);
      const fixture = scene.getObjectByName(light.userData.fixture)!;
      const emitter = fixture.getObjectByName(`${fixture.name}-emitter`) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const emitterPosition = emitter.getWorldPosition(new THREE.Vector3());
      expect(light.position.distanceTo(emitterPosition)).toBeLessThan(0.05);
      const direction = light.target.position.clone().sub(light.position).normalize();
      expect(new THREE.Raycaster(light.position, direction, 0.001,
        light.position.distanceTo(light.target.position)).intersectObject(fixture, true)).toHaveLength(0);

      const physical = createPathTracingScene({ scene, sunlight: { sun, beam: light,
        density: 0.02, distance: 20, groundHeight: 0, heightFalloff: 0.2 }, dispose() {} });
      physical.scene.updateMatrixWorld(true);
      const generated = new PathTracingSceneGenerator(physical.scene).generate();
      expect(generated.lights).toHaveLength(2);
      expect(generated.lights.find(source => source.name === sun.name)).toBeInstanceOf(THREE.DirectionalLight);
      const tracedLight = generated.lights.find(source => source.name === light.name) as THREE.SpotLight;
      expect(tracedLight.position.equals(light.position)).toBe(true);
      expect(tracedLight.target.position.equals(light.target.position)).toBe(true);
      expect(tracedLight.intensity).toBe(light.intensity);
      const tracedEmitter = physical.scene.getObjectByName(emitter.name) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      expect(tracedEmitter.material.emissiveIntensity).toBeGreaterThan(0);
      expect(tracedEmitter.material.emissive.equals(emitter.material.emissive)).toBe(true);
      // A ray from below the diffuser must reach its real emitting geometry in the BVH.
      const hit = generated.bvh.raycastFirst(new THREE.Ray(light.position, emitterPosition.clone().sub(light.position).normalize()), THREE.DoubleSide);
      expect(hit).not.toBeNull();
      expect(hit!.distance).toBeCloseTo(light.position.distanceTo(emitterPosition), 3);
      generated.geometry.dispose(); physical.dispose(); disposeScene(scene);
    });
  }
});
