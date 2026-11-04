import { describe, expect, it } from 'vitest';
import { SENSORS } from '../data/equipment';
import { fisheyeDiagonalDeg } from './projection';

describe('fisheye projection', () => {
  it('covers the full-frame diagonal with an equisolid mapping', () => {
    const diagonal = Math.hypot(36, 24);
    const expected = (2 * Math.asin(Math.min(diagonal / (4 * 16), 1)) * 180) / Math.PI;
    expect(fisheyeDiagonalDeg(16, SENSORS[0])).toBeCloseTo(expected, 8);
    expect(fisheyeDiagonalDeg(16, SENSORS[0])).toBeGreaterThan(80);
    expect(fisheyeDiagonalDeg(16, SENSORS[0])).toBeLessThan(90);
    // A shorter focal length covers a wider field.
    expect(fisheyeDiagonalDeg(8, SENSORS[0])).toBeGreaterThan(fisheyeDiagonalDeg(16, SENSORS[0]));
  });
});
