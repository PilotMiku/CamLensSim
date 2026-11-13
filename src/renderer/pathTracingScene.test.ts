import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PhysicalCamera, PathTracingSceneGenerator, ShapedAreaLight } from 'three-gpu-pathtracer';
import { configurePhysicalCamera } from './pathTracing';
import { bakeInstances, createPathTracingScene } from './pathTracingScene';
import { shadowRayCorrectionShader } from './pathTracingShadowRays';
import { solarRadiance } from '../optics/sun';
import { addVisibleSun } from '../scenes/sunlight';
import { applyAfternoonSky, afternoonSkyColor } from '../scenes/afternoonSky';

describe('physical path tracing scene', () => {
  it('keeps the solar visual out of every BVH ray while preserving the independent directional source', () => {
    const scene = new THREE.Scene();
    const sky = applyAfternoonSky(scene, 'outdoor');
    const sun = new THREE.DirectionalLight('#ffecd0', 4);
    sun.name = 'test-sun'; sun.position.copy(sky.sunDirection).multiplyScalar(80);
    scene.add(sun, sun.target); addVisibleSun(scene, sun, 360);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial());
    ground.position.y = -1; scene.add(ground);
    const physical = createPathTracingScene({ scene, sky, sunlight: { sun, density: 0.004,
      distance: 100, groundHeight: 0, heightFalloff: 0.1 }, dispose() {} });
    physical.scene.updateMatrixWorld(true);
    const generated = new PathTracingSceneGenerator(physical.scene).generate();
    expect(generated.lights).toHaveLength(1);
    expect(generated.lights[0].name).toBe(sun.name);
    // This includes specular paths, for which material.castShadow=false is not enough.
    expect(generated.bvh.raycastFirst(new THREE.Ray(new THREE.Vector3(), sky.sunDirection), THREE.DoubleSide)).toBeNull();
    const palette = ['#2679c5', '#c1def3', '#81856a'].map(value => new THREE.Color(value)) as [THREE.Color, THREE.Color, THREE.Color];
    const solarColor = afternoonSkyColor(sky.sunDirection, palette, new THREE.Color(), 0, sky.sunDirection);
    // The sky texture no longer contains an independently emitting solar disk.
    expect(solarColor.r).toBeLessThan(3);
    expect(physical.solar.light.intensity).toBeGreaterThan(10000);
    expect(scene.environmentIntensity).toBe(1);
    expect(physical.scene.environmentIntensity).toBe(scene.environmentIntensity);
    generated.geometry.dispose(); physical.dispose(); ground.geometry.dispose(); ground.material.dispose(); sky.dispose();
    scene.getObjectByName('visible-sun')!.traverse(object => {
      if (object instanceof THREE.Mesh) { object.geometry.dispose(); object.material.dispose(); }
    });
  });

  it('registers the authoritative sun once and updates a detached target in world space', () => {
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 4);
    sun.name = 'detached-sun'; sun.position.set(-4, 6, 8);
    const parent = new THREE.Group(); parent.position.set(2, 1, -3);
    parent.add(sun.target); sun.target.position.set(0, 1, 0);
    const physical = createPathTracingScene({ scene, sunlight: { sun, density: 0,
      distance: 20, groundHeight: 0, heightFalloff: 0 }, dispose() {} });
    physical.scene.updateMatrixWorld(true);
    const traced = physical.scene.getObjectByName(sun.name) as THREE.DirectionalLight;
    expect(traced).toBeInstanceOf(ShapedAreaLight);
    expect(traced.intensity).toBe(solarRadiance(4));
    expect(traced.position.clone().sub(new THREE.Vector3(2, 2, -3)).normalize().toArray())
      .toEqual(sun.position.clone().sub(new THREE.Vector3(2, 2, -3)).normalize().toArray());
    physical.dispose();
  });

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
    configurePhysicalCamera(camera, source, { ...lens, focusM: Infinity }, true, 24);
    expect(camera.focusDistance).toBe(1e8);
    expect(Number.isFinite(camera.focusDistance)).toBe(true);
    expect(camera.bokehSize).toBeCloseTo(85 / 1.8);
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

  it('preserves RGB face albedo when the BVH merges it after uncoloured geometry', () => {
    const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(0xffffff, 4);
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
    plain.position.x = -2; scene.add(plain);
    const geometry = new THREE.PlaneGeometry();
    const rgb = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < rgb.length; i += 3) rgb.set([0.8, 0.45, 0.3], i);
    geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    const face = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
    face.position.x = 2; scene.add(face);
    const physical = createPathTracingScene({ scene, sunlight: { sun, density: 0, distance: 10,
      groundHeight: 0, heightFalloff: 0 }, dispose() {} });
    const generated = new PathTracingSceneGenerator(physical.scene).generate();
    const p = generated.geometry.attributes.position, color = generated.geometry.attributes.color;
    let checked = 0;
    for (let i = 0; i < p.count; i++) if (p.getX(i) > 1) {
      expect(color.getX(i), 'red albedo must survive BVH merging').toBeCloseTo(0.8);
      expect(color.getY(i)).toBeCloseTo(0.45); expect(color.getZ(i)).toBeCloseTo(0.3);
      expect(color.getW(i)).toBe(1); checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(Array.from(geometry.attributes.color.array)).toEqual(Array.from(rgb));
    generated.geometry.dispose(); physical.dispose();
    for (const mesh of [plain, face]) { mesh.geometry.dispose(); mesh.material.dispose(); }
  });

  it('preserves physical water and the fixed sun without a second stochastic scattering volume', () => {
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
    expect(converted.scene.getObjectByName('path-traced-atmosphere')).toBeUndefined();
    const light = converted.solar.light;
    expect(light).not.toBe(sun);
    expect(light.position.clone().sub(sun.target.position).normalize().distanceTo(sun.position.clone().sub(sun.target.position).normalize())).toBeLessThan(1e-10);
    expect(light.intensity).toBe(solarRadiance(sun.intensity));
    expect(converted.scene.environment!.mapping).toBe(THREE.EquirectangularReflectionMapping);
    converted.dispose();
    expect(source.children).toContain(water);
    expect(water.material).toBeInstanceOf(THREE.ShaderMaterial);
    water.geometry.dispose(); water.material.dispose();
  });

  it('preserves already oriented BVH normals while respecting non-shadow-casting glazing', () => {
    const rawShader = /* glsl */ `
      surf.faceNormal = surfaceHit.faceNormal;
      surf.normal = normal;
      bool isTransmissiveRay = ! surf.volumeParticle && dot( scatterRec.direction, surf.faceNormal * surfaceHit.side ) < 0.0;
      bool isShadowRay = state.isShadowRay;
    `;
    const patched = shadowRayCorrectionShader(rawShader);
    expect(patched).toContain('surf.faceNormal = surfaceHit.faceNormal;');
    expect(patched).toContain('bool isTransmissiveRay = ! surf.volumeParticle && dot( scatterRec.direction, surf.faceNormal * surfaceHit.side ) < 0.0;');
    expect(patched).toContain('bool isShadowRay = true;');
    expect(() => shadowRayCorrectionShader('unsupported shader')).toThrow();
  });

  it('preserves nested object world matrices into baked BVH geometry', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.position.set(10, 20, 30);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    box.name = 'test-nested-box';
    group.add(box);
    scene.add(group);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(sun, sun.target);
    const physical = createPathTracingScene({
      scene,
      sunlight: { sun, density: 0, distance: 10, groundHeight: 0, heightFalloff: 0 },
      dispose() {},
    });
    const copiedBox = physical.scene.getObjectByName('test-nested-box');
    expect(copiedBox?.matrixWorld.elements[12]).toBe(10);
    expect(copiedBox?.matrixWorld.elements[13]).toBe(20);
    expect(copiedBox?.matrixWorld.elements[14]).toBe(30);

    const generated = new PathTracingSceneGenerator(physical.scene).generate();
    const pos = generated.geometry.attributes.position;
    expect(pos.getX(0)).toBeCloseTo(10.5, 1);
    expect(pos.getY(0)).toBeCloseTo(20.5, 1);
    expect(pos.getZ(0)).toBeCloseTo(30.5, 1);

    generated.geometry.dispose();
    physical.dispose();
    box.geometry.dispose();
    box.material.dispose();
  });
});
