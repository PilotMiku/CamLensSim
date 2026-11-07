import { sensorNoiseShader } from './sensorNoiseShader';
import { sunlightComposite } from './sunlight';

/**
 * Physically motivated screen-space depth of field with optional tilt, fisheye
 * projection and annular (mirror lens) bokeh.
 *
 * The pipeline keeps the rendered frame in linear HDR, derives a signed
 * circle-of-confusion radius per pixel from the thin-lens model (combined with
 * the Airy diffraction spot), and gathers a polygonal aperture kernel. Sharp
 * pixels retain the full-resolution base. A separate premultiplied near layer
 * can cover that base, but deeper sources cannot blur over closer surfaces.
 * Hidden background is reconstructed from visible neighbours, not recovered.
 */

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Signed sensor CoC diameter from the shared thin-lens plane coefficients. */
const cocFunction = /* glsl */ `
  float signedCocDiameterMm(float depth, vec2 ndc) {
    // z/s - y*sin(alpha)/f = 1. Shift changes the sampled ray, not the focus plane.
    float inverseObjectM = depth == 1e20 ? 0.0 : 1.0 / max(depth, 0.001);
    float raySlopeY = (ndc.y + shiftY) * tan(vFovRad * 0.5);
    float geometric = (focalMm / aperture) * (imageDistanceMm / 1000.0)
      * (inverseFocusM - inverseObjectM - focusGradientPerM * raySlopeY);
    float signCoc = geometric < 0.0 ? -1.0 : 1.0;
    return signCoc * sqrt(geometric * geometric + diffractionMm * diffractionMm);
  }
`;

export const downsampleShader = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    ${sunlightComposite}
    uniform sampler2D tDepth;
    uniform float nearPlane, farPlane;
    uniform vec2 texel;
    varying vec2 vUv;
    float depthAt(vec2 uv) {
      float d = texture2D(tDepth, uv).r;
      return nearPlane * farPlane / (farPlane - d * (farPlane - nearPlane));
    }
    void main() {
      vec2 o = texel * 0.5;
      vec2 offsets[4];
      offsets[0] = vec2(-o.x, -o.y); offsets[1] = vec2(o.x, -o.y);
      offsets[2] = vec2(-o.x, o.y); offsets[3] = vec2(o.x, o.y);
      float nearest = min(min(depthAt(vUv + offsets[0]), depthAt(vUv + offsets[1])),
        min(depthAt(vUv + offsets[2]), depthAt(vUv + offsets[3])));
      vec3 sum = vec3(0.0); float weights = 0.0;
      for (int i = 0; i < 4; i++) {
        float weight = 1.0 - step(max(0.002, nearest * 0.01), abs(depthAt(vUv + offsets[i]) - nearest));
        sum += litColor(vUv + offsets[i]) * weight;
        weights += weight;
      }
      gl_FragColor = vec4(sum / max(weights, 1.0), 1.0);
    }
  `,
};

export const cocShader = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDepth;
    uniform vec2 texel;
    uniform float nearPlane;
    uniform float farPlane;
    uniform float focalMm;
    uniform float aperture;
    uniform float inverseFocusM;
    uniform float sensorWidthMm;
    uniform float diffractionMm;
    uniform float fullWidthPx;
    uniform float focusGradientPerM;
    uniform float imageDistanceMm;
    uniform float shiftY;
    uniform float vFovRad;
    uniform float aspect;
    varying vec2 vUv;

    float linearDepth(float depth) {
      if (depth >= 1.0) return 1e20;
      return nearPlane * farPlane / (farPlane - depth * (farPlane - nearPlane));
    }

    ${cocFunction}

    void main() {
      vec2 o = texel * 0.5;
      float d0 = linearDepth(texture2D(tDepth, vUv + vec2(-o.x, -o.y)).r);
      float d1 = linearDepth(texture2D(tDepth, vUv + vec2(o.x, -o.y)).r);
      float d2 = linearDepth(texture2D(tDepth, vUv + vec2(-o.x, o.y)).r);
      float d3 = linearDepth(texture2D(tDepth, vUv + vec2(o.x, o.y)).r);
      float depth = min(min(d0, d1), min(d2, d3));
      vec2 ndc = vUv * 2.0 - 1.0;
      float diameter = signedCocDiameterMm(depth, ndc);
      float signedRadius = 0.5 * diameter * fullWidthPx / sensorWidthMm;
      gl_FragColor = vec4(clamp(signedRadius, -65504.0, 65504.0), min(depth, farPlane), 0.0, 1.0);
    }
  `,
};

