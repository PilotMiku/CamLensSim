/** All focal/sensor dimensions are millimetres; world/focus distances are metres. */
export interface SensorPreset {
  id: string;
  name: string;
  shortName: string;
  widthMm: number;
  heightMm: number;
}

/** Optical construction category; drives projection, aperture and focus behaviour. */
export type LensKind = 'zoom' | 'prime' | 'fisheye' | 'tilt-shift' | 'mirror';

export interface LensPreset {
  id: string;
  name: string;
  shortName: string;
  minFocalMm: number;
  maxFocalMm: number;
  minAperture: number;
  maxAperture: number;
  /** Closest mechanical focus distance of the simulated lens. */
  minFocusM: number;
  /** Number of aperture blades; shapes the out-of-focus highlights. */
  blades: number;
  kind: LensKind;
  /** Group label used to organise the lens picker. */
  group: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Free camera rig. Yaw is measured from the world -Z axis (0° looks at the
 * subject), pitch is positive when looking up. Roll is intentionally absent.
 */
export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  pitchDeg: number;
}

export interface CameraParameters {
  sensorId: string;
  lensId: string;
  focalLengthMm: number;
  aperture: number;
  /** Axial focus distance in metres; positive Infinity means infinity focus. */
  focusDistanceM: number;
  /** When true the focus plane stays anchored to focusPoint while the camera moves. */
  focusTracking: boolean;
  focusPoint: Vec3;
  pose: CameraPose;
  iso: number;
  shutterSeconds: number;
  /** Keep the display exposure multiplier fixed while aperture/shutter/ISO change. */
  constantExposure: boolean;
  /** Lens tilt in degrees; positive tips the lens downward, raising the focus plane with camera y. */
  tiltDeg: number;
  /** Lens shift as a fraction of the half sensor dimension, -1..1 (tilt-shift). */
  shiftX: number;
  shiftY: number;
}

export type RenderQuality = 'fine' | 'balanced' | 'performance' | 'smooth';

export interface ViewSettings {
  focusSound: boolean;
  renderMode: 'realtime' | 'pathtraced';
  grid: boolean;
  depthOfField: boolean;
  quality: RenderQuality;
  /** Force the on-screen virtual joysticks (auto-enabled on touch devices). */
  touchControls: boolean;
}
