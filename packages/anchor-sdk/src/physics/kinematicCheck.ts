import type { CheckResult, SensorWindow } from '../types';
import { haversineMeters, clamp01 } from './geo';

/** Implied speed above this (m/s) is a teleport, not GNSS noise. */
const TELEPORT_SPEED_MS = 200;
/** Slack (m/s) between Doppler-reported speed and position-derived speed. */
const SPEED_NOISE_MARGIN_MS = 2.0;

/**
 * Kinematic consistency: for every pair of consecutive fixes, the speed
 * implied by the displacement and time delta must agree with the fix's
 * reported speed within an accuracy envelope, and must never exceed the
 * teleport threshold.
 *
 * Envelope: |implied - reported| <= (accuracy[i-1] + accuracy[i]) / dt + margin.
 * The positional accuracies over dt give the worst-case implied-speed error;
 * the margin absorbs Doppler-vs-position slack. Pairs with dt <= 0 are skipped
 * (duplicates/backwards timestamps are temporalCheck's domain).
 *
 * Score: fraction of evaluated segments within the envelope (0 if a teleport
 * is present). passed = no violations.
 */
export function kinematicCheck(window: SensorWindow): CheckResult {
  const fixes = window.fixes;
  if (fixes.length < 2) {
    return { id: 'kinematic', passed: true, score: 1, detail: 'insufficient fixes (< 2) for kinematic consistency' };
  }

  let pairs = 0;
  let violations = 0;
  let maxImplied = 0;
  let teleport = false;

  for (let i = 1; i < fixes.length; i += 1) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const dtSeconds = (b.timestamp - a.timestamp) / 1000;
    if (dtSeconds <= 0) continue;
    const implied = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude) / dtSeconds;
    maxImplied = Math.max(maxImplied, implied);
    pairs += 1;
    if (implied > TELEPORT_SPEED_MS) {
      teleport = true;
      violations += 1;
      continue;
    }
    const tolerance = (a.accuracy + b.accuracy) / dtSeconds + SPEED_NOISE_MARGIN_MS;
    if (Math.abs(implied - b.speed) > tolerance) {
      violations += 1;
    }
  }

  if (pairs === 0) {
    return { id: 'kinematic', passed: true, score: 1, detail: 'no time-separated fix pairs to evaluate' };
  }

  if (teleport) {
    return {
      id: 'kinematic',
      passed: false,
      score: 0,
      detail: `teleport detected: max implied speed ${maxImplied.toFixed(0)} m/s exceeds ${TELEPORT_SPEED_MS} m/s`,
    };
  }

  const score = clamp01(1 - violations / pairs);
  return {
    id: 'kinematic',
    passed: violations === 0,
    score,
    detail: violations === 0
      ? `all ${pairs} segments within kinematic envelope (max implied ${maxImplied.toFixed(1)} m/s)`
      : `${violations} of ${pairs} segments outside kinematic envelope (max implied ${maxImplied.toFixed(1)} m/s)`,
  };
}