/** Shared aperture support and area, in half-resolution pixels. */
const apertureFunctions = /* glsl */ `
    const float TWO_PI = 6.28318530718;
    /** 1 inside the aperture polygon / annulus, 0 outside. */
    float apertureMask(vec2 direction, float distancePx, float radiusPx, float sides, float ring) {
      if (radiusPx <= 0.001) return 1.0;
      if (ring > 0.5) {
        float rn = distancePx / radiusPx;
        float inner = smoothstep(0.26, 0.42, rn);
        float outer = 1.0 - smoothstep(0.9, 1.0, rn);
        return inner * outer;
      }
      if (sides < 3.0) return 1.0;
      float sector = TWO_PI / sides;
      float angle = atan(-direction.y, -direction.x);
      float local = mod(angle + sector * 0.5, sector) - sector * 0.5;
      float limit = radiusPx * cos(sector * 0.5) / max(cos(local), 0.08);
      return 1.0 - smoothstep(limit - 0.75, limit + 0.75, distancePx);
    }


    float apertureAreaFraction(float sides, float ring) {
      // Approximate area of the smoothly feathered annulus, inner radius ~0.34.
      if (ring > 0.5) return 0.95 * 0.95 - 0.34 * 0.34;
      if (sides < 3.0) return 1.0;
      return sides * sin(TWO_PI / sides) / TWO_PI;
    }
`;

/** Conservative separable dilation of the near radius; no colors are dilated. */
export const nearRadiusShader = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tInput;
    uniform vec2 direction;
    uniform float radiusLimit;
    uniform bool fromCoc;
    varying vec2 vUv;
    void main() {
      float radius = 0.0;
      // The renderer caps the full-resolution radius at 56 px (28 half pixels).
      for (int i = -28; i <= 28; i++) {
        if (abs(float(i)) > ceil(radiusLimit)) continue;
        vec2 uv = clamp(vUv + float(i) * direction, vec2(0.0), vec2(1.0));
        float value = texture2D(tInput, uv).r;
        radius = max(radius, fromCoc ? min(max(-value * 0.5, 0.0), radiusLimit) : value);
      }
      gl_FragColor = vec4(radius, 0.0, 0.0, 1.0);
    }
  `,
};

/** Near colors and fractional coverage; RGB is premultiplied by alpha. */
export const foregroundShader = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tHalfColor, tCoc, tNearRadius;
    uniform vec2 halfTexel;
    uniform float maxRadius, blades, annular;
    uniform int sampleCount;
    uniform vec2 diskSamples[64];
    varying vec2 vUv;
    ${apertureFunctions}
    void main() {
      float gather = texture2D(tNearRadius, vUv).r;
      if (gather < 0.6) { gl_FragColor = vec4(0.0); return; }
      float centerDepth = texture2D(tCoc, vUv).g;
      vec3 sum = vec3(0.0);
      float weights = 0.0;
      float area = apertureAreaFraction(blades, annular);
      for (int i = 0; i < 64; i++) {
        if (i >= sampleCount) break;
        float distancePx = length(diskSamples[i]) * gather;
        vec2 direction = normalize(diskSamples[i]);
        vec2 uv = vUv + direction * distancePx * halfTexel;
        // Clamp-to-edge would invent repeated opaque foreground outside the frame.
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
        vec2 sampleInfo = texture2D(tCoc, uv).rg;
        if (sampleInfo.r >= -0.6 || sampleInfo.g > centerDepth + max(0.002, centerDepth * 0.01)) continue;
        float sourceRadius = min(-sampleInfo.r, maxRadius) * 0.5;
        if (distancePx > sourceRadius) continue;
        float support = apertureMask(direction, distancePx, sourceRadius, blades, annular);
        // Normalize by each source kernel's area, not the number of accepted samples.
        float weight = support * gather * gather / (max(sourceRadius * sourceRadius, 0.25) * area);
        sum += texture2D(tHalfColor, (floor(uv / halfTexel) + 0.5) * halfTexel).rgb * weight;
        weights += weight;
      }
      float alpha = clamp(weights / float(sampleCount), 0.0, 1.0);
      vec3 color = sum / max(weights, 0.00001);
      gl_FragColor = vec4(color * alpha, alpha);
    }
  `,
};

