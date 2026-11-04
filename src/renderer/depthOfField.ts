import { sunlightComposite } from './sunlight';

/**
 * Physically motivated screen-space depth of field with optional tilt, fisheye
 * projection and annular (mirror lens) bokeh.
 *
 * The pipeline keeps the rendered frame in linear HDR, derives a signed
 * circle-of-confusion radius per pixel from the thin-lens model (combined with
 * the Airy diffraction spot), and gathers a polygonal aperture kernel. Sharp
 * pixels are always composited from the full-resolution frame, so a focused
 * foreground can never be smeared by the defocused background behind it.
 */

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Signed CoC radius from view-space depth and the tilted focal plane. */
const cocFunction = /* glsl */ `
  float cocRadiusMm(float depth, vec2 ndc, out float focusPlaneMm) {
    float uM = max(depth, 0.001);
    float halfH = tan(vFovRad * 0.5) * uM;
    float px = ndc.x * aspect * halfH;
    float py = ndc.y * halfH;
    // Focal plane normal, tilted around the horizontal (X) axis.
    float ny = -sin(tiltRad);
    float nz = -cos(tiltRad);
    float sM = focusM + (ny * py) / nz;
    focusPlaneMm = max(sM * 1000.0, focalMm + 1.0);
    float uMm = max(depth * 1000.0, 1.0);
    float denominator = aperture * uMm * (focusPlaneMm - focalMm);
    float geometric = denominator > 0.0
      ? focalMm * focalMm * abs(focusPlaneMm - uMm) / denominator
      : 0.0;
    return sqrt(geometric * geometric + diffractionMm * diffractionMm);
  }
`;

export const downsampleShader = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    ${sunlightComposite}
    uniform vec2 texel;
    varying vec2 vUv;
    void main() {
      vec2 o = texel * 0.5;
      vec3 color =
        litColor(vUv + vec2(-o.x, -o.y)) +
        litColor(vUv + vec2(o.x, -o.y)) +
        litColor(vUv + vec2(-o.x, o.y)) +
        litColor(vUv + vec2(o.x, o.y));
      gl_FragColor = vec4(color * 0.25, 1.0);
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
    uniform float focusM;
    uniform float sensorWidthMm;
    uniform float diffractionMm;
    uniform float fullWidthPx;
    uniform float tiltRad;
    uniform float vFovRad;
    uniform float aspect;
    varying vec2 vUv;

    float linearDepth(float depth) {
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
      float focusPlaneMm;
      float diameter = cocRadiusMm(depth, ndc, focusPlaneMm);
      float signedRadius = (depth * 1000.0 < focusPlaneMm ? -1.0 : 1.0) * 0.5 * diameter * fullWidthPx / sensorWidthMm;
      gl_FragColor = vec4(signedRadius, depth, 0.0, 1.0);
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
    uniform float blades;
    uniform float annular;
    varying vec2 vUv;

    const float TWO_PI = 6.28318530718;

    float cocAt(vec2 uv) {
      return texture2D(tCoc, clamp(uv, vec2(0.0), vec2(1.0))).r;
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

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

    void main() {
      vec3 center = texture2D(tHalfColor, vUv).rgb;
      float centerCoc = min(abs(cocAt(vUv)), maxRadius);
      if (centerCoc < 0.6) {
        gl_FragColor = vec4(center, 1.0);
        return;
      }
      float gather = centerCoc * 0.5;
      float rotation = hash12(vUv * 917.0) * TWO_PI;
      vec3 sum = center;
      float weightSum = 1.0;
      for (int i = 0; i < 64; i++) {
        if (i >= sampleCount) break;
        float fi = float(i) + 0.5;
        float radius = sqrt(fi / float(sampleCount)) * gather;
        float angle = fi * 2.39996323 + rotation;
        vec2 direction = vec2(cos(angle), sin(angle));
        vec2 uv = clamp(vUv + direction * radius * halfTexel, vec2(0.0), vec2(1.0));
        float sampleCoc = min(abs(cocAt(uv)), maxRadius) * 0.5;
        float coverage = sampleCoc - radius;
        float weight = smoothstep(-1.0, 1.0, coverage);
        weight *= apertureMask(direction, radius, sampleCoc, blades, annular);
        sum += texture2D(tHalfColor, uv).rgb * weight;
        weightSum += weight;
      }
      gl_FragColor = vec4(sum / weightSum, 1.0);
    }
  `,
};

export const compositeShader = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    ${sunlightComposite}
    uniform sampler2D tBlur;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float nearPlane;
    uniform float farPlane;
    uniform float focalMm;
    uniform float aperture;
    uniform float focusM;
    uniform float sensorWidthMm;
    uniform float diffractionMm;
    uniform float fullWidthPx;
    uniform bool dofEnabled;
    uniform float vignetteAmount;
    uniform float grainAmount;
    uniform float grainSeed;
    uniform float tiltRad;
    uniform float vFovRad;
    uniform float aspect;
    varying vec2 vUv;

    float linearDepth(float depth) {
      return nearPlane * farPlane / (farPlane - depth * (farPlane - nearPlane));
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    ${cocFunction}

    void main() {
      vec2 uv = vUv;
      vec3 sharp = litColor(uv);
      vec3 color = sharp;
      if (dofEnabled) {
        float depth = linearDepth(texture2D(tDepth, uv).r);
        vec2 ndc = uv * 2.0 - 1.0;
        float focusPlaneMm;
        float diameter = cocRadiusMm(depth, ndc, focusPlaneMm);
        float radiusPx = 0.5 * diameter * fullWidthPx / sensorWidthMm;
        float amount = smoothstep(0.55, 1.8, radiusPx);
        if (amount > 0.001) color = mix(sharp, texture2D(tBlur, uv).rgb, amount);
      }

      vec2 centered = vUv - 0.5;
      float radial = dot(centered, centered) * 2.0;
      color *= 1.0 - vignetteAmount * pow(clamp(radial, 0.0, 1.4), 1.35);

      float noise = hash12(vUv * resolution + grainSeed) - 0.5;
      color *= 1.0 + noise * grainAmount;

      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};
