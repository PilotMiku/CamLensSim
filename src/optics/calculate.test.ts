import { describe, expect, it } from 'vitest';
import { APERTURE_STOPS, DEFAULT_PARAMETERS, SENSORS } from '../data/equipment';
import {
  blurCircleMm,
  calculateOptics,
  circleOfConfusionMm,
  cropFactor,
  depthOfField,
  diffractionCocMm,
  exposureScale,
  exposureValue,
  fieldOfViewDeg,
  formatDistance,
  formatEv,
  REFERENCE_EV100,
  workingFovDeg,
  workingImageDistanceMm,
} from './calculate';

describe('field of view and sensor equivalence', () => {
  it('matches the reference full-frame 50mm horizontal FOV', () => {
    expect(fieldOfViewDeg(36, 50)).toBeCloseTo(39.5977527, 6);
    expect(cropFactor(SENSORS[0])).toBe(1);
    expect(cropFactor(SENSORS[1])).toBeCloseTo(1.5339203, 6);
    expect(cropFactor(SENSORS[2])).toBeCloseTo(1.9993806, 6);
    expect(cropFactor(SENSORS[3])).toBeCloseTo(0.7898248, 5);
  });

  it('narrows FOV at longer focal lengths or smaller sensors', () => {
    expect(fieldOfViewDeg(36, 85)).toBeLessThan(fieldOfViewDeg(36, 50));
    expect(fieldOfViewDeg(23.5, 50)).toBeLessThan(fieldOfViewDeg(36, 50));
    const result = calculateOptics(DEFAULT_PARAMETERS, SENSORS[1]);
    expect(result.equivalentFocalMm).toBeCloseTo(50 * cropFactor(SENSORS[1]));
    expect(result.diagonalFovDeg).toBeGreaterThan(result.horizontalFovDeg);
    expect(result.horizontalFovDeg).toBeGreaterThan(result.verticalFovDeg);
  });

  it('models focus breathing through the image distance', () => {
    expect(workingImageDistanceMm(50, 2.4)).toBeCloseTo((50 * 2400) / 2350, 8);
    expect(workingFovDeg(36, 50, 2.4)).toBeLessThan(fieldOfViewDeg(36, 50));
    expect(workingFovDeg(36, 50, 1000)).toBeCloseTo(fieldOfViewDeg(36, 50), 1);
    expect(workingFovDeg(36, 200, 0.6)).toBeLessThan(workingFovDeg(36, 200, 30));
    const optics = calculateOptics(DEFAULT_PARAMETERS, SENSORS[0]);
    expect(optics.workingHorizontalFovDeg).toBeLessThan(optics.horizontalFovDeg);
    expect(optics.magnification).toBeGreaterThan(0);
  });

  it('rejects impossible dimensions', () => {
    for (const value of [0, -1, Infinity, NaN]) {
      expect(() => fieldOfViewDeg(value, 50)).toThrow(RangeError);
      expect(() => fieldOfViewDeg(36, value)).toThrow(RangeError);
      if (value !== Infinity) expect(() => workingImageDistanceMm(50, value)).toThrow(RangeError);
    }
    expect(() => workingImageDistanceMm(50, 0.02)).toThrow(RangeError);
  });
});

