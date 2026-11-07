import { describe, expect, it } from 'vitest';
import { SENSORS } from '../data/equipment';
import { fisheyeDiagonalDeg, fisheyeFieldOfViewDeg } from './projection';
import { calculateOptics } from '../optics/calculate';
import { DEFAULT_PARAMETERS, getLens } from '../data/equipment';

describe('fisheye projection', () => {
  it('covers 180 degrees across a sensor diameter of 2 sqrt(2) f', () => {
    expect(fisheyeFieldOfViewDeg(2 * Math.SQRT2 * 16, 16)).toBeCloseTo(180, 10);
    expect(fisheyeFieldOfViewDeg(32, 16)).toBeCloseTo(120, 10);
  });

  it('reports full-frame 16 mm edge-to-edge angles rather than half angles', () => {
    const o = calculateOptics({ ...DEFAULT_PARAMETERS, focalLengthMm: 16 }, SENSORS[0], getLens('fisheye-16'));
    expect(o.fisheyeHorizontalDeg).toBeCloseTo(136.915, 2);
    expect(o.fisheyeVerticalDeg).toBeCloseTo(88.097, 2);
    expect(o.fisheyeDiagonalDeg).toBeCloseTo(170.140, 2);
  });

  it('narrows the view with smaller sensors and longer focal lengths', () => {
    expect(fisheyeDiagonalDeg(16, SENSORS[1])).toBeLessThan(fisheyeDiagonalDeg(16, SENSORS[0]));
    expect(fisheyeDiagonalDeg(8, SENSORS[0])).toBeGreaterThan(fisheyeDiagonalDeg(16, SENSORS[0]));
    expect(fisheyeFieldOfViewDeg(100, 16)).toBe(360);
  });

  it('rejects invalid physical dimensions', () => {
    for (const value of [0, -1, Infinity, NaN]) {
      expect(() => fisheyeFieldOfViewDeg(value, 16)).toThrow(RangeError);
      expect(() => fisheyeFieldOfViewDeg(36, value)).toThrow(RangeError);
    }
  });

  it('includes rear-hemisphere directions in the medium-format diagonal', () => {
    const medium = SENSORS.find(sensor => sensor.id === 'medium-format')!;
    expect(fisheyeDiagonalDeg(16, medium)).toBeCloseTo(235.453943, 5);
    expect(fisheyeDiagonalDeg(16, medium) / 2).toBeGreaterThan(90);
  });
});
