import type { CheckResult, SensorWindow } from '../types';
import { clamp01 } from './geo';

/** Plausible altitude band on Earth's surface (m). */
const MIN_ALTITUDE_M = -450;
const MAX_ALTITUDE_M = 9000;
/** Plausible reported speed band (m/s): 0 to ~1152 km/h. */
const MIN_SPEED_MS = 0;
const MAX_SPEED_MS = 320;
/** Fixes with positional accuracy worse than this (m) are unusable. */
const MAX_ACCURACY_M = 100;

/**
 * Environmental plausibility per fix: altitude within [-450, 9000] m (Dead
 * Sea shore to cruising altitude), reported speed within [0, 320] m/s
 * (ballistic threshold — a phone is never faster), positional accuracy at
 * most 100 m, and a physically valid position (|lat| <= 90, |lon| <= 180,
 * and not the (0, 0) null-island default that injected coordinates use).
 *
 * Score: fraction of fixes that satisfy every bound. passed = all fixes do.
 */
export function environmentalCheck(window: SensorWindow): CheckResult {
  const fixes = window.fixes;
  if (fixes.length === 0) {
    return { id: 'environmental', passed: true, score: 1, detail: 'no fixes to evaluate' };
  }

  let violations = 0;
  const reasons: string[] = [];

  for (let i = 0; i < fixes.length; i += 1) {
    const fix = fixes[i];
    const fixProblems: string[] = [];
    if (Number.isFinite(fix.altitude) && (fix.altitude < MIN_ALTITUDE_M || fix.altitude > MAX_ALTITUDE_M)) {
      fixProblems.push(`altitude ${fix.altitude.toFixed(0)} m outside [-450, 9000] m`);
    }
    if (!Number.isFinite(fix.speed) || fix.speed < MIN_SPEED_MS || fix.speed > MAX_SPEED_MS) {
      const speedStr = Number.isFinite(fix.speed) ? `${fix.speed.toFixed(1)} m/s` : String(fix.speed);
      fixProblems.push(`speed ${speedStr} outside [0, 320] m/s`);
    }
    if (!Number.isFinite(fix.accuracy) || fix.accuracy > MAX_ACCURACY_M || fix.accuracy < 0) {
      const accStr = Number.isFinite(fix.accuracy) ? `${fix.accuracy.toFixed(0)} m` : String(fix.accuracy);
      fixProblems.push(`accuracy ${accStr} worse than ${MAX_ACCURACY_M} m`);
    }
    if (
      !Number.isFinite(fix.latitude) ||
      !Number.isFinite(fix.longitude) ||
      Math.abs(fix.latitude) > 90 ||
      Math.abs(fix.longitude) > 180 ||
      (fix.latitude === 0 && fix.longitude === 0)
    ) {
      fixProblems.push(`position (${fix.latitude}, ${fix.longitude}) invalid`);
    }
    if (fixProblems.length > 0) {
      violations += 1;
      if (reasons.length < 3) reasons.push(`fix ${i}: ${fixProblems.join('; ')}`);
    }
  }

  const score = clamp01(1 - violations / fixes.length);
  return {
    id: 'environmental',
    passed: violations === 0,
    score,
    detail: violations === 0
      ? `all ${fixes.length} fixes within the environmental envelope`
      : `${violations} of ${fixes.length} fixes outside the environmental envelope; ${reasons.join(' | ')}`,
  };
}
