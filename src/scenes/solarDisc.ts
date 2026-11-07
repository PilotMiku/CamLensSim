import * as THREE from 'three';
import { SOLAR_ANGULAR_RADIUS, solarRadiance } from '../optics/sun';

/** An independently rendered solar disc, paired with the authoritative light.
 * The mesh is an angular emitter at infinity: camera motion causes no parallax,
 * and the far-plane depth lets real scene geometry occlude the solar surface.
 * Path tracing samples the corresponding physical disk light, not this proxy.
 */
export function createSolarDisc(sun: THREE.DirectionalLight) {
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
    uniforms: {
      solarDirection: { value: new THREE.Vector3() }, solarRadiance: { value: new THREE.Color() },
      solarRadius: { value: SOLAR_ANGULAR_RADIUS },
      inverseProjection: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() },
      viewport: { value: new THREE.Vector4(0, 0, 1, 1) },
      fisheye: { value: false }, sensorSize: { value: new THREE.Vector2(36, 24) }, focalMm: { value: 16 },
    },
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 solarDirection, solarRadiance;
      uniform float solarRadius, focalMm;
      uniform mat4 inverseProjection, cameraWorld;
      uniform vec4 viewport;
      uniform bool fisheye;
      uniform vec2 sensorSize;
      void main() {
        if (all(lessThanEqual(solarRadiance, vec3(0.0)))) discard;
        vec2 ndc = (gl_FragCoord.xy - viewport.xy) / viewport.zw * 2.0 - 1.0;
        vec4 projected = inverseProjection * vec4(ndc, 1.0, 1.0);
        vec3 ray = normalize(projected.xyz / projected.w);
        if (fisheye) {
          vec2 mm = ndc * sensorSize * 0.5;
          float r = length(mm), theta = 2.0 * asin(min(r / (2.0 * focalMm), 1.0));
          ray = vec3(mm / max(r, 0.00001) * sin(theta), -cos(theta));
        }
        vec3 direction = normalize(mat3(cameraWorld) * ray);
        float angle = acos(clamp(dot(direction, solarDirection), -1.0, 1.0));
        float width = max(fwidth(angle), 0.00001);
        float coverage = 1.0 - smoothstep(solarRadius - width * 0.5, solarRadius + width * 0.5, angle);
        if (coverage <= 0.0) discard;
        // Raster HDR is FP16; the sampled path emitter retains uncapped FP32 radiance.
        gl_FragColor = vec4(min(solarRadiance, vec3(65000.0)), coverage);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.name = 'solar-disc';
  mesh.frustumCulled = false; mesh.renderOrder = -9999; mesh.raycast = () => {};
  mesh.userData.pathTracingExclude = true;
  mesh.userData.lightSourceId = sun.uuid;
  mesh.userData.angularRadius = SOLAR_ANGULAR_RADIUS;
  const target = new THREE.Vector3();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const u = material.uniforms;
    renderer.getCurrentViewport(u.viewport.value);
    u.inverseProjection.value.copy(camera.projectionMatrixInverse);
    u.cameraWorld.value.copy(camera.matrixWorld);
    const fisheye = camera.userData.solarProjection;
    u.fisheye.value = !!fisheye;
    if (fisheye) {
      u.sensorSize.value.set(fisheye.widthMm, fisheye.heightMm);
      u.focalMm.value = fisheye.focalMm;
    }
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false);
    target.setFromMatrixPosition(sun.target.matrixWorld);
    u.solarDirection.value.setFromMatrixPosition(sun.matrixWorld).sub(target).normalize();
    if (u.solarDirection.value.lengthSq() === 0) u.solarDirection.value.set(0, 1, 0);
    u.solarRadiance.value.copy(sun.color).multiplyScalar(sun.visible ? solarRadiance(Math.max(0, sun.intensity)) : 0);
  };
  return mesh;
}