describe('diffraction and exposure', () => {
  it('derives the Airy disc from the aperture', () => {
    expect(diffractionCocMm(1.8)).toBeCloseTo(2.44 * 0.00055 * 1.8, 8);
    expect(diffractionCocMm(16)).toBeCloseTo(0.021472, 5);
    expect(diffractionCocMm(22)).toBeGreaterThan(diffractionCocMm(8));
    expect(() => diffractionCocMm(0)).toThrow(RangeError);
  });

  it('combines geometric and diffraction blur in the returned optics', () => {
    const wide = calculateOptics({ ...DEFAULT_PARAMETERS, aperture: 1.8 }, SENSORS[0]);
    const closed = calculateOptics({ ...DEFAULT_PARAMETERS, aperture: 16 }, SENSORS[0]);
    expect(closed.effectiveCocMm).toBeGreaterThan(closed.cocMm);
    expect(closed.effectiveCocMm).toBeGreaterThan(wide.effectiveCocMm);
    expect(closed.diffractionMm).toBeGreaterThan(wide.diffractionMm);
  });

  it('computes ISO-normalised exposure values', () => {
    expect(exposureValue(1.8, 1 / 125, 100)).toBeCloseTo(REFERENCE_EV100, 10);
    expect(exposureValue(1.8, 1 / 125, 200)).toBeCloseTo(REFERENCE_EV100 - 1, 10);
    expect(exposureValue(3.6, 1 / 125, 100)).toBeCloseTo(REFERENCE_EV100 + 2, 10);
    expect(exposureValue(1.8, 1 / 250, 100)).toBeCloseTo(REFERENCE_EV100 + 1, 10);
    expect(exposureScale(REFERENCE_EV100)).toBeCloseTo(1, 10);
    expect(exposureScale(REFERENCE_EV100 + 2)).toBeCloseTo(0.25, 10);
    expect(exposureScale(Number.NaN)).toBe(1);
    expect(formatEv(8.66)).toBe('8.7');
  });
});

