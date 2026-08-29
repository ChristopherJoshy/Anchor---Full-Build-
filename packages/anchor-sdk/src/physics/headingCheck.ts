import type { CheckResult, SensorWindow } from '../types';
import { haversineMeters, forwardBearingDeg, circularDiffDeg, clamp01 } from './geo';
import { solarCompassHeading } from './solarCompass';

/** Sources disagreeing by more than this many degrees fail the check. */
const MAX_DISAGREEMENT_DEG = 60;
/** Below this mean reported speed (m/s) the device is considered stationary. */
const MIN_MOVING_SPEED_MS = 1.5;
/** Number of trailing fixes forming the GPS track bearing. */
const TRACK_FIX_COUNT = 10;
/** A track spanning less than this distance (m) has no reliable bearing. */
const MIN_TRACK_DISPLACEMENT_M = 20;
/** Solar azimuth participates only when the sun is at least this high. */
const MIN_SOLAR_ELEVATION_DEG = 5;

/**
 * Heading consistency between three direction sources while the device moves:
 *  1. GPS track bearing from the trailing fixes,
 *  2. latest fused magnetic heading (IMU complementary filter),
 *  3. solar azimuth from the NOAA solar position (only when sun elevation > 5°,
 *     and treated as TRUE north — magnetic declination is absorbed by the
 *     60° threshold).
 *
 * Fails when the maximum pairwise circular disagreement exceeds 60°. With
 * fewer than two usable sources the check passes with a note. Score:
 * 1 - maxDiff/180 when computable.
 */
export function headingCheck(window: SensorWindow): CheckResult {
  const fixes = window.fixes;
  const recent = fixes.slice(-TRACK_FIX_COUNT);
  if (recent.length < 2) {
    return { id: 'heading', passed: true, score: 1, detail: 'insufficient fixes for a track bearing' };
  }

  const meanSpeed = recent.reduce((sum, fix) => sum + fix.speed, 0) / recent.length;
  if (meanSpeed < MIN_MOVING_SPEED_MS) {
    return { id: 'heading', passed: true, score: 1, detail: `stationary (mean speed ${meanSpeed.toFixed(1)} m/s)` };
  }

  const first = recent[0];
  const last = recent[recent.length - 1];
  const displacement = haversineMeters(first.latitude, first.longitude, last.latitude, last.longitude);
  if (displacement < MIN_TRACK_DISPLACEMENT_M) {
    return { id: 'heading', passed: true, score: 1, detail: `track displacement ${displacement.toFixed(0)} m too short for a bearing` };
  }
  const trackBearing = forwardBearingDeg(first.latitude, first.longitude, last.latitude, last.longitude);

  // Latest known magnetic heading from the fused IMU stream.
  let magHeading: number | null = null;
  for (let i = window.imu.length - 1; i >= 0; i -= 1) {
    const heading = window.imu[i].headingDeg;
    if (heading !== null) {
      magHeading = heading;
      break;
    }
  }

  const sun = solarCompassHeading(last.latitude, last.longitude, new Date(last.timestamp));
  const solarHeading = sun.elevationDeg > MIN_SOLAR_ELEVATION_DEG ? sun.azimuthDeg : null;

  const sources: Array<{ name: string; deg: number }> = [{ name: 'track', deg: trackBearing }];
  if (magHeading !== null) sources.push({ name: 'magnetic', deg: magHeading });
  if (solarHeading !== null) sources.push({ name: 'solar', deg: solarHeading });

  if (sources.length < 2) {
    return { id: 'heading', passed: true, score: 1, detail: 'fewer than two direction sources available' };
  }

  let maxDiff = 0;
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      maxDiff = Math.max(maxDiff, circularDiffDeg(sources[i].deg, sources[j].deg));
    }
  }

  const summary = sources.map((source) => `${source.name} ${source.deg.toFixed(0)}°`).join(', ');
  return {
    id: 'heading',
    passed: maxDiff <= MAX_DISAGREEMENT_DEG,
    score: clamp01(1 - maxDiff / 180),
    detail: `${summary}; max disagreement ${maxDiff.toFixed(0)}° (limit ${MAX_DISAGREEMENT_DEG}°)`,
  };
}
