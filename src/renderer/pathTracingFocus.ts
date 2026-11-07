import * as THREE from 'three';
import type { WebGLPathTracer } from 'three-gpu-pathtracer';

const focalPoint = /vec3 focalPoint = ray\.origin \+ normalize\( ray\.direction \) \* physicalCamera\.focusDistance;/;
const apertureRay = /ray\.direction = focalPoint - ray\.origin;/;

/** Adapt the pinned tracer's radial, near-plane focus to axial thin-lens focus.
 * Construct the aperture at the camera, then advance the ray to the near plane.
 * Lens shift is already encoded in ray.direction and does not tilt the focus plane.
 */
export function planarFocusShader(source: string): string {
  if (!focalPoint.test(source) || !apertureRay.test(source)) throw new Error('光追库不兼容平面对焦模型');
  return source.replace(focalPoint, /* glsl */ `
    #if CAMERA_TYPE == 0
      vec3 lensOrigin = cameraWorldMatrix[3].xyz;
      vec3 forward = -normalize(cameraWorldMatrix[2].xyz);
      float nearDistance = dot(ray.origin - lensOrigin, forward);
      vec3 focalPoint = lensOrigin + normalize(ray.direction) *
        (physicalCamera.focusDistance / max(dot(normalize(ray.direction), forward), 1e-6));
      ray.origin = lensOrigin;
    #else
      $&
    #endif
  `).replace(apertureRay, /* glsl */ `
    $&
    #if CAMERA_TYPE == 0
      ray.direction = normalize(ray.direction);
      ray.origin += ray.direction * (nearDistance / max(dot(ray.direction, forward), 1e-6));
    #endif
  `);
}

export function installPlanarFocus(material: THREE.ShaderMaterial) {
  planarFocusShader(material.fragmentShader); // Fail before the first render if the library changes.
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.fragmentShader = planarFocusShader(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => `${previousKey}:planar-lens-focus-v1`;
  material.needsUpdate = true;
}

/** Both interactive and full-resolution tracers must use the same camera model. */
export function installTracerPlanarFocus(tracer: WebGLPathTracer) {
  const internals = tracer as unknown as {
    _pathTracer?: { material: THREE.ShaderMaterial };
    _lowResPathTracer?: { material: THREE.ShaderMaterial };
  };
  const materials = [internals._pathTracer?.material, internals._lowResPathTracer?.material];
  if (materials.some(material => !material?.isShaderMaterial)) throw new Error('光追库不支持当前对焦适配');
  for (const material of materials) installPlanarFocus(material!);
}
