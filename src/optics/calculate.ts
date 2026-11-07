import type { CameraParameters, LensPreset, SensorPreset } from '../domain/types';
import { subjectDistance } from '../domain/camera';
import { fisheyeDiagonalDeg, fisheyeFieldOfViewDeg } from '../domain/projection';

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

const positiveDistance = (value: number, label: string) => value === Infinity ? value : positive(value, label);

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
export function workingImageDistanceMm(focalLengthMm: number, focusDistanceM: number, tiltDeg = 0): number {
  const f = positive(focalLengthMm, 'Focal length');
  const s = positiveDistance(focusDistanceM, 'Focus distance') * 1000;
  if (s <= f) throw new RangeError('Focus distance must exceed focal length');
  if (!Number.isFinite(tiltDeg) || Math.abs(tiltDeg) >= 90) throw new RangeError('Invalid lens tilt');
  const denominator = Math.cos(tiltDeg * Math.PI / 180) - f / s;
  if (denominator <= 0) throw new RangeError('Focus plane requires a positive image distance');
  return f / denominator;
}

/**
 * Angle of view for the current focus distance. Extending the lens to focus
 * closer slightly narrows the framing (focus breathing).
 */
export function workingFovDeg(
  sensorDimensionMm: number,
  focalLengthMm: number,
  focusDistanceM: number,
  tiltDeg = 0,
): number {
  const dimension = positive(sensorDimensionMm, 'Sensor size');
  const imageDistanceMm = workingImageDistanceMm(focalLengthMm, focusDistanceM, tiltDeg);
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
  const s = positiveDistance(focusDistanceM, 'Focus distance') * 1000;
  if (s <= f) throw new RangeError('Focus distance must exceed focal length');
  // Thin lens image-plane model. q = H - f, so far DOF becomes infinite exactly at H.
  const q = (f * f) / (n * c);
  const hyperfocalM = (q + f) / 1000;
  const nearM = s === Infinity ? q / 1000 : (q * s) / (q + s - f) / 1000;
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
  const s = positiveDistance(focusDistanceM, 'Focus distance') * 1000;
  const u = positiveDistance(objectDistanceM, 'Object distance') * 1000;
  if (s <= f) throw new RangeError('Focus distance must exceed focal length');
  if (s === Infinity) return u === Infinity ? 0 : (f * f) / (n * u);
  if (u === Infinity) return (f * f) / (n * (s - f));
  return (f * f * Math.abs(s - u)) / (n * u * (s - f));
}

/**
 * Ideal tilted thin lens, with camera coordinates y up, z forward. The focus
 * plane obeys z/s - y sin(alpha)/f = 1. Its hinge is y=-f/sin(alpha), z=0.
 * s is the optical-axis intercept, NOT distance along the tilted lens normal.
 * Image plane z=-v follows v=f/(cos(alpha)-f/s). All inverse distances use metres.
 * See Merklinger, Focusing the View Camera, pp. 31–35 (hinge and Scheimpflug rules).
 */
export function tiltFocusModel(focalMm: number, focusM: number, tiltDeg: number) {
  const imageDistanceMm = workingImageDistanceMm(focalMm, focusM, tiltDeg);
  const inverseFocusM = 1 / focusM;
  const gradientPerM = Math.sin(tiltDeg * Math.PI / 180) / (focalMm / 1000);
  return {
    imageDistanceMm, inverseFocusM, gradientPerM,
    planeTiltDeg: gradientPerM === 0 ? 0 : Math.atan2(gradientPerM, inverseFocusM) * 180 / Math.PI,
    hingeHeightM: gradientPerM === 0 ? Infinity : -1 / gradientPerM,
  };
}

/** Signed horizontal CoC diameter. The projected aperture ellipse is approximated by a circular kernel. */
export function signedTiltBlurMm(focalMm: number, aperture: number, focusM: number,
  tiltDeg: number, objectM: number, raySlopeY: number) {
  const model = tiltFocusModel(focalMm, focusM, tiltDeg);
  positiveDistance(objectM, 'Object distance');
  positive(aperture, 'Aperture');
  if (!Number.isFinite(raySlopeY)) throw new RangeError('Invalid ray slope');
  return (focalMm / aperture) * (model.imageDistanceMm / 1000)
    * (model.inverseFocusM - 1 / objectM - model.gradientPerM * raySlopeY);
}

