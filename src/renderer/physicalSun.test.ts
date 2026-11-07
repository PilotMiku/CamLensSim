import * as THREE from 'three';
import * as PathTracing from 'three-gpu-pathtracer';
// Runtime export omitted by the pinned package's declaration file.
const { PhysicalPathTracingMaterial } = PathTracing as unknown as { PhysicalPathTracingMaterial: new () => THREE.ShaderMaterial };
import { describe, expect, it } from 'vitest';
import { SOLAR_ANGULAR_RADIUS, SOLAR_PROXY_DISTANCE_M, solarRadiance, solarPenumbraWidth } from '../optics/sun';
import { createPhysicalSun, installSolarBackground } from './physicalSun';
import { createAfternoonSky } from '../scenes/afternoonSky';
import { createPathTracingScene } from './pathTracingScene';
import { createSolarBackground } from '../scenes/solarBackground';
import { patchSolarShadow } from './solarShadow';

const source = () => {
  const sun = new THREE.DirectionalLight(0xffffff, 4);
  sun.name = 'sun'; sun.position.set(0, 10, 0); return sun;
};

describe('physical solar disk', () => {
  it('has the apparent solar diameter and faces the same direction as the source', () => {
    const s = createPhysicalSun(source()), l = s.light;
    expect(2 * Math.atan(l.width / (2 * SOLAR_PROXY_DISTANCE_M)) * 180 / Math.PI).toBeCloseTo(0.53285, 4);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(l.quaternion);
    expect(normal.distanceTo(s.uniforms.physicalSolarDirection.value)).toBeLessThan(1e-10);
    expect(l.isCircular).toBe(true);
    expect(s.uniforms.physicalSolarCosRadius.value).toBe(Math.cos(SOLAR_ANGULAR_RADIUS));
  });

  it('preserves irradiance and cosine falloff when replacing the directional source', () => {
    const s = createPhysicalSun(source());
    const r = s.light.width / 2, d = SOLAR_PROXY_DISTANCE_M, n = 4096;
    for (const angle of [0, 30, 60]) {
      let estimate = 0;
      const a = angle * Math.PI / 180;
      for (let i = 0; i < n; i++) {
        const radial = r * Math.sqrt((i + 0.5) / n), phi = i * 2.39996323;
        const x = radial * Math.cos(phi), dist2 = d * d + radial * radial;
        const cosLight = d / Math.sqrt(dist2);
        const cosReceiver = (d * Math.cos(a) + x * Math.sin(a)) / Math.sqrt(dist2);
        estimate += s.light.intensity * cosReceiver * cosLight * Math.PI * r * r / dist2 / n;
      }
      expect(estimate).toBeCloseTo(4 * Math.cos(a), 4);
    }
    expect(solarRadiance(8)).toBe(2 * solarRadiance(4));
  });

  it('produces contact-hardening penumbrae of about 9.3 mm per metre of gap', () => {
    expect(solarPenumbraWidth(0)).toBe(0);
    expect(solarPenumbraWidth(1)).toBeCloseTo(0.0093, 6);
    expect(solarPenumbraWidth(10) / solarPenumbraWidth(1)).toBeCloseTo(10, 12);
    const s = createPhysicalSun(source()), r = s.light.width / 2, d = SOLAR_PROXY_DISTANCE_M;
    const visibility = (x: number, h: number) => {
      let clear = 0;
      for (let i = 0; i < 4096; i++) {
        const sx = r * Math.sqrt((i + 0.5) / 4096) * Math.cos(i * 2.39996323);
        if ((1 - h / d) * x + h / d * sx >= 0) clear++;
      }
      return clear / 4096;
    };
    expect(visibility(0, 1)).toBeCloseTo(0.5, 2);
    expect(visibility(0.005, 1)).toBe(1);
    expect(visibility(-0.005, 1)).toBe(0);
    expect(visibility(0.005, 10)).toBeGreaterThan(0.5);
    expect(visibility(0.005, 10)).toBeLessThan(0.7);
  });

  it('synchronizes direction, color, intensity and visibility from one authoritative source', () => {
    const sun = source(), s = createPhysicalSun(sun);
    expect(s.sync()).toBe(false);
    sun.intensity = 0;
    expect(s.sync()).toBe(true);
    expect(s.light.intensity).toBe(0);
    expect(s.uniforms.physicalSolarRadiance.value.toArray()).toEqual([0, 0, 0]);
    sun.intensity = 8; sun.color.setRGB(1, 0.8, 0.6); sun.position.set(10, 10, 0);
    s.sync();
    expect(s.light.intensity).toBe(solarRadiance(8));
    expect(s.uniforms.physicalSolarDirection.value.x).toBeCloseTo(Math.SQRT1_2);
    expect(s.uniforms.physicalSolarRadiance.value.g / s.uniforms.physicalSolarRadiance.value.r).toBeCloseTo(0.8, 12);
    sun.visible = false; s.sync();
    expect(s.light.visible).toBe(false);
    expect(s.uniforms.physicalSolarRadiance.value.r).toBe(0);
  });

  it('removes solar disk energy from the lighting environment, while keeping one sampled sun', () => {
    const sky = createAfternoonSky('outdoor', 16), scene = new THREE.Scene(), sun = source();
    sun.position.copy(sky.sunDirection).multiplyScalar(10); scene.add(sun, sun.target);
    const physical = createPathTracingScene({ scene, sky, sunlight: { sun, density: 0, distance: 10, groundHeight: 0, heightFalloff: 0 }, dispose() {} });
    const lightData = physical.scene.environment!.image.data as Float32Array;
    const clean = sky.lightingEnvironment.image.data as Float32Array;
    expect(Array.from(lightData)).toEqual(Array.from(clean));
    expect(physical.scene.children.filter(o => (o as THREE.Light).isLight)).toHaveLength(1);
    expect(physical.scene.children.some(o => (o as THREE.DirectionalLight).isDirectionalLight)).toBe(false);
    expect(physical.scene.background).toBe(sky.lightingEnvironment);
    physical.dispose(); sky.dispose();
  });

  it('uses the same radiance in primary/transmitted backgrounds without changing area-light MIS', () => {
    const sun = source(), solar = createPhysicalSun(sun), material = new PhysicalPathTracingMaterial();
    installSolarBackground(material, solar);
    const shader = { uniforms: {}, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.physicalSolarRadiance).toBe(solar.uniforms.physicalSolarRadiance);
    expect(shader.fragmentShader).toContain('return physicalSolarRadiance;');
    expect(shader.fragmentShader).toContain('intersectLightAtIndex');
    expect(shader.fragmentShader).toContain('misHeuristic( lightPdf, lightMaterialPdf )');
    sun.intensity = 0; solar.sync();
    expect(shader.uniforms.physicalSolarRadiance.value.r).toBe(0);
    expect(() => installSolarBackground(new THREE.ShaderMaterial(), solar)).toThrow();
    material.dispose();
  });

  it('patches only solar shadows while leaving spot-light shadows and global chunks unchanged', () => {
    const original = THREE.ShaderChunk.lights_fragment_begin;
    const shader = { uniforms: {}, fragmentShader: '#include <shadowmap_pars_fragment>\n#include <lights_fragment_begin>' };
    patchSolarShadow(shader, source());
    expect(shader.fragmentShader).toContain('getSolarShadow( directionalShadowMap');
    expect(shader.fragmentShader).toContain('getShadow( spotShadowMap');
    expect(shader.fragmentShader).toContain('p.z - depths / blockers');
    expect(THREE.ShaderChunk.lights_fragment_begin).toBe(original);
  });
});


