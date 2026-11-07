import { describe, expect, it } from 'vitest';
import { RENDER_QUALITY, RENDER_QUALITY_ORDER, qualityPixelRatio } from './renderQuality';
import { createDofDiskSamples } from '../renderer/dofSampling';
import { initialState, simulatorReducer } from '../state/simulator';

describe('four render quality levels', () => {
  it('exposes the requested order, labels and exact resolution percentages', () => {
    expect(RENDER_QUALITY_ORDER.map(id => [RENDER_QUALITY[id].label, RENDER_QUALITY[id].resolutionScale])).toEqual([
      ['精细', 1], ['均衡', 0.85], ['性能', 0.7], ['流畅', 0.5],
    ]);
  });

  it('scales both canvas dimensions once at standard and high pixel densities', () => {
    for (const dpr of [1, 2, 3]) {
      const dimensions = RENDER_QUALITY_ORDER.map(quality => {
        const ratio = qualityPixelRatio(quality, dpr);
        return [Math.floor(1000 * ratio), Math.floor(800 * ratio)];
      });
      const expected = [[1000 * dpr, 800 * dpr], [850 * dpr, 680 * dpr], [700 * dpr, 560 * dpr], [500 * dpr, 400 * dpr]];
      // GPU buffers have integer dimensions; floating-point multiplication can floor one pixel lower.
      dimensions.forEach((size, i) => size.forEach((value, axis) => {
        expect(Math.abs(value - expected[i][axis])).toBeLessThanOrEqual(1);
      }));
      RENDER_QUALITY_ORDER.forEach(quality => {
        expect(qualityPixelRatio(quality, dpr) / dpr).toBeCloseTo(RENDER_QUALITY[quality].resolutionScale, 14);
      });
    }
    for (const dpr of [NaN, Infinity, 0, -1]) expect(qualityPixelRatio('fine', dpr)).toBe(1);
  });

  it('supplies valid shader sampling budgets in every level', () => {
    for (const quality of RENDER_QUALITY_ORDER) {
      const profile = RENDER_QUALITY[quality];
      expect(createDofDiskSamples(profile.dofSamples)).toHaveLength(64);
      expect(profile.volumeSteps).toBeGreaterThan(0);
      expect(profile.volumeSteps).toBeLessThanOrEqual(64);
    }
  });

  it('retains balanced as the default and accepts every level through view state', () => {
    expect(initialState.view.quality).toBe('balanced');
    for (const quality of RENDER_QUALITY_ORDER) {
      const state = simulatorReducer(initialState, { type: 'view', patch: { quality } });
      expect(state.view.quality).toBe(quality);
      expect(state.parameters).toBe(initialState.parameters);
    }
  });
});
