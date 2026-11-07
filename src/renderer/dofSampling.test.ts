import { describe, expect, it } from 'vitest';
import { createDofDiskSamples } from './dofSampling';

// CPU reference for the near layer's circular-aperture coverage integral.
// Compare against independent analytic silhouettes, not shader text or source snapshots.
function coverage(count: number, destinationX: number, destinationDepth: number,
  source: (x: number, y: number) => { radius: number; depth: number }, gather = 8) {
  let alpha = 0;
  for (const sample of createDofDiskSamples(count).slice(0, count)) {
    const dx = sample.x * gather, dy = sample.y * gather;
    const info = source(destinationX + dx, dy);
    if (info.radius <= 0.3 || info.depth > destinationDepth + Math.max(0.002, destinationDepth * 0.01)) continue;
    if (Math.hypot(dx, dy) > info.radius) continue;
    alpha += gather * gather / Math.max(info.radius * info.radius, 0.25) / count;
  }
  return Math.min(1, alpha);
}

for (const count of [14, 44]) describe(`${count}-sample near coverage`, () => {
  it('spreads a near silhouette onto a sharp background with fractional coverage', () => {
    const source = (x: number) => ({ radius: x < 0 ? 8 : 0, depth: x < 0 ? 1 : 3 });
    expect(coverage(count, 0, 3, source)).toBeCloseTo(0.5, 1);
    const expected = Math.acos(0.5) / Math.PI - 0.5 * Math.sqrt(0.75) / Math.PI;
    expect(Math.abs(coverage(count, 4, 3, source) - expected)).toBeLessThan(0.08);
    expect(coverage(count, 9, 3, source)).toBe(0);
    const values = [-4, -2, 0, 2, 4].map(x => coverage(count, x, 3, source));
    expect(values.every((v, i) => i === 0 || v <= values[i - 1])).toBe(true);
  });

  it('does not paint a deeper blurred surface over a closer sharp surface', () => {
    expect(coverage(count, 0, 0.5, () => ({ radius: 8, depth: 1 }))).toBe(0);
    expect(coverage(count, 0, 3, () => ({ radius: 0, depth: 1 }))).toBe(0);
  });

  it('preserves opaque coverage with local radius and area normalization', () => {
    for (const radius of [1, 2, 8, 28]) {
      expect(coverage(count, 0, 3, () => ({ radius, depth: 1 }), radius)).toBeCloseTo(1, 10);
    }
    // A twice-as-wide search must not dilute a source by the extra empty samples.
    expect(coverage(count, 0, 3, () => ({ radius: 4, depth: 1 }), 8)).toBeGreaterThan(0.85);
  });
});

it('keeps all active samples inside the disk and pads the GPU uniform array', () => {
  for (const count of [14, 44]) {
    const samples = createDofDiskSamples(count);
    expect(samples).toHaveLength(64);
    expect(samples.slice(0, count).every(p => Math.hypot(p.x, p.y) > 0 && Math.hypot(p.x, p.y) < 1)).toBe(true);
    expect(samples.slice(count).every(p => p.x === 0 && p.y === 0)).toBe(true);
  }
  for (const invalid of [0, 65, 1.5, Infinity, NaN]) expect(() => createDofDiskSamples(invalid)).toThrow(RangeError);
});
