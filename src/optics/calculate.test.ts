import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS, SENSORS } from '../data/equipment';
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
      expect(() => workingImageDistanceMm(50, value)).toThrow(RangeError);
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