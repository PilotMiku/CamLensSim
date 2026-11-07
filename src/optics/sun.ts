/** Mean apparent solar radius from Earth, ~0.266 degrees (~0.533 degree diameter).
 * NASA: https://ntrs.nasa.gov/api/citations/20220013453/downloads/TFAWS-2022-Short%20Course-Environments_Vector_Shading_MERGED.pptx.pdf
 */
export const SOLAR_ANGULAR_RADIUS = 0.00465;
/** Finite proxy distance in metres; not an astronomical world coordinate. */
export const SOLAR_PROXY_DISTANCE_M = 100_000_000;

/** Irradiance of a uniform circular emitter normal to the receiver: E = pi L sin²(alpha). */
export function solarRadiance(irradiance: number, radius = SOLAR_ANGULAR_RADIUS): number {
  if (!Number.isFinite(irradiance) || irradiance < 0 || !Number.isFinite(radius) || radius <= 0 || radius >= Math.PI / 2)
    throw new RangeError('Invalid solar irradiance or angular radius');
  return irradiance / (Math.PI * Math.sin(radius) ** 2);
}

/** Full geometric penumbra width for a straight edge at this receiver/occluder gap. */
export function solarPenumbraWidth(gapM: number, radius = SOLAR_ANGULAR_RADIUS): number {
  if (!Number.isFinite(gapM) || gapM < 0) throw new RangeError('Invalid occluder distance');
  return 2 * gapM * Math.tan(radius);
}
