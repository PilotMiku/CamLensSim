import { axialDistance } from '../domain/camera';
import type {
  CameraParameters,
  CameraPose,
  LensPreset,
  SensorPreset,
  Vec3,
} from '../domain/types';

export const SENSORS: readonly SensorPreset[] = [
  { id: 'full-frame', name: '全画幅', shortName: 'Full frame', widthMm: 36, heightMm: 24 },
  { id: 'aps-c', name: 'APS-C', shortName: 'APS-C', widthMm: 23.5, heightMm: 15.6 },
  { id: 'm43', name: 'M4/3', shortName: 'Micro 4/3', widthMm: 17.3, heightMm: 13 },
  { id: 'medium-format', name: '中画幅', shortName: 'Medium format', widthMm: 43.8, heightMm: 32.9 },
];

/** Third-stop aperture scale used by the simulated iris. */
export const APERTURE_STOPS: readonly number[] = [
  0.95, 1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9,
  10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32,
];

const lens = (preset: LensPreset): LensPreset => preset;

export const LENSES: readonly LensPreset[] = [
  // ------------------------------------------------------------- custom ---
  lens({
    id: 'custom',
    name: '自定义镜头 · 10–1200 mm f/0.95–32',
    shortName: 'Custom 10–1200',
    minFocalMm: 10,
    maxFocalMm: 1200,
    minAperture: 0.95,
    maxAperture: 32,
    minFocusM: 0.25,
    blades: 9,
    kind: 'zoom',
    group: '自定义',
  }),
  // -------------------------------------------------- large-aperture primes ---
  lens({
    id: 'prime-24', name: '广角定焦 · 24 mm f/1.4', shortName: '24 mm f/1.4',
    minFocalMm: 24, maxFocalMm: 24, minAperture: 1.4, maxAperture: 16, minFocusM: 0.25, blades: 9,
    kind: 'prime', group: '定焦大光圈',
  }),
  lens({
    id: 'prime-35', name: '广角定焦 · 35 mm f/1.4', shortName: '35 mm f/1.4',
    minFocalMm: 35, maxFocalMm: 35, minAperture: 1.4, maxAperture: 16, minFocusM: 0.28, blades: 9,
    kind: 'prime', group: '定焦大光圈',
  }),
  lens({
    id: 'prime-50', name: '标准定焦 · 50 mm f/1.8', shortName: '50 mm f/1.8',
    minFocalMm: 50, maxFocalMm: 50, minAperture: 1.8, maxAperture: 22, minFocusM: 0.45, blades: 7,
    kind: 'prime', group: '定焦大光圈',
  }),
  lens({
    id: 'prime-50-f12', name: '标准定焦 · 50 mm f/1.2', shortName: '50 mm f/1.2',
    minFocalMm: 50, maxFocalMm: 50, minAperture: 1.2, maxAperture: 16, minFocusM: 0.4, blades: 11,
    kind: 'prime', group: '定焦大光圈',
  }),
  lens({
    id: 'prime-85', name: '人像定焦 · 85 mm f/1.4', shortName: '85 mm f/1.4',
    minFocalMm: 85, maxFocalMm: 85, minAperture: 1.4, maxAperture: 16, minFocusM: 0.85, blades: 11,
    kind: 'prime', group: '定焦大光圈',
  }),
  lens({
    id: 'prime-85-f12', name: '人像定焦 · 85 mm f/1.2', shortName: '85 mm f/1.2',
    minFocalMm: 85, maxFocalMm: 85, minAperture: 1.2, maxAperture: 16, minFocusM: 0.8, blades: 11,
    kind: 'prime', group: '定焦大光圈',
  }),
  lens({
    id: 'prime-105', name: '中长焦定焦 · 105 mm f/1.4', shortName: '105 mm f/1.4',
    minFocalMm: 105, maxFocalMm: 105, minAperture: 1.4, maxAperture: 16, minFocusM: 1.0, blades: 9,
    kind: 'prime', group: '定焦大光圈',
  }),
  lens({
    id: 'prime-135', name: '长焦定焦 · 135 mm f/1.8', shortName: '135 mm f/1.8',
    minFocalMm: 135, maxFocalMm: 135, minAperture: 1.8, maxAperture: 22, minFocusM: 0.9, blades: 9,
    kind: 'prime', group: '定焦大光圈',
  }),
  lens({
    id: 'prime-200', name: '长焦定焦 · 200 mm f/2', shortName: '200 mm f/2',
    minFocalMm: 200, maxFocalMm: 200, minAperture: 2, maxAperture: 22, minFocusM: 1.9, blades: 9,
    kind: 'prime', group: '定焦大光圈',
  }),
  // ---------------------------------------------------- f/2.8 trinity (大三元) ---
  lens({
    id: 'trinity-16-35', name: '大三元 · 16–35 mm f/2.8', shortName: '16–35 f/2.8',
    minFocalMm: 16, maxFocalMm: 35, minAperture: 2.8, maxAperture: 22, minFocusM: 0.28, blades: 9,
    kind: 'zoom', group: '大三元 · F2.8',
  }),
  lens({
    id: 'trinity-24-70', name: '大三元 · 24–70 mm f/2.8', shortName: '24–70 f/2.8',
    minFocalMm: 24, maxFocalMm: 70, minAperture: 2.8, maxAperture: 22, minFocusM: 0.38, blades: 9,
    kind: 'zoom', group: '大三元 · F2.8',
  }),
  lens({
    id: 'trinity-70-200', name: '大三元 · 70–200 mm f/2.8', shortName: '70–200 f/2.8',
    minFocalMm: 70, maxFocalMm: 200, minAperture: 2.8, maxAperture: 22, minFocusM: 0.7, blades: 9,
    kind: 'zoom', group: '大三元 · F2.8',
  }),
  // ---------------------------------------------------- f/4 trinity (小三元) ---
  lens({
    id: 'four-16-35', name: '小三元 · 16–35 mm f/4', shortName: '16–35 f/4',
    minFocalMm: 16, maxFocalMm: 35, minAperture: 4, maxAperture: 22, minFocusM: 0.28, blades: 9,
    kind: 'zoom', group: '小三元 · F4',
  }),
  lens({
    id: 'four-24-105', name: '小三元 · 24–105 mm f/4', shortName: '24–105 f/4',
    minFocalMm: 24, maxFocalMm: 105, minAperture: 4, maxAperture: 22, minFocusM: 0.45, blades: 9,
    kind: 'zoom', group: '小三元 · F4',
  }),
  lens({
    id: 'four-70-200', name: '小三元 · 70–200 mm f/4', shortName: '70–200 f/4',
    minFocalMm: 70, maxFocalMm: 200, minAperture: 4, maxAperture: 22, minFocusM: 1.0, blades: 9,
    kind: 'zoom', group: '小三元 · F4',
  }),
  // ------------------------------------------------------- super tele primes ---
  lens({
    id: 'tele-300', name: '超长焦 · 300 mm f/2.8', shortName: '300 mm f/2.8',
    minFocalMm: 300, maxFocalMm: 300, minAperture: 2.8, maxAperture: 22, minFocusM: 2.5, blades: 9,
    kind: 'prime', group: '超长焦',
  }),
  lens({
    id: 'tele-600', name: '超长焦 · 600 mm f/4', shortName: '600 mm f/4',
    minFocalMm: 600, maxFocalMm: 600, minAperture: 4, maxAperture: 32, minFocusM: 4.5, blades: 9,
    kind: 'prime', group: '超长焦',
  }),
  // --------------------------------------------------------- tilt-shift ---
  lens({
    id: 'ts-24', name: '移轴 · 24 mm f/3.5 T/S', shortName: '24 mm T/S',
    minFocalMm: 24, maxFocalMm: 24, minAperture: 3.5, maxAperture: 32, minFocusM: 0.25, blades: 9,
    kind: 'tilt-shift', group: '移轴',
  }),
  lens({
    id: 'ts-45', name: '移轴 · 45 mm f/2.8 T/S', shortName: '45 mm T/S',
    minFocalMm: 45, maxFocalMm: 45, minAperture: 2.8, maxAperture: 32, minFocusM: 0.4, blades: 9,
    kind: 'tilt-shift', group: '移轴',
  }),
  // ------------------------------------------------------------- fisheye ---
  lens({
    id: 'fisheye-16', name: '鱼眼 · 16 mm f/2.8 对角线', shortName: '16 mm fisheye',
    minFocalMm: 16, maxFocalMm: 16, minAperture: 2.8, maxAperture: 16, minFocusM: 0.25, blades: 7,
    kind: 'fisheye', group: '特殊光学',
  }),
  // ---------------------------------------------------------- mirror (折返) ---
  lens({
    id: 'mirror-500', name: '折返 · 500 mm f/8', shortName: '500 mm mirror',
    minFocalMm: 500, maxFocalMm: 500, minAperture: 8, maxAperture: 8, minFocusM: 3.5, blades: 0,
    kind: 'mirror', group: '特殊光学',
  }),
  lens({
    id: 'mirror-800', name: '折返 · 800 mm f/8', shortName: '800 mm mirror',
    minFocalMm: 800, maxFocalMm: 800, minAperture: 8, maxAperture: 8, minFocusM: 5, blades: 0,
    kind: 'mirror', group: '特殊光学',
  }),
];

