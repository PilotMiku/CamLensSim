import * as THREE from 'three';
import * as PathTracing from 'three-gpu-pathtracer';
import { describe, expect, it } from 'vitest';
import { installPlanarFocus, installTracerPlanarFocus, planarFocusShader } from './pathTracingFocus';
import { createPhysicalSun, installSolarBackground } from './physicalSun';

const { PhysicalPathTracingMaterial } = PathTracing as unknown as {
  PhysicalPathTracingMaterial: new () => THREE.ShaderMaterial;
};

describe('path-tracing planar focus adapter', () => {
  it('composes with the solar adapter on both tracer materials and preserves its uniforms', () => {
    const materials = [new PhysicalPathTracingMaterial(), new PhysicalPathTracingMaterial()];
    const sun = createPhysicalSun(new THREE.DirectionalLight());
    const tracer = { _pathTracer: { material: materials[0] }, _lowResPathTracer: { material: materials[1] } };
    installTracerPlanarFocus(tracer as unknown as PathTracing.WebGLPathTracer);
    try {
      for (const material of materials) {
        installSolarBackground(material, sun);
        const shader = { uniforms: {}, fragmentShader: material.fragmentShader, vertexShader: material.vertexShader } as THREE.WebGLProgramParametersWithUniforms;
        material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
        expect(shader.fragmentShader).toContain('float nearDistance');
        expect(shader.fragmentShader).toContain('return physicalSolarRadiance;');
        expect(shader.uniforms.physicalSolarRadiance).toBe(sun.uniforms.physicalSolarRadiance);
        expect(material.customProgramCacheKey()).toContain('planar-lens-focus-v1');
        expect(material.customProgramCacheKey()).toContain('physical-solar-background-v1');
      }
    } finally { materials.forEach(material => material.dispose()); }
  });

  it('rejects incompatible shader or tracer layouts before rendering', () => {
    expect(() => planarFocusShader('void main() {}')).toThrow('对焦');
    expect(() => installPlanarFocus(new THREE.ShaderMaterial())).toThrow('对焦');
    expect(() => installTracerPlanarFocus({} as PathTracing.WebGLPathTracer)).toThrow('对焦');
  });
});
