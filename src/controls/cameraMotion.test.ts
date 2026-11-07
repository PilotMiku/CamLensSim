import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE_LIMITS, forwardVector, wrapDegrees } from '../domain/camera';
import { advanceCameraMotion, type CameraMotionTarget } from './cameraMotion';

const pose = { x: 0, y: 1.3, z: 4.6, yawDeg: 0, pitchDeg: 0 };
const stopped = { forward: 0, strafe: 0, rise: 0 };
const forward = { ...stopped, forward: 1.55, yaw: 0, pitch: 0 };

function simulate(frameSeconds: number[], target: CameraMotionTarget = forward) {
  let state = { pose, velocity: stopped };
  for (const seconds of frameSeconds) state = advanceCameraMotion(state.pose, state.velocity, target, seconds, DEFAULT_POSE_LIMITS);
  return state;
}

describe('camera movement under slow rendering', () => {
  it('preserves the same elapsed movement at 60 FPS, 2 FPS and after one delayed frame', () => {
    const expectedDistance = 1.55 * (2 - (1 - Math.exp(-11 * 2)) / 11);
    for (const frames of [Array(120).fill(1 / 60), Array(4).fill(0.5), [2], [0.03, 0.07, 1.9]]) {
      const result = simulate(frames);
      expect(pose.z - result.pose.z).toBeCloseTo(expectedDistance, 10);
      expect(result.velocity.forward).toBeCloseTo(1.55 * (1 - Math.exp(-22)), 10);
    }
  });

  it('integrates a release smoothly without overshooting the stopping distance', () => {
    const velocity = { ...stopped, forward: 1.55 };
    const released = advanceCameraMotion(pose, velocity, { ...stopped, yaw: 0, pitch: 0 }, 1, DEFAULT_POSE_LIMITS);
    expect(pose.z - released.pose.z).toBeCloseTo(1.55 * (1 - Math.exp(-11)) / 11, 10);
    expect(released.velocity.forward).toBeCloseTo(1.55 * Math.exp(-11), 10);
  });

  it('keeps turning movement consistent between long and short frames', () => {
    const target = { ...forward, yaw: 68, rise: 0.2, pitch: 4 };
    const fast = simulate(Array(60).fill(1 / 60), target);
    const slow = simulate([0.5, 0.5], target);
    expect(slow.pose.yawDeg).toBeCloseTo(fast.pose.yawDeg, 10);
    expect(slow.pose.pitchDeg).toBeCloseTo(fast.pose.pitchDeg, 10);
    expect(Math.hypot(slow.pose.x - fast.pose.x, slow.pose.y - fast.pose.y, slow.pose.z - fast.pose.z)).toBeLessThan(0.002);
    expect(forwardVector(slow.pose).z).toBeLessThan(0);
  });

  it('respects scene bounds and rejects invalid elapsed time', () => {
    const long = simulate([20]);
    expect(long.pose.z).toBe(DEFAULT_POSE_LIMITS.minZ);
    for (const seconds of [0, -1, Infinity, NaN]) expect(simulate([seconds])).toEqual({ pose, velocity: stopped });
  });

  it('keeps turn direction across both yaw wrap boundaries in a delayed frame', () => {
    for (const [start, rate] of [[175, 68], [-175, -68]]) {
      const result = advanceCameraMotion({ ...pose, yawDeg: start }, stopped,
        { ...stopped, yaw: rate, pitch: 0 }, 0.25, DEFAULT_POSE_LIMITS);
      expect(Math.sign(result.pose.yawDeg)).toBe(-Math.sign(start));
      expect(wrapDegrees(result.pose.yawDeg - start)).toBeCloseTo(rate * 0.25, 10);
    }
  });
});
