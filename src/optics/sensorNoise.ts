import type { CameraParameters, SensorPreset } from '../domain/types';

/** Uncalibrated teaching sensor: equal 24 MP resolution, 2 e- input read noise.
 * Unit scene radiance at f/1.8, 1/125 s collects 12,000 e- on the reference sensor.
 * Scene radiance has no absolute photometric calibration; these are virtual values.
 */
export const REFERENCE_ELECTRONS = 12_000;
export const READ_NOISE_ELECTRONS = 2;

export function sensorNoiseCoefficients(
  parameters: Pick<CameraParameters, 'aperture' | 'shutterSeconds' | 'iso'>,
  sensor: Pick<SensorPreset, 'widthMm' | 'heightMm'>,
) {
  for (const value of [parameters.aperture, parameters.shutterSeconds, parameters.iso, sensor.widthMm, sensor.heightMm]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Invalid noise-model parameter');
  }
  const lightScale = parameters.shutterSeconds * 125 * (1.8 / parameters.aperture) ** 2;
  const areaScale = sensor.widthMm * sensor.heightMm / (36 * 24);
  const electronsPerRadiance = REFERENCE_ELECTRONS * lightScale * areaScale;
  return {
    lightScale, areaScale, electronsPerRadiance,
    isoGain: parameters.iso / 100,
    shotVariance: 1 / electronsPerRadiance,
    readVariance: (READ_NOISE_ELECTRONS / electronsPerRadiance) ** 2,
  };
}

/** Variance in pre-exposure linear scene-radiance units, before black clipping. */
export function sensorNoiseVariance(radiance: number, coefficients: { shotVariance: number; readVariance: number }) {
  return Math.max(0, radiance) * coefficients.shotVariance + coefficients.readVariance;
}

/** Same integer permutation as the shader; avoid precision-sensitive sin-based hashes. */
function hash32(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A reproducible Gaussian realization per virtual capture and output pixel. */
export function sensorNoiseGaussian(x: number, y: number, seed: number): [number, number, number] {
  const base = (Math.imul(x, 1973) + Math.imul(y, 9277) + Math.imul(seed, 26699)) >>> 0;
  const uniform = (offset: number) => ((hash32((base + offset) >>> 0) >>> 8) + 0.5) / 16777216;
  const r1 = Math.sqrt(-2 * Math.log(uniform(0))), a1 = 2 * Math.PI * uniform(1);
  const r2 = Math.sqrt(-2 * Math.log(uniform(2))), a2 = 2 * Math.PI * uniform(3);
  return [r1 * Math.cos(a1), r1 * Math.sin(a1), r2 * Math.cos(a2)];
}
