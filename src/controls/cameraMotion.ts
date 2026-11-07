import { clampPose, rotateCamera, translateCamera, type PoseLimits } from '../domain/camera';
import type { CameraPose } from '../domain/types';

export interface CameraVelocity {
  forward: number;
  strafe: number;
  rise: number;
}

export interface CameraMotionTarget extends CameraVelocity {
  yaw: number;
  pitch: number;
}

const ACCELERATION = 11;
const MAX_STEP_SECONDS = 0.05;

/** Integrate all elapsed foreground time. Small steps follow a turning camera;
 * the exponential velocity and its integral preserve speed even at low FPS.
 * Visibility/input boundaries are handled by the caller, not by discarding time.
 */
export function advanceCameraMotion(pose: CameraPose, velocity: CameraVelocity,
  target: CameraMotionTarget, seconds: number, limits: PoseLimits) {
  if (!Number.isFinite(seconds) || seconds <= 0) return { pose, velocity: { ...velocity } };
  const steps = Math.ceil(seconds / MAX_STEP_SECONDS), dt = seconds / steps;
  const decay = Math.exp(-ACCELERATION * dt), integral = (1 - decay) / ACCELERATION;
  let next = pose;
  const speed = { ...velocity };
  for (let i = 0; i < steps; i++) {
    const distance = {
      forward: target.forward * dt + (speed.forward - target.forward) * integral,
      strafe: target.strafe * dt + (speed.strafe - target.strafe) * integral,
      rise: target.rise * dt + (speed.rise - target.rise) * integral,
    };
    speed.forward = target.forward + (speed.forward - target.forward) * decay;
    speed.strafe = target.strafe + (speed.strafe - target.strafe) * decay;
    speed.rise = target.rise + (speed.rise - target.rise) * decay;
    next = rotateCamera(next, target.yaw * dt * 0.5, target.pitch * dt * 0.5, limits);
    next = translateCamera(next, distance.forward, distance.strafe, distance.rise, limits);
    next = rotateCamera(next, target.yaw * dt * 0.5, target.pitch * dt * 0.5, limits);
  }
  return { pose: clampPose(next, limits), velocity: speed };
}
