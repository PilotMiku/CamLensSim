import type { SensorPreset } from './types';

/**
 * Equisolid-angle fisheye geometry: r = 2 f sin(theta/2), where r is the
 * radius on the sensor and theta the angle from the optical axis. The scene
 * pass projects with this mapping directly (see the renderer's vertex shader),
 * and this helper supplies the diagonal field for the readout.
 */

/** Diagonal field the fisheye covers, in degrees. */
export function fisheyeDiagonalDeg(focalMm: number, sensor: SensorPreset): number {
  return fisheyeFieldOfViewDeg(Math.hypot(sensor.widthMm, sensor.heightMm), focalMm);
}

/** Full edge-to-edge angle, twice the angle from the optical axis to one edge. */
export function fisheyeFieldOfViewDeg(dimensionMm: number, focalMm: number): number {
  if (!Number.isFinite(dimensionMm) || dimensionMm <= 0 || !Number.isFinite(focalMm) || focalMm <= 0)
    throw new RangeError('Sensor dimension and focal length must be finite and positive');
  return (4 * Math.asin(Math.min(dimensionMm / (4 * focalMm), 1)) * 180) / Math.PI;
}
