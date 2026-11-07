import * as THREE from 'three';
import { SOLAR_ANGULAR_RADIUS } from '../optics/sun';

/** Raster approximation of the solar disk: blocker search + gap-dependent PCF.
 * Orthographic shadow depths are linear, so gap = deltaDepth * (far-near).
 */
export const solarShadowGLSL = /* glsl */ `
  uniform vec3 solarShadowExtent;
  uniform float solarShadowTanRadius;
  float getSolarShadow(sampler2D map, vec2 mapSize, float intensity, float bias, float unusedRadius, vec4 coord) {
    vec3 p = coord.xyz / coord.w;
    p.z += bias;
    if (p.z <= 0.0 || p.z >= 1.0 || any(lessThan(p.xy, vec2(0.0))) || any(greaterThan(p.xy, vec2(1.0)))) return 1.0;
    vec2 texel = 1.0 / mapSize;
    vec2 search = max(vec2(p.z * solarShadowExtent.z * solarShadowTanRadius) / solarShadowExtent.xy, texel);
    float blockers = 0.0, depths = 0.0;
    float center = unpackRGBAToDepth(texture2D(map, p.xy));
    if (center < p.z) { blockers = 1.0; depths = center; }
    for (int i = 0; i < 16; i++) {
      float fi = float(i) + 0.5, angle = fi * 2.39996323;
      vec2 offset = sqrt(fi / 16.0) * vec2(cos(angle), sin(angle));
      float d = unpackRGBAToDepth(texture2D(map, clamp(p.xy + offset * search, vec2(0.0), vec2(1.0))));
      if (d < p.z) { depths += d; blockers += 1.0; }
    }
    if (blockers == 0.0) return 1.0;
    float gap = max(0.0, p.z - depths / blockers) * solarShadowExtent.z;
    vec2 radius = max(vec2(gap * solarShadowTanRadius) / solarShadowExtent.xy, texel * 0.5);
    float visibility = 0.0;
    for (int i = 0; i < 32; i++) {
      float fi = float(i) + 0.5, angle = fi * 2.39996323;
      vec2 offset = sqrt(fi / 32.0) * vec2(cos(angle), sin(angle));
      float d = unpackRGBAToDepth(texture2D(map, clamp(p.xy + offset * radius, vec2(0.0), vec2(1.0))));
      visibility += step(p.z, d);
    }
    return mix(1.0, visibility / 32.0, intensity);
  }
`;

export function solarShadowUniforms(sun: THREE.DirectionalLight) {
  const c = sun.shadow.camera;
  return { solarShadowExtent: { value: new THREE.Vector3(c.right - c.left, c.top - c.bottom, c.far - c.near) },
    solarShadowTanRadius: { value: Math.tan(SOLAR_ANGULAR_RADIUS) } };
}

export function patchSolarShadow(shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }, sun: THREE.DirectionalLight) {
  Object.assign(shader.uniforms, solarShadowUniforms(sun));
  shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',
    `#include <shadowmap_pars_fragment>\n${solarShadowGLSL}`);
  // Only directional sunlight changes. Spot lamps keep Three.js's own shadow path.
  const replaceDirectional = (chunk: string) => chunk.replace(/getShadow\( directionalShadowMap/g, 'getSolarShadow( directionalShadowMap');
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', replaceDirectional(THREE.ShaderChunk.lights_fragment_begin));
  shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmask_pars_fragment>', replaceDirectional(THREE.ShaderChunk.shadowmask_pars_fragment));
}
