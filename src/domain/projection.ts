import type { SensorPreset } from './types';

/**
 * Equisolid-angle fisheye geometry: r = 2 f sin(theta/2), where r is the
 * radius on the sensor and theta the angle from the optical axis. The scene
 * pass projects with this mapping directly (see the renderer's vertex shader),
 * and this helper supplies the diagonal field for the readout.
 */

/** Diagonal field the fisheye covers, in degrees. */
export function fisheyeDiagonalDeg(focalMm: number, sensor: SensorPreset): number {
  const diagonal = Math.hypot(sensor.widthMm, sensor.heightMm);
  const ratio = Math.min(diagonal / (4 * focalMm), 1);
  return (2 * Math.asin(ratio) * 180) / Math.PI;
}
