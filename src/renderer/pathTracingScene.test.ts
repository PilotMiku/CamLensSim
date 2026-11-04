import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PhysicalCamera, PathTracingSceneGenerator } from 'three-gpu-pathtracer';
import { configurePhysicalCamera } from './pathTracing';
import { bakeInstances, createPathTracingScene } from './pathTracingScene';

describe('physical path tracing scene', () => {
  it('preserves the projection and supplies finite physical lens uniforms after copying a regular camera', () => {
    const source = new THREE.PerspectiveCamera(30, 1.5, 0.04, 65);
    source.position.set(0, 1, 4); source.updateMatrixWorld();
    const camera = new PhysicalCamera();
    const lens = { focalMm: 85, aperture: 1.8, focusM: 4, blades: 9 };
    configurePhysicalCamera(camera, source, lens, true, 24);
    expect(camera.projectionMatrix.equals(source.projectionMatrix)).toBe(true);
    expect(camera.bokehSize).toBeCloseTo(85 / 1.8);
    expect(camera.apertureRotation).toBe(0);
    expect(camera.anamorphicRatio).toBe(1);
    expect(camera.focusDistance).toBe(4);
    configurePhysicalCamera(camera, source, lens, false, 24);
    expect(camera.bokehSize).toBe(0);
  });

  it('bakes instance transforms, normals, tint and mirrored winding into ray-intersectable geometry', () => {
    const source = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff' });
    const instances = new THREE.InstancedMesh(source, material, 2);
    instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-2, 0, 0));
    instances.setMatrixAt(1, new THREE.Matrix4().compose(new THREE.Vector3(2, 0, 0), new THREE.Quaternion(), new THREE.Vector3(-1, 2, 1)));
    instances.setColorAt(0, new THREE.Color('#ff0000'));
    instances.setColorAt(1, new THREE.Color('#00ff00'));
    const geometry = bakeInstances(instances);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBe(-2.5);
    expect(geometry.boundingBox!.max.x).toBe(2.5);
    expect(geometry.boundingBox!.max.y).toBe(1);
    expect(geometry.attributes.color.getX(0)).toBe(1);
    expect(geometry.attributes.color.getY(source.attributes.position.count)).toBe(1);
    for (const attribute of Object.values(geometry.attributes)) expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    const generator = new PathTracingSceneGenerator(scene);
    const result = generator.generate();
    for (const x of [-2, 2]) {
      const hit = result.bvh.raycastFirst(new THREE.Ray(new THREE.Vector3(x, 0, 3), new THREE.Vector3(0, 0, -1)), THREE.FrontSide);
      expect(hit).not.toBeNull();
      expect(hit!.point.z).toBeCloseTo(0.5);
    }
    result.geometry.dispose(); geometry.dispose(); source.dispose(); material.dispose();
  });

  it('converts water to a reflective refractive surface and adds a physical scattering volume', () => {
    const source = new THREE.Scene();
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial());
    water.name = 'alpine-lake-reflection'; source.add(water);
    const sun = new THREE.DirectionalLight('#fff0d2', 4);
    sun.position.set(-3, 6, 2); source.add(sun, sun.target);
    const world = { scene: source, dispose() {}, sunlight: { sun, density: 0.04, distance: 20, groundHeight: 0, heightFalloff: 0.2 } };
    const converted = createPathTracingScene(world);
    const physicalWater = converted.scene.getObjectByName(water.name) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
    expect(physicalWater.material.isMeshPhysicalMaterial).toBe(true);
    expect(physicalWater.material.ior).toBe(1.333);
    expect(physicalWater.material.transmission).toBeGreaterThan(0);
    expect(converted.scene.getObjectByName('path-traced-atmosphere')).toBeDefined();
    expect(converted.scene.environment!.mapping).toBe(THREE.EquirectangularReflectionMapping);
    converted.dispose();
    expect(source.children).toContain(water);
    expect(water.material).toBeInstanceOf(THREE.ShaderMaterial);
    water.geometry.dispose(); water.material.dispose();
  });
});