/** Default free-camera framing of the indoor still life. */
export const DEFAULT_POSE: CameraPose = {
  x: 0,
  y: 1.20,
  z: 4.6,
  yawDeg: 0,
  pitchDeg: -2.0,
};

/** World-space point the default focus sits on: the tall stoneware vase. */
export const DEFAULT_FOCUS_POINT: Vec3 = { x: -0.18, y: 1.05, z: -0.05 };

export const DEFAULT_PARAMETERS: CameraParameters = {
  sensorId: 'full-frame',
  lensId: 'prime-50',
  focalLengthMm: 50,
  aperture: 1.8,
  focusDistanceM: axialDistance(DEFAULT_POSE, DEFAULT_FOCUS_POINT),
  focusTracking: true,
  focusPoint: { ...DEFAULT_FOCUS_POINT },
  pose: { ...DEFAULT_POSE },
  iso: 100,
  shutterSeconds: 1 / 125,
  constantExposure: true,
  tiltDeg: 0,
  shiftX: 0,
  shiftY: 0,
};

export function getSensor(id: string): SensorPreset {
  return SENSORS.find((sensor) => sensor.id === id) ?? SENSORS[0];
}

export function getLens(id: string): LensPreset {
  return LENSES.find((item) => item.id === id) ?? LENSES[0];
}

/** Effective close-focus limit: a long focal length cannot focus nearer than its image distance. */
export function minFocusMeters(lensPreset: LensPreset, focalLengthMm: number): number {
  const optical = (focalLengthMm / 1000) * 1.12;
  return Math.max(lensPreset.minFocusM, optical);
}

export function snapAperture(value: number, lensPreset: LensPreset): number {
  if (!Number.isFinite(value)) return lensPreset.minAperture;
  const candidates = APERTURE_STOPS.filter(
    (stop) => stop >= lensPreset.minAperture - 1e-6 && stop <= lensPreset.maxAperture + 1e-6,
  );
  if (candidates.length === 0)
    return Math.min(lensPreset.maxAperture, Math.max(lensPreset.minAperture, value));
  return candidates.reduce((best, stop) =>
    Math.abs(stop - value) < Math.abs(best - value) ? stop : best,
  );
}
