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
      sunColor: { value: volume.sun.color.clone().multiplyScalar(volume.sun.intensity * 0.85) },
      nearPlane: { value: 0.1 }, farPlane: { value: 100 },
      maxDistance: { value: volume.distance }, density: { value: volume.density },
      groundHeight: { value: volume.groundHeight }, heightFalloff: { value: volume.heightFalloff },
      steps: { value: 64 }, shadowTexel: { value: new THREE.Vector2() },
      beamEnabled: { value: false }, tBeamShadow: { value: null },
      beamShadowMatrix: { value: new THREE.Matrix4() }, beamShadowTexel: { value: new THREE.Vector2() },
      beamPosition: { value: new THREE.Vector3() }, beamDirection: { value: new THREE.Vector3() },
      beamColor: { value: new THREE.Color() }, beamCone: { value: new THREE.Vector2() }, beamRange: { value: 1 },
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
      uniform bool beamEnabled;
      uniform sampler2D tBeamShadow;
      uniform mat4 beamShadowMatrix;
      uniform vec2 beamShadowTexel, beamCone;
      uniform vec3 beamPosition, beamDirection, beamColor;
      uniform float beamRange;
      float visibility(sampler2D shadowMap, mat4 matrix, vec2 texel, vec3 p) {
        vec4 light = matrix * vec4(p, 1.0);
        vec3 uv = light.xyz / light.w;
        if (uv.z <= 0.0 || uv.z >= 1.0 || any(lessThan(uv.xy, vec2(0.0))) || any(greaterThan(uv.xy, vec2(1.0)))) return 1.0;
        float sum = 0.0;
        for (int j = 0; j < 4; j++) {
          vec2 offset = vec2(float(j - (j / 2) * 2), float(j / 2)) - 0.5;
          float depth = unpackRGBAToDepth(texture2D(shadowMap, uv.xy + offset * texel));
          sum += step(uv.z - 0.00015, depth);
        }
        return sum * 0.25;
      }
      vec3 beamScattering(vec3 p, vec3 viewDirection) {
        if (!beamEnabled) return vec3(0.0);
        vec3 fromLight = p - beamPosition;
        float distanceM = length(fromLight);
        vec3 lightDirection = fromLight / max(distanceM, 0.001);
        float cone = smoothstep(beamCone.x, beamCone.y, dot(lightDirection, beamDirection));
        if (cone <= 0.0 || distanceM >= beamRange) return vec3(0.0);
        float cutoff = pow(clamp(1.0 - pow(distanceM / beamRange, 4.0), 0.0, 1.0), 2.0);
        float cosine = dot(viewDirection, -lightDirection);
        float g = 0.35;
        float phase = (1.0 - g * g) / (12.56637 * pow(1.0 + g * g - 2.0 * g * cosine, 1.5)) + 0.075;
        return beamColor * (cone * cutoff * phase / max(distanceM * distanceM, 0.04))
          * visibility(tBeamShadow, beamShadowMatrix, beamShadowTexel, p);
      }
      // Clip the view ray to the finite cone before marching. A narrow shaft must
      // not inherit the metre-wide steps of a distant landscape's atmosphere.
      vec2 beamInterval(vec3 origin, vec3 ray, float surfaceDistance) {
        vec3 offset = origin - beamPosition;
        float h = dot(offset, beamDirection), slope = dot(ray, beamDirection);
        float start = 0.0, end = min(surfaceDistance, maxDistance);
        if (abs(slope) < 0.00001) {
          if (h < 0.0 || h > beamRange) return vec2(0.0);
        } else {
          vec2 caps = vec2(-h, beamRange - h) / slope;
          start = max(start, min(caps.x, caps.y)); end = min(end, max(caps.x, caps.y));
        }
        float cosine2 = beamCone.x * beamCone.x;
        float a = slope * slope - cosine2;
        float b = 2.0 * (h * slope - cosine2 * dot(offset, ray));
        float c = h * h - cosine2 * dot(offset, offset);
        if (abs(a) < 0.00001) {
          if (abs(b) < 0.00001) { if (c < 0.0) return vec2(0.0); }
          else if (b > 0.0) start = max(start, -c / b);
          else end = min(end, -c / b);
        } else {
          float discriminant = b * b - 4.0 * a * c;
          if (discriminant < 0.0) { if (a < 0.0) return vec2(0.0); }
          else {
            float root = sqrt(discriminant);
            vec2 roots = vec2(-b - root, -b + root) / (2.0 * a);
            float entry = min(roots.x, roots.y), exit = max(roots.x, roots.y);
            if (a < 0.0) { start = max(start, entry); end = min(end, exit); }
            else if (slope > 0.0) start = max(start, exit);
            else end = min(end, entry);
          }
        }
        return end > start ? vec2(start, end) : vec2(0.0);
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
        // Fisheye scene depth is radial, including directions behind the camera.
        float distanceToSurface = fisheye ? viewDepth : viewDepth / max(-viewRay.z, 0.001);
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
        phase += 0.075;
        vec3 scattered = vec3(0.0);
        float transmission = 1.0;
        for (int i = 0; i < 64; i++) {
          if (i >= steps) break;
          vec3 p = origin + direction * ((float(i) + jitter) * stepM);
          float heightDensity = exp(-max(p.y - groundHeight, 0.0) * heightFalloff);
          float extinction = density * heightDensity;
          float attenuation = exp(-extinction * stepM);
          vec3 illumination = visibility(tShadow, shadowMatrix, shadowTexel, p) * sunColor * phase;
          scattered += transmission * (1.0 - attenuation) * illumination;
          transmission *= attenuation;
        }
        if (beamEnabled) {
          vec2 interval = beamInterval(origin, direction, distanceToSurface);
          if (interval.y > interval.x) {
            float beamStep = (interval.y - interval.x) / float(steps);
            float entryHeight = origin.y + direction.y * interval.x * 0.5;
            float beamTransmission = exp(-density * exp(-max(entryHeight - groundHeight, 0.0) * heightFalloff) * interval.x);
            for (int i = 0; i < 64; i++) {
              if (i >= steps) break;
              vec3 p = origin + direction * (interval.x + (float(i) + 0.5) * beamStep);
              float extinction = density * exp(-max(p.y - groundHeight, 0.0) * heightFalloff);
              float attenuation = exp(-extinction * beamStep);
              scattered += beamTransmission * (1.0 - attenuation) * beamScattering(p, direction);
              beamTransmission *= attenuation;
            }
          }
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
