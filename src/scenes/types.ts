import type { Scene } from 'three';
import type { PoseLimits } from '../domain/camera';
import type { CameraPose, Vec3, RenderQuality } from '../domain/types';

export interface SceneLandmark {
  id: string;
  label: string;
  /** World-space reference point used for the depth diagram and focus shortcuts. */
  position: Vec3;
}

export interface SunlightVolume {
  sun: import('three').DirectionalLight;
  density: number;
  distance: number;
  groundHeight: number;
  heightFalloff: number;
  /** Physical medium bounds used by path tracing; size and centre in metres. */
  bounds?: { size: [number, number, number]; center: [number, number, number]; density: number };
}

export interface SceneInstance {
  sky?: ReturnType<typeof import('./afternoonSky').createAfternoonSky>;
  sunlight?: SunlightVolume;
  scene: Scene;
  dispose: () => void;
  setQuality?: (quality: RenderQuality) => void;
}

export interface SceneContext {
  renderer: import('three').WebGLRenderer;
}

export interface SceneDefinition {
  id: string;
  name: string;
  subtitle: string;
  landmarks: readonly SceneLandmark[];
  /** Sensible starting focus target for the scene. */
  defaultFocusPoint: Vec3;
  /** Default free-camera framing when the scene is opened. */
  defaultPose: CameraPose;
  /** Movement bounds specific to this scene. */
  poseLimits: PoseLimits;
  /** Camera near / far clipping planes for this scene. */
  cameraNear: number;
  cameraFar: number;
  create: (context: SceneContext) => SceneInstance;
}
