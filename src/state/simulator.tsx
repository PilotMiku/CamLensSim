import { createContext, useCallback, useContext, useReducer, useRef, type ReactNode } from 'react';
import { playFocusSound } from '../audio/focusSound';
import {
  axialDistance,
  clamp,
  clampPose,
  MAX_FOCUS_M,
  pointOnAxis,
  cameraVerticalDistance,
  radialDistance,
  withSubjectDistance,
  type PoseLimits,
} from '../domain/camera';
import type { CameraParameters, CameraPose, SensorPreset, Vec3, ViewSettings } from '../domain/types';
import {
  DEFAULT_PARAMETERS,
  getLens,
  getSensor,
  minFocusMeters,
  snapAperture,
} from '../data/equipment';
import { matchedFramingFocalMm, tiltFocusDistanceForPoint } from '../optics/calculate';
import { getScene } from '../scenes/registry';

export interface SimulatorState {
  sceneId: string;
  parameters: CameraParameters;
  view: ViewSettings;
  formatComparison: boolean;
}

type ParameterPatch = Partial<Omit<CameraParameters, 'pose' | 'focusPoint'>>;

export type SimulatorAction =
  | { type: 'parameters'; patch: ParameterPatch }
  | { type: 'formatComparison'; enabled: boolean }
  | { type: 'pose'; patch: Partial<CameraPose> }
  | { type: 'focusAtPoint'; point: Vec3 }
  | { type: 'focusDistance'; value: number }
  | { type: 'subjectDistance'; value: number }
  | { type: 'resetCamera' }
  | { type: 'scene'; id: string }
  | { type: 'view'; patch: Partial<ViewSettings> }
  | { type: 'reset' };

function defaultParametersFor(sceneId: string): CameraParameters {
  const scene = getScene(sceneId);
  const pose = clampPose({ ...scene.defaultPose }, scene.poseLimits);
  const focusPoint = { ...scene.defaultFocusPoint };
  return {
    ...DEFAULT_PARAMETERS,
    pose,
    focusPoint,
    focusDistanceM: axialDistance(pose, focusPoint),
    focusTracking: true,
    tiltDeg: 0,
    shiftX: 0,
    shiftY: 0,
  };
}

export const initialState: SimulatorState = {
  sceneId: 'indoor',
  parameters: defaultParametersFor('indoor'),
  formatComparison: false,
  view: { focusSound: true, renderMode: 'realtime', grid: false, depthOfField: true, quality: 'balanced', touchControls: false },
};

const finiteClamp = (value: number, min: number, max: number, fallback: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));

const sanitizePoint = (point: Vec3): Vec3 => ({
  x: Number.isFinite(point.x) ? point.x : 0,
  y: Number.isFinite(point.y) ? point.y : 1,
  z: Number.isFinite(point.z) ? point.z : 0,
});

/** Positive Infinity is an intentional focus setting; other non-finite input is invalid. */
function focusClamp(value: number, min: number, fallback: number): number {
  const candidate = Number.isFinite(value) || value === Infinity ? value : fallback;
  return candidate === Infinity ? Infinity : clamp(candidate, min, MAX_FOCUS_M);
}

/** Apply the current lens and sensor limits to a parameter set. */
function constrain(
  input: CameraParameters,
  previous: CameraParameters,
  limits: PoseLimits,
): CameraParameters {
  const lens = getLens(input.lensId);
  const sensor = getSensor(input.sensorId);
  const aperture = snapAperture(
    finiteClamp(input.aperture, lens.minAperture, lens.maxAperture, previous.aperture),
    lens,
  );
  const focalLengthMm = finiteClamp(
    input.focalLengthMm,
    lens.minFocalMm,
    lens.maxFocalMm,
    previous.focalLengthMm,
  );
  const tiltShift = lens.kind === 'tilt-shift';
  return {
    ...input,
    sensorId: sensor.id,
    lensId: lens.id,
    focalLengthMm,
    aperture,
    focusDistanceM: focusClamp(
      input.focusDistanceM,
      minFocusMeters(lens, focalLengthMm),
      previous.focusDistanceM,
    ),
    iso: finiteClamp(input.iso, 50, 25600, previous.iso),
    shutterSeconds: finiteClamp(input.shutterSeconds, 1 / 8000, 30, previous.shutterSeconds),
    pose: clampPose(input.pose, limits),
    focusPoint: sanitizePoint(input.focusPoint),
    focusTracking: Boolean(input.focusTracking),
    constantExposure: Boolean(input.constantExposure),
    tiltDeg: tiltShift ? finiteClamp(input.tiltDeg, -8.5, 8.5, previous.tiltDeg) : 0,
    shiftX: tiltShift ? finiteClamp(input.shiftX, -1, 1, previous.shiftX) : 0,
    shiftY: tiltShift ? finiteClamp(input.shiftY, -1, 1, previous.shiftY) : 0,
  };
}

