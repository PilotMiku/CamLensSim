import { createContext, useCallback, useContext, useReducer, useRef, type ReactNode } from 'react';
import { playFocusSound } from '../audio/focusSound';
import {
  axialDistance,
  clamp,
  clampPose,
  MAX_FOCUS_M,
  pointOnAxis,
  resolveFocusDistance,
  withSubjectDistance,
  type PoseLimits,
} from '../domain/camera';
import type { CameraParameters, CameraPose, Vec3, ViewSettings } from '../domain/types';
import {
  DEFAULT_PARAMETERS,
  getLens,
  getSensor,
  minFocusMeters,
  snapAperture,
} from '../data/equipment';
import { getScene } from '../scenes/registry';

export interface SimulatorState {
  sceneId: string;
  parameters: CameraParameters;
  view: ViewSettings;
}

type ParameterPatch = Partial<Omit<CameraParameters, 'pose' | 'focusPoint'>>;

export type SimulatorAction =
  | { type: 'parameters'; patch: ParameterPatch }
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
  view: { focusSound: true, renderMode: 'realtime', grid: false, depthOfField: true, quality: 'balanced', touchControls: false },
};

const finiteClamp = (value: number, min: number, max: number, fallback: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));

const sanitizePoint = (point: Vec3): Vec3 => ({
  x: Number.isFinite(point.x) ? point.x : 0,
  y: Number.isFinite(point.y) ? point.y : 1,
  z: Number.isFinite(point.z) ? point.z : 0,
});

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
    focusDistanceM: finiteClamp(
      input.focusDistanceM,
      minFocusMeters(lens, focalLengthMm),
      MAX_FOCUS_M,
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

/** Keep the focus plane anchored to its world point while the camera moves. */
function syncFocus(parameters: CameraParameters): CameraParameters {
  if (!parameters.focusTracking) return parameters;
  const lens = getLens(parameters.lensId);
  return {
    ...parameters,
    focusDistanceM: resolveFocusDistance(
      parameters.pose,
      parameters.focusPoint,
      minFocusMeters(lens, parameters.focalLengthMm),
      MAX_FOCUS_M,
    ),
  };
}

const settle = (next: CameraParameters, previous: CameraParameters, limits: PoseLimits) =>
  syncFocus(constrain(next, previous, limits));

/** Move the focus point when the user edits the distance directly. */
function manualFocus(parameters: CameraParameters, value: number): CameraParameters {
  const lens = getLens(parameters.lensId);
  const min = minFocusMeters(lens, parameters.focalLengthMm);
  const distance = finiteClamp(value, min, MAX_FOCUS_M, parameters.focusDistanceM);
  return {
    ...parameters,
    focusTracking: false,
    focusDistanceM: distance,
    focusPoint: pointOnAxis(parameters.pose, distance),
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
      return { sceneId: nextScene.id, parameters, view: { ...state.view } };
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
      const distance = clamp(
        axialDistance(p.pose, point),
        minFocusMeters(lens, p.focalLengthMm),
        MAX_FOCUS_M,
      );
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
      const result = settle(next, p, limits);
      // Switching lenses can push the focus beyond the new close-focus limit.
      if (action.patch.lensId && action.patch.lensId !== p.lensId) {
        const lens = getLens(action.patch.lensId);
        const min = minFocusMeters(lens, result.focalLengthMm);
        if (result.focusDistanceM < min) {
          return {
            ...state,
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
      return { ...state, parameters: result };
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
