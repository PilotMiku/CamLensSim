import * as THREE from 'three';
import { SOLAR_ANGULAR_RADIUS, solarRadiance } from '../optics/sun';

/** Camera-centred analytic sky: solar direction has no room-scale parallax.
 * xyww puts it at the far plane, independent of the camera clipping distance.
 */
export function createSolarBackground(scene: THREE.Scene, sun: THREE.DirectionalLight) {
  const sky = scene.environment;
  if (!(sky instanceof THREE.DataTexture)) return null;
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { tSky: { value: sky }, solarDirection: { value: new THREE.Vector3() },
      solarRadiance: { value: new THREE.Color() }, solarRadius: { value: SOLAR_ANGULAR_RADIUS },
      fisheye: { value: false }, sensorSize: { value: new THREE.Vector2(36, 24) }, focalMm: { value: 16 },
      cameraWorld: { value: new THREE.Matrix4() }, viewport: { value: new THREE.Vector4(0, 0, 1, 1) } },
    vertexShader: /* glsl */ `
      varying vec3 worldDirection;
      void main() {
        worldDirection = mat3(modelMatrix) * position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 worldDirection;
      uniform sampler2D tSky;
      uniform vec3 solarDirection, solarRadiance;
      uniform float solarRadius, focalMm;
      uniform bool fisheye;
      uniform vec2 sensorSize;
      uniform mat4 cameraWorld;
      uniform vec4 viewport;
      void main() {
        vec3 d = normalize(worldDirection);
        if (fisheye) {
          vec2 mm = ((gl_FragCoord.xy - viewport.xy) / viewport.zw * 2.0 - 1.0) * sensorSize * 0.5;
          float r = length(mm), theta = 2.0 * asin(min(r / (2.0 * focalMm), 1.0));
          vec3 ray = vec3(mm / max(r, 0.00001) * sin(theta), -cos(theta));
          d = normalize(mat3(cameraWorld) * ray);
        }
        vec2 uv = vec2(atan(d.z, d.x) / 6.28318530718 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
        vec3 base = texture2D(tSky, uv).rgb;
        float angle = acos(clamp(dot(d, solarDirection), -1.0, 1.0));
        float width = max(fwidth(angle), 0.00001);
        float disc = 1.0 - smoothstep(solarRadius - width * 0.5, solarRadius + width * 0.5, angle);
        if (all(lessThanEqual(solarRadiance, vec3(0.0)))) disc = 0.0;
        // This is a display proxy; FP16 raster HDR cannot store radiance above 65,504.
        vec3 color = mix(base, solarRadiance, disc);
        gl_FragColor = vec4(min(color, vec3(65000.0)), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  mesh.name = 'analytic-solar-background';
  mesh.userData.pathTracingExclude = true;
  mesh.frustumCulled = false; mesh.renderOrder = -10000; mesh.raycast = () => {};
  const position = new THREE.Vector3(), target = new THREE.Vector3();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getCurrentViewport(material.uniforms.viewport.value);
    material.uniforms.cameraWorld.value.copy(camera.matrixWorld);
    const fisheye = camera.userData.solarProjection;
    material.uniforms.fisheye.value = !!fisheye;
    if (fisheye) {
      material.uniforms.sensorSize.value.set(fisheye.widthMm, fisheye.heightMm);
      material.uniforms.focalMm.value = fisheye.focalMm;
    }
    camera.getWorldPosition(position);
    mesh.position.copy(mesh.parent ? mesh.parent.worldToLocal(position) : position);
    mesh.updateMatrixWorld(true);
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false);
    target.setFromMatrixPosition(sun.target.matrixWorld);
    material.uniforms.solarDirection.value.setFromMatrixPosition(sun.matrixWorld).sub(target).normalize();
    material.uniforms.solarRadiance.value.copy(sun.color).multiplyScalar(sun.visible ? solarRadiance(Math.max(0, sun.intensity)) : 0);
  };
  return mesh;
}
