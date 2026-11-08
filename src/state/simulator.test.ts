import { describe, expect, it } from 'vitest';
import { axialDistance, cameraVerticalDistance, radialDistance } from '../domain/camera';
import { DEFAULT_POSE, snapAperture, getLens, getSensor } from '../data/equipment';
import { signedTiltBlurMm, workingFovDeg } from '../optics/calculate';
import { initialState, simulatorReducer } from './simulator';

describe('camera constraints', () => {
  it('enforces focal length and aperture limits when changing lenses', () => {
    const state = simulatorReducer(initialState, {
      type: 'parameters',
      patch: { lensId: 'prime-85', focalLengthMm: 24, aperture: 32 },
    });
    expect(state.parameters.focalLengthMm).toBe(85);
    expect(state.parameters.aperture).toBe(16);
    const prime50 = simulatorReducer(state, {
      type: 'parameters',
      patch: { lensId: 'prime-50', aperture: 1 },
    });
    expect(prime50.parameters.focalLengthMm).toBe(50);
    expect(prime50.parameters.aperture).toBe(1.8);
  });

  it('snaps the iris to third stops', () => {
    const lens = getLens('prime-50');
    expect(snapAperture(2.9, lens)).toBe(2.8);
    expect(snapAperture(1.85, lens)).toBe(1.8);
    const state = simulatorReducer(initialState, {
      type: 'parameters',
      patch: { aperture: 3.1 },
    });
    expect(state.parameters.aperture).toBe(3.2);
  });

  it('clamps the free camera and rejects non-finite state', () => {
    const state = simulatorReducer(initialState, {
      type: 'pose',
      patch: { x: 99, y: -4, z: -99, yawDeg: 540, pitchDeg: Number.NaN },
    });
    expect(state.parameters.pose.x).toBe(4);
    expect(state.parameters.pose.y).toBe(0.25);
    expect(state.parameters.pose.z).toBe(-2);
    expect(state.parameters.pose.yawDeg).toBe(-180);
    expect(state.parameters.pose.pitchDeg).toBe(0);
    const invalid = simulatorReducer(initialState, {
      type: 'parameters',
      patch: { focalLengthMm: Number.NaN, sensorId: 'unknown' },
    });
    expect(invalid.parameters.focalLengthMm).toBe(50);
    expect(invalid.parameters.sensorId).toBe('full-frame');
  });

  it('keeps the focus anchored to the world point while the camera moves', () => {
    const moved = simulatorReducer(initialState, {
      type: 'pose',
      patch: { z: DEFAULT_POSE.z + 1 },
    });
    expect(moved.parameters.focusTracking).toBe(true);
    // Stay inside the scene bounds: one metre of dolly changes axial focus by cos(pitch).
    const expected =
      initialState.parameters.focusDistanceM +
      Math.cos((Math.abs(DEFAULT_POSE.pitchDeg) * Math.PI) / 180);
    expect(moved.parameters.focusDistanceM).toBeCloseTo(expected, 5);
  });

  it('switches to manual focus when the distance is set directly', () => {
    const manual = simulatorReducer(initialState, { type: 'focusDistance', value: 1.2 });
    expect(manual.parameters.focusTracking).toBe(false);
    expect(manual.parameters.focusDistanceM).toBeCloseTo(1.2, 5);
    const moved = simulatorReducer(manual, { type: 'pose', patch: { z: 4 } });
    expect(moved.parameters.focusDistanceM).toBeCloseTo(1.2, 5);
    const tracked = simulatorReducer(moved, {
      type: 'parameters',
      patch: { focusTracking: true },
    });
    expect(tracked.parameters.focusDistanceM).not.toBeCloseTo(1.2, 2);
  });

  it('focuses at world points and respects the close-focus limit', () => {
    const focused = simulatorReducer(initialState, {
      type: 'focusAtPoint',
      point: { x: 0, y: 1.3, z: 0.4 },
    });
    const expected = axialDistance(DEFAULT_POSE, { x: 0, y: 1.3, z: 0.4 });
    expect(focused.parameters.focusDistanceM).toBeCloseTo(expected, 8);
    const tooClose = simulatorReducer(initialState, {
      type: 'focusDistance',
      value: 0.01,
    });
    expect(tooClose.parameters.focusDistanceM).toBe(0.45);
  });

  it('dollies with the subject distance and resets the rig', () => {
    const near = simulatorReducer(initialState, { type: 'subjectDistance', value: 3.2 });
    expect(near.parameters.pose.z).toBeCloseTo(3.2, 5);
    const reset = simulatorReducer(near, { type: 'resetCamera' });
    expect(reset.parameters.pose).toEqual(DEFAULT_POSE);
    expect(reset.parameters.focusTracking).toBe(true);
    const fullReset = simulatorReducer(
      simulatorReducer(near, { type: 'view', patch: { grid: true, quality: 'smooth' } }),
      { type: 'reset' },
    );
    expect(fullReset).toEqual(initialState);
  });
});