export function requestedFocusForPoint(parameters: CameraParameters, point: Vec3): number | null {
  if (getLens(parameters.lensId).kind === 'fisheye') return radialDistance(parameters.pose, point);
  // Preserve ordinary lens behavior when the tracked anchor passes behind the camera.
  if (parameters.tiltDeg === 0) return axialDistance(parameters.pose, point);
  return tiltFocusDistanceForPoint(parameters.focalLengthMm, parameters.tiltDeg,
    axialDistance(parameters.pose, point), cameraVerticalDistance(parameters.pose, point));
}

/** Keep the lens's focus surface anchored to its world point while the camera moves. */
function syncFocus(parameters: CameraParameters): CameraParameters {
  if (!parameters.focusTracking) return parameters;
  const lens = getLens(parameters.lensId);
  return {
    ...parameters,
    focusDistanceM: focusClamp(requestedFocusForPoint(parameters, parameters.focusPoint) ?? Infinity,
      minFocusMeters(lens, parameters.focalLengthMm), parameters.focusDistanceM),
  };
}

const settle = (next: CameraParameters, previous: CameraParameters, limits: PoseLimits) =>
  syncFocus(constrain(next, previous, limits));

/** Reject unattainable comparisons rather than moving focus or silently cropping. */
export function comparisonFocalForSensor(parameters: CameraParameters, sensor: SensorPreset): number | null {
  const lens = getLens(parameters.lensId), custom = getLens('custom');
  if (lens.kind !== 'prime' && lens.kind !== 'zoom') return null;
  const focal = matchedFramingFocalMm(parameters.focalLengthMm, parameters.focusDistanceM,
    getSensor(parameters.sensorId), sensor);
  if (focal < custom.minFocalMm - 1e-7 || focal > custom.maxFocalMm + 1e-7) return null;
  const bounded = clamp(focal, custom.minFocalMm, custom.maxFocalMm);
  return parameters.focusDistanceM >= minFocusMeters(custom, bounded) ? bounded : null;
}

/** Move the focus point when the user edits the distance directly. */
function manualFocus(parameters: CameraParameters, value: number): CameraParameters {
  const lens = getLens(parameters.lensId);
  const min = minFocusMeters(lens, parameters.focalLengthMm);
  const distance = focusClamp(value, min, parameters.focusDistanceM);
  return {
    ...parameters,
    focusTracking: false,
    focusDistanceM: distance,
    // Infinity is a focus setting, not a world-space point. Keep the last finite anchor.
    focusPoint: distance === Infinity ? { ...parameters.focusPoint } : pointOnAxis(parameters.pose, distance),
  };
}

