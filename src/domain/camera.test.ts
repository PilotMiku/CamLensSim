import { describe, expect, it } from 'vitest';
import {
  axialDistance,
  axialDistanceOrNull,
  cameraVerticalDistance,
  clampPose,
  forwardVector,
  pointOnAxis,
  rotateCamera,
  subjectDistance,
  translateCamera,
  withSubjectDistance,
} from './camera';
import type { CameraPose } from './types';

const pose: CameraPose = { x: 0, y: 1.3, z: 2.4, yawDeg: 0, pitchDeg: 0 };

describe('camera pose', () => {
  it('points down -Z at zero yaw and turns left with positive yaw', () => {
    const forward = forwardVector(pose);
    expect(forward.x).toBeCloseTo(0, 10);
    expect(forward.y).toBeCloseTo(0, 10);
    expect(forward.z).toBeCloseTo(-1, 10);
    const left = forwardVector({ ...pose, yawDeg: 90 });
    expect(left.x).toBeCloseTo(-1, 10);
    expect(left.z).toBeCloseTo(0, 10);
    const up = forwardVector({ ...pose, pitchDeg: 30 });
    expect(up.y).toBeCloseTo(0.5, 10);
    expect(up.z).toBeCloseTo(-Math.cos(Math.PI / 6), 10);
  });

  it('measures axial distance and places points back on the axis', () => {
    const distance = axialDistance(pose, { x: 0, y: 1.3, z: -0.6 });
    expect(distance).toBeCloseTo(3, 10);
    expect(axialDistance(pose, { x: 0, y: 1.3, z: 4 })).toBeLessThan(0);
    expect(axialDistanceOrNull(pose, { x: 0, y: 1.3, z: 4 })).toBeNull();
    const point = pointOnAxis(pose, 2);
    expect(point.z).toBeCloseTo(0.4, 10);
    expect(axialDistance(pose, point)).toBeCloseTo(2, 10);
  });

  it('translates in the horizontal camera frame and clamps to the room', () => {
    const moved = translateCamera(pose, 1, 0.5, 0.2);
    expect(moved.z).toBeCloseTo(1.4, 10);
    expect(moved.x).toBeCloseTo(0.5, 10);
    expect(moved.y).toBeCloseTo(1.5, 10);
    const clamped = translateCamera(pose, 100, 100, 100);
    expect(clamped.z).toBe(-2);
    expect(clamped.x).toBe(4);
    expect(clamped.y).toBe(3.2);
  });

  it('rotates, wraps yaw and clamps pitch', () => {
    const turned = rotateCamera(pose, 200, 100);
    expect(turned.yawDeg).toBeCloseTo(-160, 10);
    expect(turned.pitchDeg).toBe(85);
    expect(clampPose({ ...pose, pitchDeg: Number.NaN }).pitchDeg).toBe(0);
  });

  it('repositions the rig around the subject from a horizontal distance', () => {
    expect(subjectDistance(pose)).toBeCloseTo(2.4, 10);
    const farther = withSubjectDistance(pose, 4.8);
    expect(farther.z).toBeCloseTo(4.8, 10);
    expect(farther.x).toBeCloseTo(0, 10);
    const offAxis = withSubjectDistance({ ...pose, x: 1.2, z: 1.6 }, 2);
    expect(Math.hypot(offAxis.x, offAxis.z)).toBeCloseTo(2, 10);
    expect(offAxis.x).toBeCloseTo(1.2, 10);
  });
});


it('measures height in the pitched and yawed camera frame', () => {
  const turned = { ...pose, yawDeg: 90, pitchDeg: 30 };
  const point = { x: 1, y: pose.y + Math.sqrt(3), z: pose.z };
  expect(cameraVerticalDistance(turned, point)).toBeCloseTo(2, 10);
  expect(axialDistance(turned, point)).toBeCloseTo(0, 10);
});
