import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS, getLens, SENSORS } from '../data/equipment';
import { blurCircleMm, calculateOptics, depthOfField, signedTiltBlurMm, tiltedAxisDepthOfField,
  tiltFocusDistanceForPoint, tiltFocusModel, workingImageDistanceMm } from './calculate';

describe('tilted ideal thin lens', () => {
  it('reduces to ordinary thin-lens CoC and DOF at zero tilt, including infinity', () => {
    for (const s of [0.4, 3, Infinity]) {
      for (const u of [0.3, 5, 100, Infinity]) {
        expect(Math.abs(signedTiltBlurMm(45, 2.8, s, 0, u, 0.2))).toBeCloseTo(blurCircleMm(45, 2.8, s, u), 10);
      }
      const actual = tiltedAxisDepthOfField(45, 2.8, s, 0, 0.03);
      const expected = depthOfField(45, 2.8, s, 0.03);
      expect(actual.nearM).toBeCloseTo(expected.nearM, 10);
      if (expected.farM === Infinity) expect(actual.farM).toBe(Infinity);
      if (Number.isFinite(expected.farM)) expect(actual.farM).toBeCloseTo(expected.farM, 10);
    }
  });

  it('meets the hinge rule and the common lens/sensor/focus-plane intersection', () => {
    for (const alpha of [-8.5, -1, 1, 8.5]) for (const s of [0.4, 3, 100, Infinity]) {
      const m = tiltFocusModel(24, s, alpha);
      const a = alpha * Math.PI / 180, v = m.imageDistanceMm / 1000;
      // Hinge on the front focal plane, at z=0, is independent of the focus setting.
      expect(m.hingeHeightM * -Math.sin(a)).toBeCloseTo(0.024, 12);
      const y = -v * Math.cos(a) / Math.sin(a), z = -v;
      // Lens plane: -sin(a)*y + cos(a)*z = 0. Sensor plane: z=-v.
      expect(-Math.sin(a) * y + Math.cos(a) * z).toBeCloseTo(0, 12);
      expect(m.inverseFocusM * z - m.gradientPerM * y).toBeCloseTo(1, 12);
    }
  });

  it('magnifies small lens tilts into large focus-plane tilts and reverses symmetrically', () => {
    const near = tiltFocusModel(24, 0.4, 1), far = tiltFocusModel(24, 3, 1);
    expect(far.planeTiltDeg).toBeGreaterThan(60);
    expect(far.planeTiltDeg).toBeLessThan(70);
    expect(far.planeTiltDeg).toBeGreaterThan(near.planeTiltDeg);
    expect(tiltFocusModel(24, 3, -1).planeTiltDeg).toBe(-far.planeTiltDeg);
    expect(tiltFocusModel(24, Infinity, 1).planeTiltDeg).toBe(90);
    expect(workingImageDistanceMm(24, Infinity, 1)).toBeGreaterThan(24);
  });

  it('focuses points on the plane and handles a horizontal plane at infinity focus', () => {
    const f = 24, a = 2, s = 3;
    const m = tiltFocusModel(f, s, a);
    for (const y of [-0.2, 0, 0.4]) {
      const z = s * (1 + m.gradientPerM * y);
      expect(signedTiltBlurMm(f, 3.5, s, a, z, y / z)).toBeCloseTo(0, 12);
      expect(tiltFocusDistanceForPoint(f, a, z, y)).toBeCloseTo(s, 10);
    }
    const hinge = tiltFocusModel(f, Infinity, a).hingeHeightM;
    for (const z of [0.5, 3, 100]) expect(signedTiltBlurMm(f, 3.5, Infinity, a, z, hinge / z)).toBeCloseTo(0, 12);
    expect(tiltFocusDistanceForPoint(f, a, 3, hinge - 0.1)).toBeNull();
  });

  it('matches the horizontal blur span from independent image-point and aperture-ray geometry', () => {
    const f = 0.045, alpha = 5 * Math.PI / 180, y = 0.15, z = 2;
    const v = workingImageDistanceMm(45, 3, 5) / 1000;
    const imageZ = -f * z / (Math.cos(alpha) * z - Math.sin(alpha) * y - f);
    const pupilRadius = f / (2 * 2.8);
    const left = -pupilRadius * (1 + v / imageZ), right = pupilRadius * (1 + v / imageZ);
    expect(Math.abs(signedTiltBlurMm(45, 2.8, 3, 5, z, y / z))).toBeCloseTo(Math.abs(right - left) * 1000, 10);
  });

  it('puts axis DOF boundaries at the stated blur threshold and labels the result', () => {
    for (const s of [0.4, 3, Infinity]) {
      const dof = tiltedAxisDepthOfField(24, 3.5, s, 8.5, 0.03);
      expect(Math.abs(signedTiltBlurMm(24, 3.5, s, 8.5, dof.nearM, 0))).toBeCloseTo(0.03, 10);
      if (Number.isFinite(dof.farM)) expect(Math.abs(signedTiltBlurMm(24, 3.5, s, 8.5, dof.farM, 0))).toBeCloseTo(0.03, 10);
    }
    const o = calculateOptics({ ...DEFAULT_PARAMETERS, focalLengthMm: 24, tiltDeg: 1, focusDistanceM: 3 }, SENSORS[0], getLens('ts-24'));
    expect(o.tilted).toBe(true);
    expect(o.focusPlaneTiltDeg).toBeGreaterThan(60);
    const normal = calculateOptics(DEFAULT_PARAMETERS, SENSORS[0], getLens('prime-50'));
    expect(normal.tilted).toBe(false);
  });
});
