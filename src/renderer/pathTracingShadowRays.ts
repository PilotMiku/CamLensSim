import type { WebGLPathTracer } from 'three-gpu-pathtracer';
import type * as THREE from 'three';

const shadowRayFlag = /bool isShadowRay = state\.isShadowRay;/;

/** Next-event light/environment rays must respect non-shadow-casting glazing.
 * BVH face normals are already oriented against the incoming ray. Keep the
 * library's normal and transmission conventions intact, including backfaces. */
export function shadowRayCorrectionShader(source: string) {
  if (!shadowRayFlag.test(source)) throw new Error('光追库不兼容直接光阴影射线适配');
  return source.replace(shadowRayFlag, 'bool isShadowRay = true;');
}

function installShadowRayCorrection(material: THREE.ShaderMaterial) {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.fragmentShader = shadowRayCorrectionShader(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => `${previousKey}:direct-shadow-rays-v2`;
  material.needsUpdate = true;
}

export function installTracerShadowRayCorrection(tracer: WebGLPathTracer) {
  const internals = tracer as unknown as {
    _pathTracer?: { material: THREE.ShaderMaterial };
    _lowResPathTracer?: { material: THREE.ShaderMaterial };
  };
  const materials = [internals._pathTracer?.material, internals._lowResPathTracer?.material];
  if (materials.some(material => !material?.isShaderMaterial)) throw new Error('光追库不支持当前阴影射线适配');
  materials.forEach(material => installShadowRayCorrection(material!));
}