describe('far and infinity focus', () => {
  it('focuses on distant world points without clamping to 30 metres and keeps tracking', () => {
    const point = { x: 0, y: 1, z: -800 };
    const focused = simulatorReducer(initialState, { type: 'focusAtPoint', point });
    expect(focused.parameters.focusDistanceM).toBeCloseTo(axialDistance(DEFAULT_POSE, point), 8);
    const moved = simulatorReducer(focused, { type: 'pose', patch: { z: 5 } });
    expect(moved.parameters.focusDistanceM).toBeCloseTo(axialDistance(moved.parameters.pose, point), 8);
  });

  it('supports 100 km finite focus and retains infinity when moving or switching lenses', () => {
    const finite = simulatorReducer(initialState, { type: 'focusDistance', value: 100_000 });
    expect(finite.parameters.focusDistanceM).toBe(100_000);
    const infinity = simulatorReducer(finite, { type: 'focusDistance', value: Infinity });
    expect(infinity.parameters.focusDistanceM).toBe(Infinity);
    expect(infinity.parameters.focusTracking).toBe(false);
    expect(Object.values(infinity.parameters.focusPoint).every(Number.isFinite)).toBe(true);
    const moved = simulatorReducer(infinity, { type: 'pose', patch: { z: 5 } });
    const tele = simulatorReducer(moved, { type: 'parameters', patch: { lensId: 'tele-600' } });
    expect(tele.parameters.focusDistanceM).toBe(Infinity);
    for (const invalid of [NaN, -Infinity]) {
      expect(simulatorReducer(tele, { type: 'focusDistance', value: invalid }).parameters.focusDistanceM).toBe(Infinity);
    }
    const refocused = simulatorReducer(tele, { type: 'focusAtPoint', point: { x: 0, y: 1, z: -100 } });
    expect(refocused.parameters.focusDistanceM).toBeGreaterThan(100);
    expect(refocused.parameters.focusDistanceM).toBeLessThan(106);
    expect(simulatorReducer(tele, { type: 'resetCamera' }).parameters.focusDistanceM).not.toBe(Infinity);
  });
});


describe('tilt-shift autofocus', () => {
  const setup = () => simulatorReducer(simulatorReducer(initialState,
    { type: 'pose', patch: { x: 0, y: 1, z: 3, pitchDeg: 0, yawDeg: 0 } }),
    { type: 'parameters', patch: { lensId: 'ts-24', tiltDeg: 2, focusTracking: false } });

  it('focuses an off-axis point and keeps it on the tilted focus plane while moving', () => {
    const point = { x: 0, y: 0.8, z: 1 };
    const focused = simulatorReducer(setup(), { type: 'focusAtPoint', point });
    const tracked = simulatorReducer(focused, { type: 'parameters', patch: { focusTracking: true } });
    const moved = simulatorReducer(tracked, { type: 'pose', patch: { y: 1.1, z: 3.5, pitchDeg: -2, yawDeg: 5 } });
    for (const state of [focused, tracked, moved]) {
      const p = state.parameters, z = axialDistance(p.pose, point), y = cameraVerticalDistance(p.pose, point);
      expect(signedTiltBlurMm(p.focalLengthMm, p.aperture, p.focusDistanceM, p.tiltDeg, z, y / z)).toBeCloseTo(0, 10);
    }
    expect(focused.parameters.focusDistanceM).not.toBe(2);
    expect(moved.parameters.focusDistanceM).not.toBe(tracked.parameters.focusDistanceM);
  });

  it('rejects point selections beyond the hinge and preserves manual focus when changing tilt', () => {
    const state = setup();
    const outside = simulatorReducer(state, { type: 'focusAtPoint', point: { x: 0, y: 0, z: 1 } });
    expect(outside).toBe(state);
    const changed = simulatorReducer(state, { type: 'parameters', patch: { tiltDeg: -2 } });
    expect(changed.parameters.focusDistanceM).toBe(state.parameters.focusDistanceM);
    const normal = simulatorReducer(changed, { type: 'parameters', patch: { lensId: 'prime-50' } });
    expect(normal.parameters.tiltDeg).toBe(0);
  });
});


it('retains the ordinary close-focus limit when a tracked anchor moves behind the camera', () => {
  const state = simulatorReducer(initialState, { type: 'pose', patch: { yawDeg: 180 } });
  expect(state.parameters.focusDistanceM).toBe(getLens(state.parameters.lensId).minFocusM);
});

