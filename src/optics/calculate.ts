import type { CameraParameters, LensPreset, SensorPreset } from '../domain/types';
import { subjectDistance } from '../domain/camera';
import { fisheyeDiagonalDeg } from '../domain/projection';

/** Photopic reference wavelength used for the diffraction limit (550 nm). */
export const WAVELENGTH_MM = 0.00055;
/** Conventional 35 mm diagonal, used only for the crop factor. */
const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);
/**
 * Reference exposure of the studio scene: 50 mm f/1.8, 1/125 s, ISO 100.
 * The renderer normalises its exposure around this value.
 */
export const REFERENCE_EV100 = Math.log2(1.8 * 1.8 * 125);

const positive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${label} must be finite and positive`);
  return value;
};

/** Textbook angle of view at infinity focus. */
export function fieldOfViewDeg(sensorDimensionMm: number, focalLengthMm: number): number {
  return (
    (2 *
      Math.atan(
        positive(sensorDimensionMm, 'Sensor size') / (2 * positive(focalLengthMm, 'Focal length')),
      ) *
      180) /
    Math.PI
  );
}

/** Thin-lens image distance for an object at s millimetres. */
export function workingImageDistanceMm(focalLengthMm: number, focusDistanceM: number): number {
  const f = positive(focalLengthMm, 'Focal length');
  const s = positive(focusDistanceM, 'Focus distance') * 1000;
  if (s <= f) throw new RangeError('Focus distance must exceed focal length');
  return (f * s) / (s - f);
}

/**
 * Angle of view for the current focus distance. Extending the lens to focus
 * closer slightly narrows the framing (focus breathing).
 */
export function workingFovDeg(
  sensorDimensionMm: number,
  focalLengthMm: number,
  focusDistanceM: number,
): number {
  const dimension = positive(sensorDimensionMm, 'Sensor size');
  const imageDistanceMm = workingImageDistanceMm(focalLengthMm, focusDistanceM);
  return (2 * Math.atan(dimension / (2 * imageDistanceMm)) * 180) / Math.PI;
}

export function cropFactor(sensor: SensorPreset): number {
  return (
    FULL_FRAME_DIAGONAL_MM /
    Math.hypot(positive(sensor.widthMm, 'Sensor width'), positive(sensor.heightMm, 'Sensor height'))
  );
}

/** Conventional viewing criterion: sensor diagonal / 1500 (not a sensor pixel size). */
export function circleOfConfusionMm(sensor: SensorPreset): number {
  positive(sensor.widthMm, 'Sensor width');
  positive(sensor.heightMm, 'Sensor height');
  return Math.hypot(sensor.widthMm, sensor.heightMm) / 1500;
}

/** Airy-disc diameter of the diffraction limited spot, in millimetres. */
export function diffractionCocMm(aperture: number, wavelengthMm = WAVELENGTH_MM): number {
  return 2.44 * positive(wavelengthMm, 'Wavelength') * positive(aperture, 'Aperture');
}

export function depthOfField(
  focalLengthMm: number,
  aperture: number,
  focusDistanceM: number,
  cocMm: number,
) {
  const f = positive(focalLengthMm, 'Focal length');
  const n = positive(aperture, 'Aperture');
  const c = positive(cocMm, 'Circle of confusion');
  const s = positive(focusDistanceM, 'Focus distance') * 1000;
  if (s <= f) throw new RangeError('Focus distance must exceed focal length');
  // Thin lens image-plane model. q = H - f, so far DOF becomes infinite exactly at H.
  const q = (f * f) / (n * c);
  const hyperfocalM = (q + f) / 1000;
  const nearM = (q * s) / (q + s - f) / 1000;
  const farM = s >= q + f ? Infinity : (q * s) / (q - s + f) / 1000;
  return { nearM, farM, totalM: farM - nearM, hyperfocalM };
}

/** Sensor-plane blur diameter in mm, from axial object and focus distances. */
export function blurCircleMm(
  focalLengthMm: number,
  aperture: number,
  focusDistanceM: number,
  objectDistanceM: number,
) {
  const f = positive(focalLengthMm, 'Focal length');
  const n = positive(aperture, 'Aperture');
  const s = positive(focusDistanceM, 'Focus distance') * 1000;
  const u = positive(objectDistanceM, 'Object distance') * 1000;
  if (s <= f) throw new RangeError('Focus distance must exceed focal length');
  return (f * f * Math.abs(s - u)) / (n * u * (s - f));
}

/** ISO-normalised exposure value. Larger means less light reaching the sensor. */
export function exposureValue(
  aperture: number,
  shutterSeconds: number,
  iso: number,
): number {
  const n = positive(aperture, 'Aperture');
  const t = positive(shutterSeconds, 'Shutter speed');
  const speed = positive(iso, 'ISO');
  return Math.log2((n * n) / t) - Math.log2(speed / 100);
}

/** Relative exposure factor around the reference scene exposure. */
export function exposureScale(ev100: number): number {
  if (!Number.isFinite(ev100)) return 1;
  return Math.pow(2, REFERENCE_EV100 - ev100);
}

export function calculateOptics(
  parameters: CameraParameters,
  sensor: SensorPreset,
  lens?: LensPreset,
) {
  const focal = parameters.focalLengthMm;
  const aperture = parameters.aperture;
  const focus = parameters.focusDistanceM;
  const crop = cropFactor(sensor);
  const cocMm = circleOfConfusionMm(sensor);
  const diffractionMm = diffractionCocMm(aperture);
  const ev100 = exposureValue(aperture, parameters.shutterSeconds, parameters.iso);
  return {
    horizontalFovDeg: fieldOfViewDeg(sensor.widthMm, focal),
    verticalFovDeg: fieldOfViewDeg(sensor.heightMm, focal),
    diagonalFovDeg: fieldOfViewDeg(Math.hypot(sensor.widthMm, sensor.heightMm), focal),
    workingHorizontalFovDeg: workingFovDeg(sensor.widthMm, focal, focus),
    workingVerticalFovDeg: workingFovDeg(sensor.heightMm, focal, focus),
    cropFactor: crop,
    equivalentFocalMm: focal * crop,
    cocMm,
    diffractionMm,
    effectiveCocMm: Math.hypot(cocMm, diffractionMm),
    magnification: focal / (focus * 1000 - focal),
    subjectDistanceM: subjectDistance(parameters.pose),
    lensKind: lens?.kind,
    fisheyeDiagonalDeg: fisheyeDiagonalDeg(focal, sensor),
    fisheyeHorizontalDeg: (2 * Math.asin(Math.min(sensor.widthMm / (4 * focal), 1)) * 180) / Math.PI,
    fisheyeVerticalDeg: (2 * Math.asin(Math.min(sensor.heightMm / (4 * focal), 1)) * 180) / Math.PI,
    ev100,
    exposureScale: exposureScale(ev100),
    ...depthOfField(focal, aperture, focus, cocMm),
  };
}

export type OpticsResult = ReturnType<typeof calculateOptics>;

export function formatDistance(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value >= 100) return `${value.toFixed(0)} m`;
  if (value >= 10) return `${value.toFixed(1)} m`;
  return `${value.toFixed(2)} m`;
}

export function formatEv(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}