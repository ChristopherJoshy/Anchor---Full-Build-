/**
 * Pure heading math for the IMU fusion — kept free of expo-sensors imports so
 * it is unit-testable in a plain Node environment.
 */

/**
 * Magnetic heading from raw magnetometer axes, portrait axis conventions:
 * the device is assumed near-flat and screen-up, so the heading of the top
 * edge (the "forward" direction) is atan2(-mx, my) clockwise from magnetic
 * north, normalized to [0, 360). NOT tilt-compensated (that needs the
 * accelerometer); the heading check consumes it only as a direction signal.
 */
export function magnetometerHeadingDeg(x: number, y: number): number {
  const heading = (Math.atan2(-x, y) * 180) / Math.PI;
  return heading < 0 ? heading + 360 : heading;
}

/** Shortest signed difference between two headings in degrees (-180..180). */
export function wrapAngleDelta(deg: number): number {
  let delta = deg % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}
