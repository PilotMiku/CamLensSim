import type { CameraPose, Vec3 } from './types';

const DEG = Math.PI / 180;

/** The default still-life focus target sits around this point in world space. */
export const SUBJECT_CENTER: Vec3 = { x: 0, y: 1, z: 0 };

export interface PoseLimits {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  maxPitch: number;
  minPitch: number;
}

export const DEFAULT_POSE_LIMITS: PoseLimits = {
  minX: -4,
  maxX: 4,
  minY: 0.25,
  maxY: 3.2,
  minZ: -2,
  maxZ: 6,
  maxPitch: 85,
  minPitch: -85,
};

/** Wide limits used by the outdoor landscape. */
export const OUTDOOR_POSE_LIMITS: PoseLimits = {
  minX: -45,
  maxX: 45,
  minY: 0.2,
  maxY: 30,
  minZ: -30,
  maxZ: 55,
  maxPitch: 85,
  minPitch: -85,
};

export const MIN_FOCUS_M = 0.3;
/** Finite focus controls cover up to 100 km; positive Infinity represents infinity focus. */
export const MAX_FOCUS_M = 100_000;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

export function wrapDegrees(degrees: number): number {
  const wrapped = (((degrees + 180) % 360) + 360) % 360;
  return wrapped - 180;
}

export function clampPose(pose: CameraPose, limits: PoseLimits = DEFAULT_POSE_LIMITS): CameraPose {
  return {
    x: clamp(finite(pose.x, 0), limits.minX, limits.maxX),
    y: clamp(finite(pose.y, 1.3), limits.minY, limits.maxY),
    z: clamp(finite(pose.z, 2.4), limits.minZ, limits.maxZ),
    yawDeg: wrapDegrees(finite(pose.yawDeg, 0)),
    pitchDeg: clamp(finite(pose.pitchDeg, 0), limits.minPitch, limits.maxPitch),
  };
}

export function forwardVector(pose: CameraPose): Vec3 {
  const yaw = pose.yawDeg * DEG;
  const pitch = pose.pitchDeg * DEG;
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

export function rightVector(pose: CameraPose): Vec3 {
  const yaw = pose.yawDeg * DEG;
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

/** Signed distance along the optical axis; negative means the point is behind the camera. */
export function axialDistance(pose: CameraPose, point: Vec3): number {
  const forward = forwardVector(pose);
  return (
    (point.x - pose.x) * forward.x +
    (point.y - pose.y) * forward.y +
    (point.z - pose.z) * forward.z
  );
}

/** Height in the camera frame, independent of yaw and pitch. */
export function cameraVerticalDistance(pose: CameraPose, point: Vec3): number {
  const yaw = pose.yawDeg * DEG, pitch = pose.pitchDeg * DEG;
  return (point.x - pose.x) * Math.sin(yaw) * Math.sin(pitch)
    + (point.y - pose.y) * Math.cos(pitch)
    + (point.z - pose.z) * Math.cos(yaw) * Math.sin(pitch);
}

/** Radial object distance for the ideal equisolid fisheye model. */
export function radialDistance(pose: CameraPose, point: Vec3): number {
  return Math.hypot(point.x - pose.x, point.y - pose.y, point.z - pose.z);
}

export function pointOnAxis(pose: CameraPose, distanceM: number): Vec3 {
  const forward = forwardVector(pose);
  return {
    x: pose.x + forward.x * distanceM,
    y: pose.y + forward.y * distanceM,
    z: pose.z + forward.z * distanceM,
  };
}

/** Horizontal distance from the camera to the subject centre, used by the distance slider. */
export function subjectDistance(pose: CameraPose): number {
  return Math.hypot(pose.x - SUBJECT_CENTER.x, pose.z - SUBJECT_CENTER.z);
}

export function withSubjectDistance(
  pose: CameraPose,
  distanceM: number,
  limits: PoseLimits = DEFAULT_POSE_LIMITS,
): CameraPose {
  const distance = Math.max(0.2, finite(distanceM, 2.4));
  const horizontal = Math.hypot(pose.x, pose.z);
  if (horizontal < 1e-3) {
    // Camera sits on the subject axis: place it along its own viewing direction.
    const forward = forwardVector(pose);
    const length = Math.hypot(forward.x, forward.z) || 1;
    return clampPose(
      {
        ...pose,
        x: pose.x + (forward.x / length) * distance,
        z: pose.z + (forward.z / length) * distance,
      },
      limits,
    );
  }
  const scale = distance / horizontal;
  return clampPose({ ...pose, x: pose.x * scale, z: pose.z * scale }, limits);
}

export function resolveFocusDistance(
  pose: CameraPose,
  point: Vec3,
  minM = MIN_FOCUS_M,
  maxM = MAX_FOCUS_M,
): number {
  return clamp(axialDistance(pose, point), minM, maxM);
}

/** Move the camera in its own horizontal frame. Distances are metres. */
export function translateCamera(
  pose: CameraPose,
  forwardM: number,
  strafeM: number,
  riseM: number,
  limits: PoseLimits = DEFAULT_POSE_LIMITS,
): CameraPose {
  const forward = forwardVector(pose);
  const right = rightVector(pose);
  return clampPose(
    {
      ...pose,
      x: pose.x + forward.x * forwardM + right.x * strafeM,
      y: pose.y + riseM,
      z: pose.z + forward.z * forwardM + right.z * strafeM,
    },
    limits,
  );
}

export function rotateCamera(
  pose: CameraPose,
  yawDeltaDeg: number,
  pitchDeltaDeg: number,
  limits: PoseLimits = DEFAULT_POSE_LIMITS,
): CameraPose {
  return clampPose(
    {
      ...pose,
      yawDeg: pose.yawDeg + yawDeltaDeg,
      pitchDeg: pose.pitchDeg + pitchDeltaDeg,
    },
    limits,
  );
}

/** Distance to a landmark along the optical axis, or null when it is behind the camera. */
export function axialDistanceOrNull(pose: CameraPose, point: Vec3): number | null {
  const distance = axialDistance(pose, point);
  return distance > 0.02 ? distance : null;
}
