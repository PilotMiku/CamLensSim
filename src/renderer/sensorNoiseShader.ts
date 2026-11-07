/** Shared final-output sensor noise. Never write it into HDR or path accumulation. */
export const sensorNoiseShader = /* glsl */ `
  uniform vec2 noiseResolution;
  uniform float noiseSeed;
  uniform float shotVariance;
  uniform float readVariance;

  uint sensorHash(uint h) {
    h = (h ^ (h >> 16u)) * 0x7feb352du;
    h = (h ^ (h >> 15u)) * 0x846ca68bu;
    return h ^ (h >> 16u);
  }
  float sensorUniform(uint h) {
    return max((float(sensorHash(h) >> 8u) + 0.5) / 16777216.0, 0.0000000298023224);
  }
  vec3 sensorGaussian(vec2 pixel) {
    uvec2 p = uvec2(floor(pixel));
    uint base = p.x * 1973u + p.y * 9277u + uint(noiseSeed) * 26699u;
    float r1 = sqrt(-2.0 * log(sensorUniform(base)));
    float a1 = 6.28318530718 * sensorUniform(base + 1u);
    float r2 = sqrt(-2.0 * log(sensorUniform(base + 2u)));
    float a2 = 6.28318530718 * sensorUniform(base + 3u);
    return vec3(r1 * cos(a1), r1 * sin(a1), r2 * cos(a2));
  }
  vec3 applySensorNoise(vec3 color, vec2 uv) {
    vec3 signal = max(color, vec3(0.0));
    vec3 variance = signal * shotVariance + vec3(readVariance);
    vec3 noise = sensorGaussian(uv * noiseResolution) * sqrt(max(variance, vec3(0.0)));
    return max(signal + noise, vec3(0.0));
  }
`;