describe('fisheye radial focus', () => {
  it('focuses and tracks a rear-hemisphere target without clamping to the close-focus limit', () => {
    const fish = simulatorReducer(initialState, { type: 'parameters', patch: { lensId: 'fisheye-16', sensorId: 'medium-format' } });
    const p = fish.parameters.pose;
    const point = { x: p.x + 4, y: p.y + 2, z: p.z + 1 };
    expect(axialDistance(p, point)).toBeLessThan(0);
    const focused = simulatorReducer(fish, { type: 'focusAtPoint', point });
    expect(focused.parameters.focusDistanceM).toBeCloseTo(Math.sqrt(21), 10);
    const moved = simulatorReducer(focused, { type: 'pose', patch: { x: p.x + 1, yawDeg: 30 } });
    expect(moved.parameters.focusDistanceM).toBeCloseTo(radialDistance(moved.parameters.pose, point), 10);
    const turned = simulatorReducer(moved, { type: 'pose', patch: { yawDeg: 180, pitchDeg: 40 } });
    expect(turned.parameters.focusDistanceM).toBe(moved.parameters.focusDistanceM);
    const ordinary = simulatorReducer(turned, { type: 'parameters', patch: { lensId: 'prime-50' } });
    expect(ordinary.parameters.focusDistanceM).toBeCloseTo(Math.max(0.45, axialDistance(ordinary.parameters.pose, point)), 10);
  });
});

describe('same-framing format comparison', () => {
  const setup = () => simulatorReducer(initialState, { type: 'formatComparison', enabled: true });

  it('uses one custom iris and preserves horizontal framing, focus, aperture and exposure across formats', () => {
    const baseline = setup(), original = baseline.parameters;
    expect(original.lensId).toBe('custom');
    const width = workingFovDeg(36, original.focalLengthMm, original.focusDistanceM);
    let state = baseline;
    for (const sensorId of ['aps-c', 'm43', 'medium-format', 'full-frame']) {
      state = simulatorReducer(state, { type: 'parameters', patch: { sensorId } });
      const p = state.parameters, sensor = getSensor(sensorId);
      expect(p.sensorId).toBe(sensorId);
      expect(workingFovDeg(sensor.widthMm, p.focalLengthMm, p.focusDistanceM)).toBeCloseTo(width, 10);
      expect(p.focusDistanceM).toBe(original.focusDistanceM);
      expect(p.focusPoint).toEqual(original.focusPoint);
      expect(p.pose).toEqual(original.pose);
      expect([p.aperture, p.iso, p.shutterSeconds, p.focusTracking, p.constantExposure])
        .toEqual([original.aperture, original.iso, original.shutterSeconds, original.focusTracking, original.constantExposure]);
    }
    expect(state.parameters.focalLengthMm).toBeCloseTo(original.focalLengthMm, 10);
  });

  it('keeps fixed-focal cropping as the default and restores it after disabling comparison', () => {
    const ordinary = simulatorReducer(initialState, { type: 'parameters', patch: { sensorId: 'aps-c' } });
    expect(ordinary.parameters.focalLengthMm).toBe(50);
    const off = simulatorReducer(setup(), { type: 'formatComparison', enabled: false });
    expect(simulatorReducer(off, { type: 'parameters', patch: { sensorId: 'aps-c' } }).parameters.focalLengthMm).toBe(50);
  });

  it('supports infinity focus and declines an unachievable focal length without changing the sensor', () => {
    let state = simulatorReducer(setup(), { type: 'focusDistance', value: Infinity });
    state = simulatorReducer(state, { type: 'parameters', patch: { focalLengthMm: 10 } });
    expect(simulatorReducer(state, { type: 'parameters', patch: { sensorId: 'aps-c' } })).toBe(state);
    state = simulatorReducer(state, { type: 'parameters', patch: { focalLengthMm: 85 } });
    const cropped = simulatorReducer(state, { type: 'parameters', patch: { sensorId: 'aps-c' } });
    expect(cropped.parameters.focusDistanceM).toBe(Infinity);
    expect(cropped.parameters.focalLengthMm).toBeCloseTo(85 * 23.5 / 36, 10);
  });

  it('does not move a close focus distance to accommodate a larger sensor', () => {
    let state = simulatorReducer(initialState, { type: 'parameters', patch: { lensId: 'custom', sensorId: 'm43', focalLengthMm: 200 } });
    state = simulatorReducer(state, { type: 'focusDistance', value: 0.25 });
    state = simulatorReducer(state, { type: 'formatComparison', enabled: true });
    expect(simulatorReducer(state, { type: 'parameters', patch: { sensorId: 'medium-format' } })).toBe(state);
    expect(state.parameters.focusDistanceM).toBe(0.25);
  });

  it('exits comparison when choosing another lens, rejects special optics, and resets cleanly', () => {
    for (const lensId of ['prime-85', 'fisheye-16', 'ts-24', 'mirror-500']) {
      const changed = simulatorReducer(setup(), { type: 'parameters', patch: { lensId } });
      expect(changed.formatComparison).toBe(false);
      if (lensId !== 'prime-85') expect(simulatorReducer(changed, { type: 'formatComparison', enabled: true })).toBe(changed);
    }
    expect(simulatorReducer(setup(), { type: 'reset' })).toEqual(initialState);
    expect(simulatorReducer(setup(), { type: 'scene', id: 'portrait' }).formatComparison).toBe(true);
  });
});