/** DOF slice along the camera optical axis (y=0), not the whole tilted DOF wedge. */
export function tiltedAxisDepthOfField(focalMm: number, aperture: number, focusM: number,
  tiltDeg: number, cocMm: number) {
  const model = tiltFocusModel(focalMm, focusM, tiltDeg);
  const tolerancePerM = positive(cocMm, 'Circle of confusion')
    / ((focalMm / positive(aperture, 'Aperture')) * (model.imageDistanceMm / 1000));
  const nearM = 1 / (model.inverseFocusM + tolerancePerM);
  const farM = model.inverseFocusM > tolerancePerM ? 1 / (model.inverseFocusM - tolerancePerM) : Infinity;
  return { nearM, farM, totalM: farM - nearM };
}

/** Positive-axis focus needed for a selected finite world point; null means beyond the supported focusing range. */
export function tiltFocusDistanceForPoint(focalMm: number, tiltDeg: number, axialM: number, verticalM: number): number | null {
  if (axialM <= 0 || !Number.isFinite(axialM) || !Number.isFinite(verticalM)) return null;
  const inverse = (1 + Math.sin(tiltDeg * Math.PI / 180) * verticalM / (focalMm / 1000)) / axialM;
  return inverse > 0 ? 1 / inverse : null;
}

/** ISO-normalised exposure setting. Larger means darker output for the same scene radiance. */
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
  const tilt = lens?.kind === 'tilt-shift' ? parameters.tiltDeg : 0;
  const focusModel = tiltFocusModel(focal, focus, tilt);
  const crop = cropFactor(sensor);
  const cocMm = circleOfConfusionMm(sensor);
  const diffractionMm = diffractionCocMm(aperture);
  const ev100 = exposureValue(aperture, parameters.shutterSeconds, parameters.iso);
  return {
    horizontalFovDeg: fieldOfViewDeg(sensor.widthMm, focal),
    verticalFovDeg: fieldOfViewDeg(sensor.heightMm, focal),
    diagonalFovDeg: fieldOfViewDeg(Math.hypot(sensor.widthMm, sensor.heightMm), focal),
    workingHorizontalFovDeg: workingFovDeg(sensor.widthMm, focal, focus, tilt),
    workingVerticalFovDeg: workingFovDeg(sensor.heightMm, focal, focus, tilt),
    cropFactor: crop,
    equivalentFocalMm: focal * crop,
    cocMm,
    diffractionMm,
    effectiveCocMm: Math.hypot(cocMm, diffractionMm),
    magnification: focusModel.imageDistanceMm / (focus * 1000),
    subjectDistanceM: subjectDistance(parameters.pose),
    lensKind: lens?.kind,
    fisheyeDiagonalDeg: fisheyeDiagonalDeg(focal, sensor),
    fisheyeHorizontalDeg: fisheyeFieldOfViewDeg(sensor.widthMm, focal),
    fisheyeVerticalDeg: fisheyeFieldOfViewDeg(sensor.heightMm, focal),
    ev100,
    exposureScale: exposureScale(ev100),
    ...depthOfField(focal, aperture, focus, cocMm),
    ...(tilt !== 0 ? tiltedAxisDepthOfField(focal, aperture, focus, tilt, cocMm) : {}),
    tilted: tilt !== 0,
    focusPlaneTiltDeg: focusModel.planeTiltDeg,
  };
}

export type OpticsResult = ReturnType<typeof calculateOptics>;

/** Three significant digits keep small positive magnifications distinct from infinity focus (0x). */
export function formatMagnification(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0×';
  return `${Number(value.toPrecision(3))}×`;
}

export function formatDistance(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value >= 100) return `${value.toFixed(0)} m`;
  if (value >= 10) return `${value.toFixed(1)} m`;
  return `${value.toFixed(2)} m`;
}

export function formatEv(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}
