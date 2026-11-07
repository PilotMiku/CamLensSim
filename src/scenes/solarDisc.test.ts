import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSolarDisc } from './solarDisc';
import { addVisibleSun } from './sunlight';
import { createPhysicalSun } from '../renderer/physicalSun';
import { createAfternoonSky } from './afternoonSky';
import { SOLAR_ANGULAR_RADIUS, solarRadiance } from '../optics/sun';

describe('independent visible solar emitter', () => {
  it('tracks world-space source direction and matches the sampled emitter energy', () => {
    const scene = new THREE.Scene(), sourceParent = new THREE.Group();
    sourceParent.position.set(3, 2, 1); sourceParent.rotation.y = 0.4; scene.add(sourceParent);
    const sun = new THREE.DirectionalLight(0xffffff, 4);
    sun.position.set(10, 20, -10); sourceParent.add(sun);
    sun.target.position.set(-2, 1, 3); scene.add(sun.target);
    const disc = createSolarDisc(sun), model = new THREE.Group(); model.add(disc); scene.add(model);
    const physical = createPhysicalSun(sun);
    const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 80);
    const renderer = { getCurrentViewport: (v: THREE.Vector4) => v.set(10, 20, 600, 400) } as THREE.WebGLRenderer;
    const update = () => {
      camera.updateMatrixWorld(true); scene.updateMatrixWorld(true); physical.sync();
      disc.onBeforeRender(renderer, scene, camera, disc.geometry, disc.material, model);
    };
    try {
      for (const intensity of [4, 8, 0]) {
        sun.intensity = intensity; sun.color.setRGB(1, 0.8, 0.6); sun.position.x += 1;
        update();
        expect(disc.material.uniforms.solarDirection.value.distanceTo(physical.uniforms.physicalSolarDirection.value)).toBeLessThan(1e-10);
        expect(disc.material.uniforms.solarRadiance.value.toArray()).toEqual(physical.uniforms.physicalSolarRadiance.value.toArray());
        expect(disc.material.uniforms.solarRadiance.value.r).toBe(solarRadiance(intensity));
      }
      sun.intensity = 4; sun.visible = false; update();
      expect(disc.material.uniforms.solarRadiance.value.r).toBe(0);
      expect(disc.userData.lightSourceId).toBe(sun.uuid);
      expect(disc.material.uniforms.solarRadius.value).toBe(SOLAR_ANGULAR_RADIUS);
      expect(disc.material.depthWrite).toBe(false);
      expect(disc.material.depthTest).toBe(true);
    } finally { disc.geometry.dispose(); disc.material.dispose(); }
  });

  it('keeps the apparent sun fixed under camera translation and supports lens shift and fisheye', () => {
    const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(0xffffff, 4);
    sun.position.set(0, 10, -10); scene.add(sun, sun.target);
    const disc = createSolarDisc(sun), model = new THREE.Group(); model.add(disc); scene.add(model);
    const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 80);
    camera.setViewOffset(600, 400, 120, -80, 600, 400);
    const renderer = { getCurrentViewport: (v: THREE.Vector4) => v.set(0, 0, 600, 400) } as THREE.WebGLRenderer;
    try {
      for (const x of [0, 40]) {
        camera.position.set(x, 2, 10); camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
        disc.onBeforeRender(renderer, scene, camera, disc.geometry, disc.material, model);
        expect(disc.material.uniforms.solarDirection.value.distanceTo(new THREE.Vector3(0, 1, -1).normalize())).toBeLessThan(1e-10);
        expect(disc.material.uniforms.inverseProjection.value.equals(camera.projectionMatrixInverse)).toBe(true);
        expect(disc.material.uniforms.cameraWorld.value.equals(camera.matrixWorld)).toBe(true);
      }
      camera.userData.solarProjection = { focalMm: 16, widthMm: 43.8, heightMm: 32.9 };
      disc.onBeforeRender(renderer, scene, camera, disc.geometry, disc.material, model);
      expect(disc.material.uniforms.fisheye.value).toBe(true);
      expect(disc.material.uniforms.sensorSize.value.toArray()).toEqual([43.8, 32.9]);
      expect(new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)).intersectObject(disc)).toHaveLength(0);
    } finally { disc.geometry.dispose(); disc.material.dispose(); }
  });

  it('owns a separate sun mesh while the sky background excludes the solar disk', () => {
    const scene = new THREE.Scene(), sky = createAfternoonSky('outdoor', 8);
    scene.environment = sky.lightingEnvironment;
    const sun = new THREE.DirectionalLight(); sun.position.set(0, 10, 0);
    scene.add(sun, sun.target);
    const model = addVisibleSun(scene, sun, 40);
    const disc = model.getObjectByName('solar-disc') as THREE.Mesh;
    const background = model.getObjectByName('analytic-solar-background') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    try {
      expect(disc).toBeInstanceOf(THREE.Mesh);
      expect(disc.userData.pathTracingExclude).toBe(true);
      expect(background.material.uniforms.solarDiscEnabled.value).toBe(false);
      expect(model.userData.lightSourceId).toBe(sun.uuid);
      expect(scene.children.filter(object => object instanceof THREE.DirectionalLight)).toEqual([sun]);
    } finally {
      for (const object of [disc, background]) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
      sky.dispose();
    }
  });
});
