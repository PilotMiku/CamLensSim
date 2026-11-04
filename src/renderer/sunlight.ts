import * as THREE from 'three';
import type { SunlightVolume } from '../scenes/types';

/** Shadow-tested single scattering, integrated along the camera ray in world metres. */
export function createSunlightMaterial(volume: SunlightVolume) {
  return new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {
      tDepth: { value: null }, tShadow: { value: null },
      inverseProjection: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() },
      shadowMatrix: { value: new THREE.Matrix4() }, sunDirection: { value: new THREE.Vector3() },
      sunColor: { value: volume.sun.color.clone().multiplyScalar(volume.sun.intensity * 0.65) },
      nearPlane: { value: 0.1 }, farPlane: { value: 100 },
      maxDistance: { value: volume.distance }, density: { value: volume.density },
      groundHeight: { value: volume.groundHeight }, heightFalloff: { value: volume.heightFalloff },
      steps: { value: 48 }, shadowTexel: { value: new THREE.Vector2() },
      fisheye: { value: false }, sensorSize: { value: new THREE.Vector2(36, 24) }, focalMm: { value: 50 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      #include <packing>
      varying vec2 vUv;
      uniform sampler2D tDepth, tShadow;
      uniform mat4 inverseProjection, cameraWorld, shadowMatrix;
      uniform vec3 sunDirection, sunColor;
      uniform vec2 shadowTexel, sensorSize;
      uniform float nearPlane, farPlane, maxDistance, density, groundHeight, heightFalloff, focalMm;
      uniform bool fisheye;
      uniform int steps;
      float visibility(vec3 p) {
        vec4 light = shadowMatrix * vec4(p, 1.0);
        vec3 uv = light.xyz / light.w;
        if (uv.z <= 0.0 || uv.z >= 1.0 || any(lessThan(uv.xy, vec2(0.0))) || any(greaterThan(uv.xy, vec2(1.0)))) return 1.0;
        float sum = 0.0;
        for (int j = 0; j < 4; j++) {
          vec2 offset = vec2(float(j - (j / 2) * 2), float(j / 2)) - 0.5;
          float depth = unpackRGBAToDepth(texture2D(tShadow, uv.xy + offset * shadowTexel));
          sum += step(uv.z - 0.00015, depth);
        }
        return sum * 0.25;
      }
      void main() {
        vec2 ndc = vUv * 2.0 - 1.0;
        vec4 projected = inverseProjection * vec4(ndc, 1.0, 1.0);
        vec3 viewRay = normalize(projected.xyz / projected.w);
        if (fisheye) {
          vec2 mm = ndc * sensorSize * 0.5;
          float r = length(mm);
          float theta = 2.0 * asin(min(r / (2.0 * focalMm), 1.0));
          viewRay = vec3(mm / max(r, 0.00001) * sin(theta), -cos(theta));
        }
        float d = texture2D(tDepth, vUv).r;
        float viewDepth = nearPlane * farPlane / (farPlane - d * (farPlane - nearPlane));
        float distanceToSurface = viewDepth / max(-viewRay.z, 0.001);
        float distanceM = min(maxDistance, distanceToSurface);
        vec3 direction = normalize(mat3(cameraWorld) * viewRay);
        vec3 origin = cameraWorld[3].xyz;
        float stepM = distanceM / float(steps);
        // Stable spatial jitter avoids bands without temporal flicker or accumulation ghosts.
        float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float cosine = dot(direction, sunDirection);
        float g = 0.55;
        float phase = (1.0 - g * g) / (12.56637 * pow(1.0 + g * g - 2.0 * g * cosine, 1.5));
        // A little broad scattering keeps side-lit forest shafts legible.
        phase += 0.055;
        vec3 scattered = vec3(0.0);
        float transmission = 1.0;
        for (int i = 0; i < 64; i++) {
          if (i >= steps) break;
          vec3 p = origin + direction * ((float(i) + jitter) * stepM);
          float heightDensity = exp(-max(p.y - groundHeight, 0.0) * heightFalloff);
          float extinction = density * heightDensity;
          float attenuation = exp(-extinction * stepM);
          scattered += transmission * (1.0 - attenuation) * visibility(p) * sunColor * phase;
          transmission *= attenuation;
        }
        gl_FragColor = vec4(scattered, transmission);
      }
    `,
  });
}

/** Depth-aware upsampling prevents bright fog bleeding across silhouettes. */
export const sunlightComposite = /* glsl */ `
  uniform sampler2D tSunlight;
  uniform sampler2D tSunDepth;
  uniform bool sunlightEnabled;
  uniform vec2 sunlightSize;
  uniform vec2 sunlightPlanes;
  float sunlightDepth(vec2 uv) {
    float d = texture2D(tSunDepth, uv).r;
    return sunlightPlanes.x * sunlightPlanes.y / (sunlightPlanes.y - d * (sunlightPlanes.y - sunlightPlanes.x));
  }
  vec3 litColor(vec2 uv) {
    vec3 base = texture2D(tColor, uv).rgb;
    if (!sunlightEnabled) return base;
    float centerDepth = sunlightDepth(uv);
    vec2 pixel = uv * sunlightSize - 0.5;
    vec2 start = floor(pixel), fraction = fract(pixel);
    vec4 sum = vec4(0.0); float weights = 0.0;
    for (int j = 0; j < 4; j++) {
      vec2 corner = vec2(float(j - (j / 2) * 2), float(j / 2));
      vec2 sampleUv = (start + corner + 0.5) / sunlightSize;
      vec2 blend = mix(1.0 - fraction, fraction, corner);
      float weight = blend.x * blend.y / (1.0 + abs(sunlightDepth(sampleUv) - centerDepth) * 24.0);
      sum += texture2D(tSunlight, sampleUv) * weight;
      weights += weight;
    }
    vec4 volume = sum / max(weights, 0.00001);
    return base * volume.a + volume.rgb;
  }
`;