describe('thin lens depth of field', () => {
  it('matches a manually calculable q=10,000mm reference', () => {
    const result = depthOfField(50, 10, 5, 0.025);
    expect(result.hyperfocalM).toBe(10.05);
    expect(result.nearM).toBeCloseTo(50000 / 14950, 10);
    expect(result.farM).toBeCloseTo(50000 / 5050, 10);
    expect(result.totalM).toBe(result.farM - result.nearM);
  });

  it('returns infinity at and beyond the hyperfocal distance', () => {
    const hyperfocal = depthOfField(50, 10, 5, 0.025).hyperfocalM;
    const result = depthOfField(50, 10, hyperfocal, 0.025);
    expect(result.farM).toBe(Infinity);
    expect(result.totalM).toBe(Infinity);
    expect(result.nearM).toBeCloseTo(hyperfocal / 2);
    expect(depthOfField(50, 10, hyperfocal * 2, 0.025).farM).toBe(Infinity);
    expect(formatDistance(result.farM)).toBe('∞');
  });

  it('agrees with the physical blur circle at near and far DOF boundaries', () => {
    const f = 85,
      aperture = 1.8,
      focus = 4;
    const coc = circleOfConfusionMm(SENSORS[0]);
    const { nearM, farM } = depthOfField(f, aperture, focus, coc);
    expect(blurCircleMm(f, aperture, focus, nearM)).toBeCloseTo(coc, 10);
    expect(blurCircleMm(f, aperture, focus, farM)).toBeCloseTo(coc, 10);
    expect(blurCircleMm(f, aperture, focus, focus)).toBe(0);
  });

  it('increases DOF when stopping down and decreases blur diameter', () => {
    expect(depthOfField(50, 8, 3, 0.03).totalM).toBeGreaterThan(
      depthOfField(50, 1.4, 3, 0.03).totalM,
    );
    expect(blurCircleMm(50, 1.4, 3, 8)).toBeGreaterThan(blurCircleMm(50, 8, 3, 8));
  });

  it('handles near-minimum focus and rejects invalid physical inputs', () => {
    const result = depthOfField(200, 1, 0.3, 0.025);
    expect(result.nearM).toBeGreaterThan(0.2);
    expect(result.farM).toBeGreaterThan(result.nearM);
    expect(() => depthOfField(200, 1, 0.2, 0.03)).toThrow(RangeError);
    expect(() => depthOfField(50, 0, 5, 0.03)).toThrow(RangeError);
    expect(() => depthOfField(50, 1.8, NaN, 0.03)).toThrow(RangeError);
    expect(() => depthOfField(50, 1.8, 5, -0.03)).toThrow(RangeError);
    expect(() => blurCircleMm(50, 1.8, 5, 0)).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('keeps useful precision for close and far distances', () => {
    expect(formatDistance(Infinity)).toBe('∞');
    expect(formatDistance(0.5)).toBe('0.50 m');
    expect(formatDistance(3.456)).toBe('3.46 m');
    expect(formatDistance(12.34)).toBe('12.3 m');
    expect(formatDistance(150.4)).toBe('150 m');
  });
});

describe('infinity focus', () => {
  it('uses the focal length as the infinity image distance', () => {
    expect(workingImageDistanceMm(600, Infinity)).toBe(600);
    expect(workingFovDeg(36, 600, Infinity)).toBe(fieldOfViewDeg(36, 600));
    const o = calculateOptics({ ...DEFAULT_PARAMETERS, focusDistanceM: Infinity }, SENSORS[0]);
    expect(o.magnification).toBe(0);
    expect(o.nearM).toBeCloseTo(o.hyperfocalM - 0.05, 10);
    expect(o.farM).toBe(Infinity);
    expect(o.totalM).toBe(Infinity);
    expect(Object.values(o).some(v => typeof v === 'number' && Number.isNaN(v))).toBe(false);
  });

  it('agrees with the finite-distance limit and the near DOF boundary', () => {
    for (const f of [24, 50, 600, 1200]) {
      const n = 4, c = 0.03;
      const dof = depthOfField(f, n, Infinity, c);
      expect(dof.nearM).toBeCloseTo(depthOfField(f, n, 1e13, c).nearM, 2);
      expect(blurCircleMm(f, n, Infinity, dof.nearM)).toBeCloseTo(c, 10);
      expect(blurCircleMm(f, n, Infinity, 10)).toBeCloseTo(blurCircleMm(f, n, 1e10, 10), 6);
      expect(blurCircleMm(f, n, 10, Infinity)).toBeCloseTo(blurCircleMm(f, n, 10, 1e10), 6);
      expect(blurCircleMm(f, n, Infinity, Infinity)).toBe(0);
    }
  });

  it('continues to reject negative infinity', () => {
    expect(() => workingImageDistanceMm(50, -Infinity)).toThrow(RangeError);
    expect(() => depthOfField(50, 4, -Infinity, 0.03)).toThrow(RangeError);
    expect(() => blurCircleMm(50, 4, Infinity, -Infinity)).toThrow(RangeError);
  });
});


describe('unclipped relative exposure', () => {
  it('continues doubling above the former 8x ceiling and halving below the 0.02x floor', () => {
    for (const scale of [1e-4, 0.005, 0.01, 0.02, 8, 16, 32, 1024]) {
      const ev = REFERENCE_EV100 - Math.log2(scale);
      expect(exposureScale(ev)).toBeCloseTo(scale, 8);
      expect(exposureScale(ev - 1) / exposureScale(ev)).toBeCloseTo(2, 10);
      expect(exposureScale(ev + 1) / exposureScale(ev)).toBeCloseTo(0.5, 10);
    }
  });

  it('retains one-stop relationships at extreme shutter, ISO and aperture settings', () => {
    const scale = (n: number, t: number, iso: number) => exposureScale(exposureValue(n, t, iso));
    expect(scale(0.95, 30, 25600) / scale(0.95, 15, 25600)).toBeCloseTo(2, 10);
    expect(scale(32, 1 / 4000, 50) / scale(32, 1 / 8000, 50)).toBeCloseTo(2, 10);
    expect(scale(32, 1 / 8000, 100) / scale(32, 1 / 8000, 50)).toBeCloseTo(2, 10);
    expect(scale(16, 1 / 8000, 50) / scale(32, 1 / 8000, 50)).toBeCloseTo(4, 10);
    expect(scale(0.95, 30, 25600)).toBeGreaterThan(3e6);
    expect(scale(32, 1 / 8000, 50)).toBeLessThan(0.00003);
  });

  it('keeps exposure representable as a positive GPU float throughout the supported controls', () => {
    for (const n of APERTURE_STOPS) for (const t of [1 / 8000, 1 / 125, 1, 30])
      for (const iso of [50, 100, 6400, 25600]) {
        const expected = (1.8 * 1.8 * 125) * t * (iso / 100) / (n * n);
        const actual = exposureScale(exposureValue(n, t, iso));
        expect(actual / expected).toBeCloseTo(1, 12);
        expect(Number.isFinite(Math.fround(0.85 * actual))).toBe(true);
        expect(Math.fround(0.85 * actual)).toBeGreaterThan(0);
      }
  });
});
