import { describe, expect, it } from 'vitest';
import { axialDistance } from '../domain/camera';
import { DEFAULT_POSE, snapAperture, getLens } from '../data/equipment';
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
      simulatorReducer(near, { type: 'view', patch: { grid: true, quality: 'low' } }),
      { type: 'reset' },
    );
    expect(fullReset).toEqual(initialState);
  });
});