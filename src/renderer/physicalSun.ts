import * as THREE from 'three';
import { ShapedAreaLight, type WebGLPathTracer } from 'three-gpu-pathtracer';
import { SOLAR_ANGULAR_RADIUS, SOLAR_PROXY_DISTANCE_M, solarRadiance } from '../optics/sun';

/** A remote disk uses the tracer's existing area sampling, shadow rays and MIS. No BVH mesh. */
export function createPhysicalSun(source: THREE.DirectionalLight) {
  const light = new ShapedAreaLight();
  light.isCircular = true;
  light.name = source.name || 'physical-sun';
  light.userData.physicalSun = true;
  light.userData.angularRadius = SOLAR_ANGULAR_RADIUS;
  const direction = new THREE.Vector3(), target = new THREE.Vector3();
  const uniforms = {
    physicalSolarDirection: { value: new THREE.Vector3() },
    physicalSolarRadiance: { value: new THREE.Color(0, 0, 0) },
    physicalSolarCosRadius: { value: Math.cos(SOLAR_ANGULAR_RADIUS) },
  };
  let signature = '';
  const sync = () => {
    source.updateWorldMatrix(true, false); source.target.updateWorldMatrix(true, false);
    target.setFromMatrixPosition(source.target.matrixWorld);
    direction.setFromMatrixPosition(source.matrixWorld).sub(target).normalize();
    if (direction.lengthSq() === 0) direction.set(0, 1, 0);
    const next = JSON.stringify([target.toArray(), direction.toArray(), source.color.toArray(), source.intensity, source.visible]);
    if (next === signature) return false;
    signature = next;
    light.position.copy(target).addScaledVector(direction, SOLAR_PROXY_DISTANCE_M);
    light.width = light.height = 2 * SOLAR_PROXY_DISTANCE_M * Math.tan(SOLAR_ANGULAR_RADIUS);
    light.color.copy(source.color);
    light.intensity = solarRadiance(Math.max(0, source.intensity));
    light.visible = source.visible;
    light.up.set(0, Math.abs(direction.y) > 0.99 ? 0 : 1, Math.abs(direction.y) > 0.99 ? 1 : 0);
    light.lookAt(target); light.updateMatrixWorld(true);
    uniforms.physicalSolarDirection.value.copy(direction);
    uniforms.physicalSolarRadiance.value.copy(light.color).multiplyScalar(light.visible ? light.intensity : 0);
    light.userData.sourceIrradiance = source.intensity;
    return true;
  };
  sync();
  return { light, uniforms, sync };
}

export type PhysicalSun = ReturnType<typeof createPhysicalSun>;

/** The library omits analytic lights on primary/transmitted rays. Supply the same disk
 * only in sampleBackground; reflected/indirect rays already hit the area light with MIS.
 * The environment and background textures themselves contain no solar disk.
 */
export function installSolarBackground(material: THREE.ShaderMaterial, sun: PhysicalSun) {
  const marker = /vec3 sampleBackground\(\s*vec3 direction,\s*vec2 uv\s*\)\s*\{/;
  if (!marker.test(material.fragmentShader)) throw new Error('光追库版本不兼容太阳背景采样');
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    if (!marker.test(shader.fragmentShader)) throw new Error('太阳背景着色器入口缺失');
    Object.assign(shader.uniforms, sun.uniforms);
    shader.fragmentShader = `uniform vec3 physicalSolarDirection;
uniform vec3 physicalSolarRadiance;
uniform float physicalSolarCosRadius;\n` + shader.fragmentShader.replace(marker,
      `$&\n if (any(greaterThan(physicalSolarRadiance, vec3(0.0))) && dot(normalize(direction), physicalSolarDirection) >= physicalSolarCosRadius) return physicalSolarRadiance;`);
  };
  material.customProgramCacheKey = () => `${previousKey}:physical-solar-background-v1`;
  material.needsUpdate = true;
}

/** Pinned three-gpu-pathtracer 0.0.24 adapter. Fail explicitly if its internal layout changes. */
export function installTracerSolarBackground(tracer: WebGLPathTracer, sun: PhysicalSun) {
  const internals = tracer as unknown as {
    _pathTracer?: { material: THREE.ShaderMaterial };
    _lowResPathTracer?: { material: THREE.ShaderMaterial };
  };
  const materials = [internals._pathTracer?.material, internals._lowResPathTracer?.material];
  if (materials.some(material => !material?.isShaderMaterial)) throw new Error('光追库不支持当前太阳采样适配');
  for (const material of materials) installSolarBackground(material!, sun);
}
