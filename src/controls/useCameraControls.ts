import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Dispatch } from 'react';
import {
  clamp,
  rotateCamera,
  translateCamera,
  type PoseLimits,
} from '../domain/camera';
import type { CameraPose } from '../domain/types';
import type { SimulatorAction } from '../state/simulator';
import { advanceCameraMotion } from './cameraMotion';

const BASE_SPEED = 1.55;
const RISE_SPEED = 1.1;
const TURN_RATE = 68;

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyR',
  'KeyF',
  'KeyJ',
  'KeyK',
  'KeyI',
  'KeyO',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
]);

export interface CameraInputHandle {
  setMove: (x: number, y: number) => void;
  setLook: (x: number, y: number) => void;
  setRise: (value: number) => void;
  nudge: (yawDeg: number, pitchDeg: number) => void;
  dolly: (metres: number) => void;
}

interface JoystickInput {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  rise: number;
}

const samePose = (a: CameraPose, b: CameraPose): boolean =>
  Math.abs(a.x - b.x) < 1e-4 &&
  Math.abs(a.y - b.y) < 1e-4 &&
  Math.abs(a.z - b.z) < 1e-4 &&
  Math.abs(a.yawDeg - b.yawDeg) < 1e-4 &&
  Math.abs(a.pitchDeg - b.pitchDeg) < 1e-4;

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (/^(input|select|textarea)$/i.test(target.tagName)) return true;
  return target.closest('dialog') !== null;
};

/**
 * Frame-rate independent free camera. Keyboard, joystick and pointer inputs
 * share one smoothed integration loop that only runs while something moves.
 */
