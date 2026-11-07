import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OpticsReadout } from './OpticsReadout';
import { calculateOptics, formatMagnification } from '../optics/calculate';
import { getLens, getSensor } from '../data/equipment';
import { initialState, simulatorReducer } from '../state/simulator';

function readoutAt(focusDistanceM: number, focalLengthMm = 300) {
  const custom = simulatorReducer(initialState, { type: 'parameters', patch: { lensId: 'custom', focalLengthMm } });
  const state = simulatorReducer(custom, { type: 'focusDistance', value: focusDistanceM });
  const p = state.parameters;
  const optics = calculateOptics(p, getSensor(p.sensorId), getLens(p.lensId));
  const html = renderToStaticMarkup(createElement(OpticsReadout, { optics }));
  return { html, value: html.match(/data-testid="magnification"[^>]*>([^<]+)<\/span>/)?.[1] };
}

describe('magnification readout', () => {
  it('shows fractional, life-size and larger-than-life macro magnifications as multipliers', () => {
    expect(readoutAt(1.5).value).toBe('0.25×');
    expect(readoutAt(0.6).value).toBe('1×');
    const macro = readoutAt(0.45);
    expect(macro.value).toBe('2×');
    expect(macro.html).not.toContain('1:0');
  });

  it('keeps a useful reading at the custom lens close-focus limit', () => {
    expect(readoutAt(0, 1200).value).toBe('8.33×');
  });

  it('distinguishes finite far focus from infinity focus', () => {
    expect(readoutAt(100_000, 10).value).toBe('1e-7×');
    expect(readoutAt(Infinity).value).toBe('0×');
  });

  it('uses three significant digits without trailing zeros or rounding tiny positive values to zero', () => {
    expect(formatMagnification(0.012345)).toBe('0.0123×');
    expect(formatMagnification(1 / 3)).toBe('0.333×');
    expect(formatMagnification(1e-12)).toBe('1e-12×');
    expect(formatMagnification(2)).toBe('2×');
  });

  it('does not label invalid magnifications as zero', () => {
    for (const invalid of [NaN, Infinity, -Infinity, -1]) expect(formatMagnification(invalid)).toBe('—');
  });
});
