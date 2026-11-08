import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS, getLens, SENSORS } from '../data/equipment';
import { blurCircleMm, calculateOptics, matchedFramingFocalMm, workingFovDeg } from './calculate';

const full = SENSORS[0], aps = SENSORS[1];

describe('sensor format equivalence', () => {
  it('keeps the actual horizontal field fixed at finite, macro and infinity focus', () => {
    for (const focus of [0.5, 3, 100000, Infinity]) for (const sensor of SENSORS) {
      const target = matchedFramingFocalMm(85, focus, full, sensor);
      expect(workingFovDeg(sensor.widthMm, target, focus)).toBeCloseTo(workingFovDeg(full.widthMm, 85, focus), 10);
      expect(matchedFramingFocalMm(target, focus, sensor, full)).toBeCloseTo(85, 10);
    }
    expect(matchedFramingFocalMm(85, Infinity, full, aps)).toBeCloseTo(85 * aps.widthMm / full.widthMm, 10);
    expect(matchedFramingFocalMm(85, 0.5, full, aps)).not.toBeCloseTo(85 * aps.widthMm / full.widthMm, 1);
  });

  it('reduces normalised background blur on smaller formats at the same framing, distance and f-number', () => {
    const focus = 3, aperture = 1.8;
    for (const sensor of [aps, SENSORS[2]]) {
      const focal = matchedFramingFocalMm(85, focus, full, sensor);
      const ratio = (focal / aperture) / (85 / aperture);
      for (const object of [1, 8, Infinity]) {
        const fullBlur = blurCircleMm(85, aperture, focus, object) / full.widthMm;
        const croppedBlur = blurCircleMm(focal, aperture, focus, object) / sensor.widthMm;
        expect(croppedBlur).toBeLessThan(fullBlur);
        expect(croppedBlur / fullBlur).toBeCloseTo(ratio, 10);
      }
    }
  });

  it('matches geometric blur when framing and entrance-pupil diameter are both held fixed', () => {
    const focus = 3, focal = matchedFramingFocalMm(85, focus, full, aps);
    const equivalentAperture = 1.8 * focal / 85;
    for (const object of [1, 8, Infinity]) {
      expect(blurCircleMm(focal, equivalentAperture, focus, object) / aps.widthMm)
        .toBeCloseTo(blurCircleMm(85, 1.8, focus, object) / full.widthMm, 10);
    }
  });

  it('reports pupil size and conventional DOF equivalence independently of exposure', () => {
    const fullOptics = calculateOptics(DEFAULT_PARAMETERS, full, getLens('prime-50'));
    const cropped = calculateOptics(DEFAULT_PARAMETERS, aps, getLens('prime-50'));
    expect(cropped.entrancePupilMm).toBe(fullOptics.entrancePupilMm);
    expect(fullOptics.entrancePupilMm).toBeCloseTo(50 / 1.8, 10);
    expect(fullOptics.equivalentDofAperture).toBe(1.8);
    expect(cropped.equivalentDofAperture).toBeCloseTo(1.8 * cropped.cropFactor, 10);
    expect(cropped.exposureScale).toBe(fullOptics.exposureScale);
    expect(cropped.ev100).toBe(fullOptics.ev100);
  });
});
