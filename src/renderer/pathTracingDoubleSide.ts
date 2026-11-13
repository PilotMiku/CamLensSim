import type { WebGLPathTracer } from 'three-gpu-pathtracer';
import type * as THREE from 'three';

const faceNormalAssignment = /surf\.faceNormal = surfaceHit\.faceNormal;/;
const transmissiveRayCheck = /bool isTransmissiveRay = ! surf\.volumeParticle && dot\( scatterRec\.direction, surf\.faceNormal \* surfaceHit\.side \) < 0\.0;/;
const attenuateShadowRay = /bool isShadowRay = state\.isShadowRay;/;

/**
 * Ensures that:
 * 1. DoubleSide materials receive direct lighting (such as the sun) from both the front and back sides.
 *    In three-gpu-pathtracer, surf.normal is flipped on back-facing hits, but surf.faceNormal is not.
 *    This causes isDirectionValid and isSampleBelowSurface in directLightContribution to reject all
 *    direct light on back faces.
 * 2. Directly sampled shadow rays (attenuateHit) properly respect material.castShadow = false (such
 *    as window glazing), allowing direct sunlight to stream through windows without obstruction.
 */
export function doubleSideCorrectionShader(source: string): string {
  let patched = source;
  if (faceNormalAssignment.test(patched)) {
    patched = patched.replace(
      faceNormalAssignment,
      'surf.faceNormal = surfaceHit.faceNormal * surfaceHit.side;',
    );
  }
  if (transmissiveRayCheck.test(patched)) {
    patched = patched.replace(
      transmissiveRayCheck,
      'bool isTransmissiveRay = ! surf.volumeParticle && dot( scatterRec.direction, surf.faceNormal ) < 0.0;',
    );
  }
  if (attenuateShadowRay.test(patched)) {
    patched = patched.replace(
      attenuateShadowRay,
      'bool isShadowRay = true;',
    );
  }
  return patched;
}

export function installDoubleSideCorrection(material: THREE.ShaderMaterial) {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.fragmentShader = doubleSideCorrectionShader(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => `${previousKey}:doubleside-lighting-fix-v1`;
  material.needsUpdate = true;
}

/** Patches both the full-resolution and low-resolution path tracer materials. */
export function installTracerDoubleSideCorrection(tracer: WebGLPathTracer) {
  const internals = tracer as unknown as {
    _pathTracer?: { material: THREE.ShaderMaterial };
    _lowResPathTracer?: { material: THREE.ShaderMaterial };
  };
  const materials = [internals._pathTracer?.material, internals._lowResPathTracer?.material].filter(Boolean);
  if (materials.length === 0) return;
  if (materials.some(material => !material?.isShaderMaterial)) {
    throw new Error('光追库不支持当前双面光照适配');
  }
  for (const material of materials) {
    installDoubleSideCorrection(material!);
  }
}