it('keeps the analytic solar background camera-centred with the authoritative direction and radiance', () => {
  const sun = source(), scene = new THREE.Scene();
  const sky = createAfternoonSky('outdoor', 8); scene.environment = sky.lightingEnvironment;
  const parent = new THREE.Group(); parent.position.set(30, 20, -10); scene.add(parent);
  const mesh = createSolarBackground(scene, sun)!; parent.add(mesh);
  const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 100);
  const renderer = { getCurrentViewport: (v: THREE.Vector4) => v.set(0, 0, 600, 400) } as THREE.WebGLRenderer;
  for (const position of [new THREE.Vector3(0, 1, 3), new THREE.Vector3(45, 20, -30)]) {
    camera.position.copy(position); camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
    mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, mesh.material, parent);
    expect(mesh.getWorldPosition(new THREE.Vector3()).distanceTo(position)).toBeLessThan(1e-10);
    expect(mesh.material.uniforms.solarDirection.value.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-10);
    expect(mesh.material.uniforms.solarRadiance.value.r).toBe(solarRadiance(4));
  }
  sun.intensity = 0;
  mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, mesh.material, parent);
  expect(mesh.material.uniforms.solarRadiance.value.r).toBe(0);
  expect(mesh.material.depthWrite).toBe(false);
  mesh.geometry.dispose(); mesh.material.dispose(); sky.dispose();
});