export const bokehShader = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tHalfColor;
    uniform sampler2D tCoc;
    uniform vec2 halfTexel;
    uniform float maxRadius;
    uniform int sampleCount;
    uniform vec2 diskSamples[64];
    uniform float blades;
    uniform float annular;
    varying vec2 vUv;

    ${apertureFunctions}

    void main() {
      vec3 center = texture2D(tHalfColor, vUv).rgb;
      vec2 centerInfo = texture2D(tCoc, vUv).rg;
      float centerCoc = min(abs(centerInfo.r), maxRadius);
      if (centerCoc < 0.6) { gl_FragColor = vec4(center, 1.0); return; }
      bool reconstruct = centerInfo.r < -0.6;
      float gather = (reconstruct ? maxRadius : centerCoc) * 0.5;
      vec3 sum = reconstruct ? vec3(0.0) : center;
      float weightSum = reconstruct ? 0.0 : 1.0;
      for (int i = 0; i < 64; i++) {
        if (i >= sampleCount) break;
        float radius = length(diskSamples[i]) * gather;
        vec2 direction = normalize(diskSamples[i]);
        vec2 uv = vUv + direction * radius * halfTexel;
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
        vec2 sampleInfo = texture2D(tCoc, uv).rg;
        // The foreground is composited separately and must not contaminate the base.
        if (sampleInfo.r < -0.6) continue;
        if (reconstruct && sampleInfo.g < centerInfo.g - max(0.002, centerInfo.g * 0.01)) continue;
        float sampleCoc = min(abs(sampleInfo.r), maxRadius) * 0.5;
        float weight = reconstruct ? 1.0 : smoothstep(-0.5, 0.5, sampleCoc - radius);
        if (!reconstruct) weight *= apertureMask(direction, radius, sampleCoc, blades, annular);
        sum += texture2D(tHalfColor, (floor(uv / halfTexel) + 0.5) * halfTexel).rgb * weight;
        weightSum += weight;
      }
      gl_FragColor = vec4(weightSum > 0.00001 ? sum / weightSum : center, 1.0);
    }
  `,
};

export const compositeShader = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    ${sunlightComposite}
    uniform sampler2D tBlur;
    uniform sampler2D tForeground, tCoc;
    uniform vec2 halfSize;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float nearPlane;
    uniform float farPlane;
    uniform float focalMm;
    uniform float aperture;
    uniform float inverseFocusM;
    uniform float sensorWidthMm;
    uniform float diffractionMm;
    uniform float fullWidthPx;
    uniform bool dofEnabled;
    uniform float vignetteAmount;
    ${sensorNoiseShader}
    uniform float focusGradientPerM;
    uniform float imageDistanceMm;
    uniform float shiftY;
    uniform float vFovRad;
    uniform float aspect;
    varying vec2 vUv;

    float linearDepth(float depth) {
      if (depth >= 1.0) return 1e20;
      return nearPlane * farPlane / (farPlane - depth * (farPlane - nearPlane));
    }

    ${cocFunction}

    vec4 foregroundAt(vec2 uv, float fullDepth) {
      vec2 pixel = uv * halfSize - 0.5;
      vec2 start = floor(pixel), fraction = fract(pixel);
      vec4 sum = vec4(0.0); float weights = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 corner = vec2(float(i - (i / 2) * 2), float(i / 2));
        vec2 sampleUv = (start + corner + 0.5) / halfSize;
        vec2 blend = mix(1.0 - fraction, fraction, corner);
        float weight = blend.x * blend.y;
        float sampleDepth = texture2D(tCoc, sampleUv).g;
        // Do not upsample a layer gathered for a deeper destination onto a closer surface.
        if (sampleDepth > fullDepth + max(0.002, fullDepth * 0.01)) continue;
        sum += texture2D(tForeground, sampleUv) * weight;
        weights += weight;
      }
      return sum / max(weights, 0.00001);
    }

    void main() {
      vec2 uv = vUv;
      vec3 sharp = litColor(uv);
      vec3 color = sharp;
      if (dofEnabled) {
        float depth = linearDepth(texture2D(tDepth, uv).r);
        vec2 ndc = uv * 2.0 - 1.0;
        float diameter = abs(signedCocDiameterMm(depth, ndc));
        float radiusPx = 0.5 * diameter * fullWidthPx / sensorWidthMm;
        float amount = smoothstep(0.55, 1.8, radiusPx);
        if (amount > 0.001) color = mix(sharp, texture2D(tBlur, uv).rgb, amount);
        vec4 foreground = foregroundAt(uv, depth);
        color = color * (1.0 - foreground.a) + foreground.rgb;
      }

      vec2 centered = vUv - 0.5;
      float radial = dot(centered, centered) * 2.0;
      color *= 1.0 - vignetteAmount * pow(clamp(radial, 0.0, 1.4), 1.35);

      color = applySensorNoise(color, vUv);

      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};
