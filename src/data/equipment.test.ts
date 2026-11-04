import { describe, expect, it } from 'vitest';
import { getLens, LENSES, minFocusMeters, snapAperture } from './equipment';

describe('lens library', () => {
  it('exposes every requested lens category', () => {
    const ids = new Set(LENSES.map((item) => item.id));
    for (const id of [
      'custom',
      'trinity-16-35',
      'trinity-24-70',
      'trinity-70-200',
      'tele-300',
      'tele-600',
      'prime-24',
      'prime-50-f12',
      'prime-85-f12',
      'ts-24',
      'ts-45',
      'fisheye-16',
      'mirror-500',
      'mirror-800',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('covers the custom 10–1200 mm f/0.95–32 range', () => {
    const custom = getLens('custom');
    expect(custom.minFocalMm).toBe(10);
    expect(custom.maxFocalMm).toBe(1200);
    expect(custom.minAperture).toBeCloseTo(0.95, 6);
    expect(custom.maxAperture).toBe(32);
  });

  it('keeps the mirror aperture fixed at f/8', () => {
    const mirror = getLens('mirror-500');
    expect(mirror.minAperture).toBe(8);
    expect(mirror.maxAperture).toBe(8);
    expect(snapAperture(2.8, mirror)).toBe(8);
  });

  it('snaps into third stops and supports f/0.95', () => {
    const custom = getLens('custom');
    expect(snapAperture(0.9, custom)).toBeCloseTo(0.95, 6);
    expect(snapAperture(1.0, custom)).toBe(1);
    expect(snapAperture(2.9, custom)).toBe(2.8);
  });

  it('raises the close-focus limit for long focal lengths', () => {
    const custom = getLens('custom');
    expect(minFocusMeters(custom, 24)).toBe(0.25);
    expect(minFocusMeters(custom, 1200)).toBeCloseTo(1.344, 5);
    expect(minFocusMeters(getLens('tele-600'), 600)).toBe(4.5);
  });
});
