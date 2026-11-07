import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS, SENSORS, APERTURE_STOPS } from '../data/equipment';
import { exposureScale, exposureValue } from './calculate';
import { sensorNoiseCoefficients, sensorNoiseVariance, sensorNoiseGaussian } from './sensorNoise';

const coefficients = (patch = {}, sensor = SENSORS[0]) => sensorNoiseCoefficients({ ...DEFAULT_PARAMETERS, ...patch }, sensor);

describe('virtual sensor photon/read noise', () => {
  it('uses the photon-transfer variance law and retains a signal-independent read floor', () => {
    const c = coefficients();
    expect(c.electronsPerRadiance).toBe(12000);
    expect(sensorNoiseVariance(0, c)).toBe(c.readVariance);
    expect(sensorNoiseVariance(2, c) - sensorNoiseVariance(1, c)).toBeCloseTo(1 / 12000, 12);
    expect(Math.sqrt(sensorNoiseVariance(0.01, c)) / 0.01).toBeGreaterThan(Math.sqrt(sensorNoiseVariance(1, c)));
  });

  it('collects photons through time, aperture and virtual pixel area, independently of ISO', () => {
    expect(coefficients({ shutterSeconds: 1 / 250 }).electronsPerRadiance).toBe(6000);
    expect(coefficients({ aperture: 3.6 }).electronsPerRadiance).toBe(3000);
    const small = coefficients({}, SENSORS[2]);
    expect(small.electronsPerRadiance / coefficients().electronsPerRadiance).toBeCloseTo(17.3 * 13 / 864, 12);
    expect(sensorNoiseVariance(1, small)).toBeGreaterThan(sensorNoiseVariance(1, coefficients()));
    for (const iso of [50, 100, 6400, 12800, 25600]) {
      const c = coefficients({ iso });
      expect(c.shotVariance).toBe(coefficients().shotVariance);
      expect(c.readVariance).toBe(coefficients().readVariance);
      expect(c.isoGain).toBe(iso / 100);
    }
  });

  it('amplifies signal and noise together at fixed photon exposure', () => {
    const c = coefficients(), source = 0.18, variance = sensorNoiseVariance(source, c);
    const outputSNR = (iso: number) => {
      const gain = exposureScale(exposureValue(1.8, 1 / 125, iso));
      return source * gain / Math.sqrt(variance * gain * gain);
    };
    expect(outputSNR(25600)).toBeCloseTo(outputSNR(100), 12);
  });

  it('keeps getting noisier beyond ISO 6400 when shutter compensates for equal output brightness', () => {
    let previous = 0;
    for (const iso of [100, 6400, 12800, 25600]) {
      const t = (1 / 125) * 100 / iso;
      const c = coefficients({ iso, shutterSeconds: t });
      expect(exposureScale(exposureValue(1.8, t, iso))).toBeCloseTo(1, 10);
      const variance = sensorNoiseVariance(0.18, c);
      expect(variance).toBeGreaterThan(previous);
      previous = variance;
    }
  });

  it('stays finite at all supported sensor/aperture/shutter/ISO extremes', () => {
    for (const sensor of SENSORS) for (const aperture of APERTURE_STOPS)
      for (const shutterSeconds of [1 / 8000, 30]) for (const iso of [50, 25600]) {
        const c = coefficients({ aperture, shutterSeconds, iso }, sensor);
        for (const value of [c.shotVariance, c.readVariance, sensorNoiseVariance(65504, c)]) {
          expect(Number.isFinite(Math.fround(value))).toBe(true);
          expect(value).toBeGreaterThan(0);
        }
      }
    for (const patch of [{ iso: Infinity }, { aperture: 0 }, { shutterSeconds: NaN }]) expect(() => coefficients(patch)).toThrow(RangeError);
  });
});

describe('capture noise realization', () => {
  it('is deterministic within a capture and changes between captures', () => {
    expect(sensorNoiseGaussian(30, 20, 17)).toEqual(sensorNoiseGaussian(30, 20, 17));
    expect(sensorNoiseGaussian(30, 20, 18)).not.toEqual(sensorNoiseGaussian(30, 20, 17));
    expect(sensorNoiseGaussian(31, 20, 17)).not.toEqual(sensorNoiseGaussian(30, 20, 17));
    expect(sensorNoiseGaussian(0, 0, 0).every(Number.isFinite)).toBe(true);
  });

  it('has near-zero mean, unit variance and weak cross-channel correlation over a uniform patch', () => {
    const mean = [0, 0, 0], moment = [0, 0, 0];
    let cross = 0;
    const count = 256 * 128;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
      const values = sensorNoiseGaussian(x, y, 17);
      for (let c = 0; c < 3; c++) { mean[c] += values[c] / count; moment[c] += values[c] ** 2 / count; }
      cross += values[0] * values[1] / count;
    }
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(mean[c])).toBeLessThan(0.025);
      expect(Math.abs(moment[c] - mean[c] ** 2 - 1)).toBeLessThan(0.04);
    }
    expect(Math.abs(cross - mean[0] * mean[1])).toBeLessThan(0.025);
  });
});