export function useCameraControls(
  pose: CameraPose,
  dispatch: Dispatch<SimulatorAction>,
  limits: PoseLimits,
  enabled = true,
): CameraInputHandle {
  const poseRef = useRef(pose);
  const keys = useRef(new Set<string>());
  const stick = useRef<JoystickInput>({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, rise: 0 });
  const velocity = useRef({ forward: 0, strafe: 0, rise: 0 });
  const running = useRef(false);
  const frame = useRef(0);
  const last = useRef(0);
  const dispatchRef = useRef(dispatch);
  const limitsRef = useRef(limits);
  const recent = useRef<CameraPose[]>([]);
  limitsRef.current = limits;

  dispatchRef.current = dispatch;

  const remember = (next: CameraPose) => {
    recent.current.push(next);
    if (recent.current.length > 8) recent.current.shift();
  };

  const tick = useCallback((now: number) => {
    if (!running.current) return;
    // RAF timestamps can precede an input event flushed during the same frame.
    const time = Math.max(now, last.current);
    const dt = (time - last.current) / 1000;
    last.current = time;
    const pressed = keys.current;
    const stickState = stick.current;
    const fast = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
    const slow = pressed.has('AltLeft') || pressed.has('AltRight');
    const speed = BASE_SPEED * (slow ? 0.35 : 1) * (fast ? 2.4 : 1);
    const turn = TURN_RATE * (slow ? 0.4 : 1) * (fast ? 1.7 : 1);

    const forward = clamp(
      (pressed.has('KeyW') ? 1 : 0) - (pressed.has('KeyS') ? 1 : 0) - stickState.moveY,
      -1,
      1,
    );
    const strafe = clamp(
      (pressed.has('KeyD') ? 1 : 0) - (pressed.has('KeyA') ? 1 : 0) + stickState.moveX,
      -1,
      1,
    );
    const rise = clamp(
      (pressed.has('KeyR') || pressed.has('Space') ? 1 : 0) -
        (pressed.has('KeyF') ? 1 : 0) +
        stickState.rise,
      -1,
      1,
    );
    const yaw = clamp(
      (pressed.has('KeyJ') || pressed.has('ArrowLeft') ? 1 : 0) -
        (pressed.has('KeyK') || pressed.has('ArrowRight') ? 1 : 0) -
        stickState.lookX,
      -1,
      1,
    );
    const pitch = clamp(
      (pressed.has('KeyI') || pressed.has('ArrowUp') ? 1 : 0) -
        (pressed.has('KeyO') || pressed.has('ArrowDown') ? 1 : 0) -
        stickState.lookY,
      -1,
      1,
    );

    const result = advanceCameraMotion(poseRef.current, velocity.current,
      { forward: forward * speed, strafe: strafe * speed, rise: rise * RISE_SPEED,
        yaw: yaw * turn, pitch: pitch * turn }, dt, limitsRef.current);
    velocity.current = result.velocity;

    const residualSpeed = Math.abs(velocity.current.forward) + Math.abs(velocity.current.strafe) + Math.abs(velocity.current.rise);
    const moving = residualSpeed > 0.008 || Math.abs(forward) + Math.abs(strafe) + Math.abs(rise) > 0;
    const turning = Math.abs(yaw) + Math.abs(pitch) > 0.001;

    // A delayed final frame may integrate the entire stopping distance even
    // though its ending velocity is already below the sleep threshold.
    const next = result.pose;
    if (!samePose(poseRef.current, next)) {
      poseRef.current = next;
      remember(next);
      dispatchRef.current({ type: 'pose', patch: next });
    }

    if (!moving && !turning) {
      velocity.current.forward = 0;
      velocity.current.strafe = 0;
      velocity.current.rise = 0;
      running.current = false;
      recent.current = [];
      return;
    }

    frame.current = requestAnimationFrame(tick);
  }, []);

  // Account for the old input up to this event before changing it. A slow render
  // can otherwise consume the whole key/stick hold between animation callbacks.
  const flush = useCallback(() => {
    if (!running.current) return;
    cancelAnimationFrame(frame.current);
    tick(performance.now());
  }, [tick]);

  const wake = useCallback(() => {
    if (running.current) return;
    running.current = true;
    last.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  }, [tick]);

  // A pose that did not come from this loop (reset button, sliders, external
  // state) wins: stop the loop before applying it, so a decelerating camera can
  // never overwrite a reset. Values we just emitted are ignored, which also
  // protects the loop from a lagging React render.
  useEffect(() => {
    if (!running.current) {
      poseRef.current = pose;
      return;
    }
    if (recent.current.some((item) => samePose(item, pose))) return;
    running.current = false;
    cancelAnimationFrame(frame.current);
    velocity.current.forward = 0;
    velocity.current.strafe = 0;
    velocity.current.rise = 0;
    keys.current.clear();
    recent.current = [];
    poseRef.current = pose;
  }, [pose]);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) return;
      if (isTypingTarget(event.target)) return;
      if (!MOVEMENT_KEYS.has(event.code)) return;
      flush();
      keys.current.add(event.code);
      if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
      wake();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!MOVEMENT_KEYS.has(event.code)) return;
      flush();
      keys.current.delete(event.code);
    };
    const handleBlur = () => {
      running.current = false;
      cancelAnimationFrame(frame.current);
      keys.current.clear();
      stick.current = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, rise: 0 };
      velocity.current = { forward: 0, strafe: 0, rise: 0 };
      recent.current = [];
    };
    const handleVisibility = () => { if (document.hidden) handleBlur(); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
      keys.current.clear();
    };
  }, [enabled, wake, flush]);

  useEffect(
    () => () => {
      running.current = false;
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const setMove = useCallback(
    (x: number, y: number) => {
      flush();
      stick.current.moveX = clamp(x, -1, 1);
      stick.current.moveY = clamp(y, -1, 1);
      if (x !== 0 || y !== 0) wake();
    },
    [wake, flush],
  );

  const setLook = useCallback(
    (x: number, y: number) => {
      flush();
      stick.current.lookX = clamp(x, -1, 1);
      stick.current.lookY = clamp(y, -1, 1);
      if (x !== 0 || y !== 0) wake();
    },
    [wake, flush],
  );

  const setRise = useCallback(
    (value: number) => {
      flush();
      stick.current.rise = clamp(value, -1, 1);
      if (value !== 0) wake();
    },
    [wake, flush],
  );

  const nudge = useCallback(
    (yawDeg: number, pitchDeg: number) => {
      const next = rotateCamera(poseRef.current, yawDeg, pitchDeg, limitsRef.current);
      poseRef.current = next;
      remember(next);
      dispatchRef.current({ type: 'pose', patch: next });
    },
    [],
  );

  const dolly = useCallback((metres: number) => {
    const current = poseRef.current;
    const next = translateCamera(current, clamp(metres, -0.5, 0.5), 0, 0, limitsRef.current);
    poseRef.current = next;
    remember(next);
    dispatchRef.current({ type: 'pose', patch: next });
  }, []);

  return useMemo(
    () => ({ setMove, setLook, setRise, nudge, dolly }),
    [setMove, setLook, setRise, nudge, dolly],
  );
}
