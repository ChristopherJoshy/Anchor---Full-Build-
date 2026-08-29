import type { CheckResult, SensorWindow } from '../types';
import { clamp01 } from './geo';

/** |GPS altitude delta - barometric delta| beyond this (m) fails the check. */
const DIVERGENCE_LIMIT_M = 50;
/** ISA sea-level reference pressure (hPa) for the barometric altitude formula. */
export const BARO_REFERENCE_PRESSURE_HPA = 1013.25;

/**
 * Barometric altitude (m) from atmospheric pressure (hPa):
 * 44330 * (1 - (p/p0)^0.1903), the standard international barometric formula.
 */
export function barometricAltitudeMeters(pressureHpa: number): number {
  return 44330 * (1 - (pressureHpa / BARO_REFERENCE_PRESSURE_HPA) ** 0.1903);
}

/**
 * Altitude consistency: the GPS altitude delta across the window must agree
 * with the barometric altitude delta (pressure-derived via the barometric
 * formula) within DIVERGENCE_LIMIT_M. A slow barometer drift is real-world
 * normal; a divergence beyond the limit means the GPS altitude is being
 * synthesized or shifted.
 *
 * No barometer samples -> pass with note "no barometer" (score 1): the check
 * has no second opinion and must not invent one. Fewer than 2 fixes -> pass
 * with note.
 */
export function altitudeCheck(window: SensorWindow): CheckResult {
  const fixes = window.fixes;
  if (fixes.length < 2) {
    return { id: 'altitude', passed: true, score: 1, detail: 'insufficient fixes (< 2) for altitude consistency' };
  }
  if (window.baro.length < 2) {
    return { id: 'altitude', passed: true, score: 1, detail: 'no barometer' };
  }

  const gpsDelta = fixes[fixes.length - 1].altitude - fixes[0].altitude;
  const baroFirst = barometricAltitudeMeters(window.baro[0].pressureHpa);
  const baroLast = barometricAltitudeMeters(window.baro[window.baro.length - 1].pressureHpa);
  const baroDelta = baroLast - baroFirst;
  const divergence = Math.abs(gpsDelta - baroDelta);

  // Score falls linearly from 1 at the limit to 0 at twice the limit.
  const score = clamp01(1 - (divergence - DIVERGENCE_LIMIT_M) / DIVERGENCE_LIMIT_M);
  return {
    id: 'altitude',
    passed: divergence <= DIVERGENCE_LIMIT_M,
    score,
    detail: `GPS altitude delta ${gpsDelta.toFixed(1)} m vs barometric delta ${baroDelta.toFixed(1)} m; divergence ${divergence.toFixed(1)} m (limit ${DIVERGENCE_LIMIT_M} m)`,
  };
}