export function simulatorReducer(state: SimulatorState, action: SimulatorAction): SimulatorState {
  const p = state.parameters;
  const scene = getScene(state.sceneId);
  const limits = scene.poseLimits;
  switch (action.type) {
    case 'reset':
      return {
        sceneId: state.sceneId,
        formatComparison: false,
        parameters: defaultParametersFor(state.sceneId),
        view: { ...initialState.view, touchControls: state.view.touchControls },
      };
    case 'scene': {
      // Keep the lens, sensor and exposure the user chose; only reframe the
      // camera and re-anchor the focus point to the new scene.
      const nextScene = getScene(action.id);
      const pose = clampPose({ ...nextScene.defaultPose }, nextScene.poseLimits);
      const focusPoint = { ...nextScene.defaultFocusPoint };
      const parameters = settle(
        {
          ...p,
          pose,
          focusPoint,
          focusTracking: true,
          focusDistanceM: axialDistance(pose, focusPoint),
        },
        p,
        nextScene.poseLimits,
      );
      return { ...state, sceneId: nextScene.id, parameters, view: { ...state.view } };
    }
    case 'formatComparison': {
      if (!action.enabled) return { ...state, formatComparison: false };
      if (comparisonFocalForSensor(p, getSensor(p.sensorId)) === null) return state;
      // Standardise aperture shape as well as freeing the focal length from prime
      // and zoom preset limits, so the baseline and target use the same iris.
      return { ...state, formatComparison: true,
        parameters: constrain({ ...p, lensId: 'custom' }, p, limits) };
    }
    case 'view':
      return { ...state, view: { ...state.view, ...action.patch } };
    case 'pose': {
      const pose = clampPose({ ...p.pose, ...action.patch }, limits);
      return { ...state, parameters: settle({ ...p, pose }, p, limits) };
    }
    case 'subjectDistance': {
      const pose = withSubjectDistance(p.pose, action.value, limits);
      return { ...state, parameters: settle({ ...p, pose }, p, limits) };
    }
    case 'focusDistance':
      return { ...state, parameters: constrain(manualFocus(p, action.value), p, limits) };
    case 'focusAtPoint': {
      const point = sanitizePoint(action.point);
      const lens = getLens(p.lensId);
      const requested = requestedFocusForPoint(p, point);
      // Points behind the tilted lens's hinge cannot be focused with a positive axis intercept.
      if (requested === null) return state;
      const distance = focusClamp(requested, minFocusMeters(lens, p.focalLengthMm), p.focusDistanceM);
      return {
        ...state,
        parameters: settle({ ...p, focusPoint: point, focusDistanceM: distance }, p, limits),
      };
    }
    case 'resetCamera': {
      const pose = clampPose({ ...scene.defaultPose }, limits);
      const focusPoint = { ...scene.defaultFocusPoint };
      return {
        ...state,
        parameters: settle(
          {
            ...p,
            pose,
            focusPoint,
            focusTracking: true,
            focusDistanceM: axialDistance(pose, focusPoint),
          },
          p,
          limits,
        ),
      };
    }
    case 'parameters': {
      const next = { ...p, ...action.patch };
      if (state.formatComparison && action.patch.sensorId !== undefined
        && action.patch.lensId === undefined && action.patch.focalLengthMm === undefined) {
        const sensor = getSensor(action.patch.sensorId);
        const focalLengthMm = comparisonFocalForSensor(p, sensor);
        if (focalLengthMm === null) return state;
        return { ...state, parameters: constrain({ ...next, sensorId: sensor.id, focalLengthMm }, p, limits) };
      }
      const formatComparison = state.formatComparison && !(action.patch.lensId && action.patch.lensId !== p.lensId);
      const result = settle(next, p, limits);
      // Switching lenses can push the focus beyond the new close-focus limit.
      if (action.patch.lensId && action.patch.lensId !== p.lensId) {
        const lens = getLens(action.patch.lensId);
        const min = minFocusMeters(lens, result.focalLengthMm);
        if (result.focusDistanceM < min) {
          return {
            ...state,
            formatComparison,
            parameters: constrain(
              {
                ...result,
                focusPoint: pointOnAxis(result.pose, min),
                focusDistanceM: min,
              },
              result,
              limits,
            ),
          };
        }
      }
      return { ...state, formatComparison, parameters: result };
    }
    default:
      return state;
  }
}

const SimulatorContext = createContext<{
  state: SimulatorState;
  dispatch: React.Dispatch<SimulatorAction>;
} | null>(null);

export function SimulatorProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(simulatorReducer, initialState);
  const current = useRef(state);
  current.current = state;
  const dispatch = useCallback((action: SimulatorAction) => {
    if (action.type === 'focusAtPoint' && current.current.view.focusSound) {
      const next = simulatorReducer(current.current, action);
      if (next !== current.current) playFocusSound();
    }
    baseDispatch(action);
  }, []);
  return (
    <SimulatorContext.Provider value={{ state, dispatch }}>{children}</SimulatorContext.Provider>
  );
}

export function useSimulator() {
  const context = useContext(SimulatorContext);
  if (!context) throw new Error('SimulatorProvider is required');
  return context;
}
