/**
 * Solar position for the heading consistency check (NOAA solar calculator
 * algorithm, https://gml.noaa.gov/grad/solcalc/calcdetails.html).
 *
 * Pure: no clock access, no mutation. Accuracy is within ~0.05 degrees of the
 * NOAA reference implementation for dates within a few centuries of J2000,
 * far beyond the precision any heading check needs.
 */

const RAD = Math.PI / 180;

/**
 * Solar azimuth (degrees clockwise from true north, [0, 360)) and elevation
 * (degrees above the horizon, [-90, 90]) for a WGS84 location at a given UTC
 * instant.
 */
export function solarCompassHeading(
  latitude: number,
  longitude: number,
  date: Date,
): { azimuthDeg: number; elevationDeg: number } {
  const julianDay = date.getTime() / 86400000 + 2440587.5;
  const t = (julianDay - 2451545.0) / 36525; // Julian centuries since J2000

  // Geometric mean longitude and anomaly of the sun.
  const meanLongitude = 280.46646 + t * (36000.76983 + t * 0.0003032);
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  // Equation of center -> apparent ecliptic longitude.
  const center =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + center - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  // Obliquity of the ecliptic (corrected) -> declination.
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD));

  // Equation of time (minutes): sundial ahead of clock.
  const y = Math.tan((obliquity * RAD) / 2) ** 2;
  const equationOfTimeMinutes =
    4 *
    ((y * Math.sin(2 * meanLongitude * RAD) -
      2 * eccentricity * Math.sin(meanAnomaly * RAD) +
      4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLongitude * RAD) -
      0.5 * y * y * Math.sin(4 * meanLongitude * RAD) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD)) /
      RAD);

  // True solar time -> hour angle (negative before solar noon).
  const minutesUtc =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60000;
  const trueSolarTimeMinutes = minutesUtc + equationOfTimeMinutes + 4 * longitude;
  const hourAngle = (trueSolarTimeMinutes / 4 - 180) * RAD;

  const latR = latitude * RAD;
  const sinElevation =
    Math.sin(latR) * Math.sin(declination) + Math.cos(latR) * Math.cos(declination) * Math.cos(hourAngle);
  const elevationDeg = Math.asin(Math.min(1, Math.max(-1, sinElevation))) / RAD;

  // atan2 gives azimuth from south, positive westward; convert to from-north clockwise.
  const azimuthFromSouth =
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(latR) - Math.tan(declination) * Math.cos(latR),
    ) / RAD;
  const azimuthDeg = (azimuthFromSouth + 180 + 360) % 360;

  return { azimuthDeg, elevationDeg };
}
