import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// Scene construction and geometry checks do not require a GPU or browser canvas.
vi.mock('./environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./environment')>();
  return { ...actual,
    createStudioEnvironment: () => new THREE.WebGLRenderTarget(1, 1),
    createGradientEnvironment: () => new THREE.WebGLRenderTarget(1, 1),
  };
});
vi.mock('./textures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./textures')>();
  const surface = () => ({ map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture() });
  return { ...actual, createSurface: surface, createPlasterSurface: surface,
    createWoodSurface: surface, createLinenSurface: surface, createStonewareSurface: surface,
    createPaperSurface: surface, createArtworkTexture: () => new THREE.Texture(),
    createContactShadowTexture: () => new THREE.Texture() };
});

import { PathTracingSceneGenerator } from 'three-gpu-pathtracer';
import { createPathTracingScene } from '../renderer/pathTracingScene';
import { SCENES } from './registry';
import { terrainHeight } from './outdoor';
import { disposeScene } from './modeling';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { SCENE_REFERENCES } from './references';

// Catch malformed procedural geometry and runaway foliage budgets in all four sets.
describe('photographic scene construction', () => {
  for (const definition of SCENES) {
    it(`${definition.id}: builds finite geometry within the scene budget and disposes it`, () => {
      const instance = definition.create({ renderer: {} as THREE.WebGLRenderer });
      instance.scene.updateMatrixWorld(true);
      let triangles = 0, draws = 0;
      const geometries = new Set<THREE.BufferGeometry>();
      const instances: THREE.InstancedMesh[] = [];
      instance.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        draws++;
        const geometry = object.geometry;
        geometries.add(geometry);
        for (const name of ['position', 'normal', 'uv']) {
          const attribute = geometry.getAttribute(name);
          if (attribute) expect(Array.from(attribute.array).every(Number.isFinite), `${name} in ${definition.id}`).toBe(true);
        }
        geometry.computeBoundingBox();
        expect(geometry.boundingBox?.isEmpty()).toBe(false);
        const count = object instanceof THREE.InstancedMesh ? object.count : 1;
        if (object instanceof THREE.InstancedMesh) {
          instances.push(object);
          expect(Array.from(object.instanceMatrix.array).every(Number.isFinite)).toBe(true);
        }
        triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3 * count;
      });
      expect(draws).toBeGreaterThan(20);
      expect(draws).toBeLessThan(650);
      expect(triangles).toBeLessThan(1_800_000);
      const disposed = new Set<THREE.BufferGeometry>();
      geometries.forEach((geometry) => geometry.addEventListener('dispose', () => disposed.add(geometry)));
      const instanceDisposes = instances.map((object) => vi.spyOn(object, 'dispose'));
      instance.dispose();
      expect(disposed.size).toBe(geometries.size);
      instanceDisposes.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
      expect(instance.scene.children).toHaveLength(0);
    });
  }

  for (const id of ['portrait', 'animal']) {
    it(`${id}: the initial focus ray reaches the model's actual eye`, () => {
      const definition = SCENES.find((scene) => scene.id === id)!;
      const instance = definition.create({ renderer: {} as THREE.WebGLRenderer });
      instance.scene.updateMatrixWorld(true);
      const origin = new THREE.Vector3(definition.defaultPose.x, definition.defaultPose.y, definition.defaultPose.z);
      const focus = new THREE.Vector3(definition.defaultFocusPoint.x, definition.defaultFocusPoint.y, definition.defaultFocusPoint.z);
      const ray = new THREE.Raycaster(origin, focus.clone().sub(origin).normalize());
      const hit = ray.intersectObjects(instance.scene.children, true)[0];
      expect(hit, 'focus target must be on visible geometry').toBeDefined();
      expect(hit.point.distanceTo(focus), 'focus marker must match the visible eye').toBeLessThan(id === 'animal' ? 0.006 : 0.01);
      instance.dispose();
    });
  }

  for (const id of ['portrait', 'animal']) {
    it(`${id}: the path-tracing BVH includes the real subject and its eye`, () => {
      const definition = SCENES.find(scene => scene.id === id)!;
      const instance = definition.create({ renderer: {} as THREE.WebGLRenderer });
      const physical = createPathTracingScene(instance);
      physical.scene.updateMatrixWorld(true);
      const generator = new PathTracingSceneGenerator(physical.scene);
      const result = generator.generate();
      const pose = definition.defaultPose, focus = definition.defaultFocusPoint;
      const origin = new THREE.Vector3(pose.x, pose.y, pose.z), target = new THREE.Vector3(focus.x, focus.y, focus.z);
      const hit = result.bvh.raycastFirst(new THREE.Ray(origin, target.clone().sub(origin).normalize()), THREE.DoubleSide);
      expect(hit).not.toBeNull();
      expect(hit!.point.distanceTo(target)).toBeLessThan(0.01);
      expect(result.geometry.attributes.position.count).toBeGreaterThan(10000);
      result.geometry.dispose(); physical.dispose(); instance.dispose();
    }, 20_000);
  }

  it('gives all four scenes a clear afternoon skybox and aligned shadow-tested sunlight', () => {
    for (const definition of SCENES) {
      const instance = definition.create({ renderer: {} as THREE.WebGLRenderer });
      {
        expect(instance.sky?.weather).toBe('clear');
        expect(instance.sky?.time).toBe('16:00');
        expect(instance.scene.background).toBeInstanceOf(THREE.CubeTexture);
        expect(instance.sky!.skybox.images).toHaveLength(6);
        expect(instance.scene.environment).toBe(instance.sky!.environment);
        const skyDisposed = vi.spyOn(instance.sky!.skybox, 'dispose');
        const envDisposed = vi.spyOn(instance.sky!.environment, 'dispose');
        const volume = instance.sunlight!;
        expect(volume).toBeDefined();
        expect(volume.sun.castShadow).toBe(true);
        expect(instance.scene.children).toContain(volume.sun);
        expect(volume.density).toBeGreaterThan(0);
        expect(volume.distance).toBeLessThanOrEqual(definition.cameraFar);
        const visual = instance.scene.getObjectByName('visible-sun')!;
        const sunDirection = volume.sun.position.clone().sub(volume.sun.target.position).normalize();
        const visualDirection = visual.position.clone().sub(volume.sun.target.position).normalize();
        expect(sunDirection.distanceTo(visualDirection)).toBeLessThan(1e-6);
        const ray = new THREE.Raycaster(volume.sun.target.position, visualDirection);
        expect(ray.intersectObject(visual, true)).toHaveLength(0);
        const elevation = Math.asin(sunDirection.y) * 180 / Math.PI;
        expect(elevation).toBeGreaterThan(20);
        expect(elevation).toBeLessThan(35);
        instance.dispose();
        expect(skyDisposed).toHaveBeenCalledOnce();
        expect(envDisposed).toHaveBeenCalledOnce();
      }
    }
  });

  it('indoor: traces the window, enclosure and atmospheric volume under the same afternoon sky', () => {
    const instance = SCENES[0].create({ renderer: {} as THREE.WebGLRenderer });
    instance.scene.updateMatrixWorld(true);
    const window = instance.scene.getObjectByName('atelier-window')!;
    // A floor-directed sun ray must pass through the window, while its frame blocks a neighbour.
    const direction = instance.sky!.sunDirection;
    const openPoint = window.localToWorld(new THREE.Vector3(0.25, 0.48, 0.2));
    const openRay = new THREE.Raycaster(openPoint, direction, 0, 0.6);
    expect(openRay.intersectObject(window, true)).toHaveLength(0);
    const framePoint = window.localToWorld(new THREE.Vector3(0, 0.48, 0.2));
    const frameRay = new THREE.Raycaster(framePoint, new THREE.Vector3(0, 0, -1), 0, 0.6);
    expect(frameRay.intersectObject(window, true).length).toBeGreaterThan(0);
    const physical = createPathTracingScene(instance);
    const glass = physical.scene.getObjectByName('atelier-window-glass') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
    expect(glass.material.transmission).toBe(1);
    expect((glass.material as THREE.MeshPhysicalMaterial & { castShadow: boolean }).castShadow).toBe(false);
    expect(physical.scene.getObjectByName('raster-contact-shadow')).toBeUndefined();
    const atmosphere = physical.scene.getObjectByName('path-traced-atmosphere') as THREE.Mesh;
    expect(atmosphere).toBeDefined();
    expect(atmosphere.position.y).toBe(1.8);
    expect(physical.scene.background).toBe(physical.scene.environment);
    expect(physical.scene.environment).not.toBe(instance.scene.environment);
    expect(physical.scene.environment!.image).toBe(instance.sky!.environment.image);
    physical.scene.updateMatrixWorld(true);
    const generated = new PathTracingSceneGenerator(physical.scene).generate();
    expect(generated.bvh).toBeDefined();
    generated.geometry.dispose(); physical.dispose(); instance.dispose();
  }, 20_000);

  it('keeps the lakebed below water and buries the water mesh edge under the bank', () => {
    for (let i = 0; i < 72; i++) {
      const angle = i / 72 * Math.PI * 2;
      for (const radius of [0, 0.4, 0.7]) {
        expect(terrainHeight(3 + Math.cos(angle) * 34 * radius, -46 + Math.sin(angle) * 38 * radius)).toBeLessThan(-0.8);
      }
      expect(terrainHeight(3 + Math.cos(angle) * 34, -46 + Math.sin(angle) * 38)).toBeGreaterThan(-0.8);
    }
  });

  it('keeps the linen above the tabletop and lets its hem fall over the edge', () => {
    const instance = SCENES[0].create({ renderer: {} as THREE.WebGLRenderer });
    const runner = instance.scene.getObjectByName('linen-runner') as THREE.Mesh;
    const position = runner.geometry.attributes.position;
    let drapedVertices = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      if (Math.hypot(x, z) < 0.82) expect(y).toBeGreaterThan(0.784);
      if (y < 0.77) drapedVertices++;
    }
    expect(drapedVertices).toBeGreaterThan(0);
    instance.dispose();
  });

  it('uses the requested scene categories and supplies all four local reference images', () => {
    expect(SCENES.map((scene) => scene.name)).toEqual(['室内静物', '室外高山湖畔', '室外人像', '林间知更鸟']);
    for (const scene of SCENES) expect(SCENE_REFERENCES[scene.id].image).toMatch(/\.png(?:\?|$)/);
  });

  it('resizes and releases the lake reflection target with the scene lifecycle', () => {
    const instance = SCENES.find((scene) => scene.id === 'outdoor')!.create({ renderer: {} as THREE.WebGLRenderer });
    const water = instance.scene.getObjectByName('alpine-lake-reflection') as Reflector;
    const target = water.getRenderTarget();
    expect([target.width, target.height]).toEqual([1024, 512]);
    instance.setQuality!('low');
    expect([target.width, target.height]).toEqual([512, 256]);
    instance.setQuality!('balanced');
    expect([target.width, target.height]).toEqual([1024, 512]);
    const dispose = vi.spyOn(target, 'dispose');
    instance.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('models the robin at its actual small scale instead of a half-metre subject', () => {
    const instance = SCENES.find((scene) => scene.id === 'animal')!.create({ renderer: {} as THREE.WebGLRenderer });
    instance.scene.updateMatrixWorld(true);
    const bird = instance.scene.getObjectByName('life-size-robin')!;
    const size = new THREE.Box3().setFromObject(bird).getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(0.14);
    expect(size.y).toBeLessThan(0.19);
    instance.dispose();
  });

  it('releases shared geometry, materials and textures only once', () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
    scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    const disposals = [geometry, texture, material].map((resource) => vi.spyOn(resource, 'dispose'));
    disposeScene(scene);
    disposals.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
  });
});
