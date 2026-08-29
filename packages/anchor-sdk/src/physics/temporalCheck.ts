import type { CheckResult, SensorWindow } from '../types';
import { clamp01 } from './geo';

/** A forward interval larger than this (s) is a suspicious gap. */
const MAX_GAP_S = 300;
/** With at least this many intervals, near-zero stddev flags quantized replay. */
const QUANTIZED_MIN_INTERVALS = 10;
/** Interval stddev below this (s) with >= 10 intervals means locked-clock replay. */
const QUANTIZED_STDDEV_S = 0.001;

/**
 * Temporal consistency of the fix timeline: timestamps must advance
 * monotonically, intervals must not exceed the gap limit, and a long run of
 * exactly-periodic intervals (sub-millisecond stddev) flags a quantized
 * replay. Replayed timestamps (duplicates) and backwards timestamps are hard
 * violations.
 *
 * Evaluated on `fixes`, the clock of record for the window. Score: fraction of
 * intervals that are healthy. passed = no violations.
 */
export function temporalCheck(window: SensorWindow): CheckResult {
  const fixes = window.fixes;
  if (fixes.length < 2) {
    return { id: 'temporal', passed: true, score: 1, detail: 'insufficient fixes (< 2) for temporal consistency' };
  }

  let intervals = 0;
  let violations = 0;
  let duplicates = 0;
  let backwards = 0;
  let gaps = 0;
  const healthyDeltas: number[] = [];

  for (let i = 1; i < fixes.length; i += 1) {
    const aTs = fixes[i - 1].timestamp;
    const bTs = fixes[i].timestamp;
    if (!Number.isFinite(aTs) || !Number.isFinite(bTs)) {
      intervals += 1;
      violations += 1;
      duplicates += 1;
      continue;
    }
    const dtSeconds = (bTs - aTs) / 1000;
    intervals += 1;
    if (!Number.isFinite(dtSeconds) || dtSeconds === 0) {
      duplicates += 1;
      violations += 1;
    } else if (dtSeconds < 0) {
      backwards += 1;
      violations += 1;
    } else if (dtSeconds > MAX_GAP_S) {
      gaps += 1;
      violations += 1;
    } else {
      healthyDeltas.push(dtSeconds);
    }
  }

  let quantized = false;
  if (healthyDeltas.length >= QUANTIZED_MIN_INTERVALS) {
    const mean = healthyDeltas.reduce((sum, dt) => sum + dt, 0) / healthyDeltas.length;
    const variance =
      healthyDeltas.reduce((sum, dt) => sum + (dt - mean) * (dt - mean), 0) / healthyDeltas.length;
    if (Math.sqrt(variance) < QUANTIZED_STDDEV_S) {
      quantized = true;
      violations += 1;
    }
  }

  const flags: string[] = [];
  if (duplicates > 0) flags.push(`${duplicates} duplicated timestamp(s)`);
  if (backwards > 0) flags.push(`${backwards} backwards timestamp(s)`);
  if (gaps > 0) flags.push(`${gaps} gap(s) > ${MAX_GAP_S}s`);
  if (quantized) flags.push('quantized intervals (stddev < 1ms)');

  return {
    id: 'temporal',
    passed: violations === 0,
    score: clamp01(1 - violations / intervals),
    detail: violations === 0
      ? `all ${intervals} intervals monotonic, within gap limit, and not quantized`
      : flags.join(', '),
  };
}
