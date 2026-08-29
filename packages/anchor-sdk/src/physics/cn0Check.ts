import type { CheckResult, SensorWindow } from '../types';

/** Epochs need at least this many satellites to judge lockstep. */
const MIN_SATELLITES_PER_EPOCH = 4;
/** At least this many epochs (contiguous) must be available. */
const MIN_EPOCHS = 5;
/** Epochs farther apart than this (s) split into separate evaluation runs. */
const RUN_SPLIT_GAP_S = 3;
/** Residual variance ratio below this flags lockstep (synthetic signal). */
const RESIDUAL_VARIANCE_RATIO_FLAG = 0.2;
/** Mean absolute pairwise correlation above this flags lockstep. */
const MAX_MEAN_PAIRWISE_ABS_CORR = 0.9;
/** Total per-satellite variance below this (dB^2) is too flat to judge. */
const MIN_TOTAL_VARIANCE_DB2 = 1.0;

/** Population variance of a series; 0 for empty input. */
function variance(series: number[]): number {
  if (series.length === 0) return 0;
  const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
  return series.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / series.length;
}

/** Population Pearson correlation; null when either series has zero variance. */
function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

/**
 * C/N0 temporal-correlation check: a real GNSS front end gives every
 * satellite an independently fluctuating C/N0 (its own multipath, gain, and
 * geometry), while a synthetic/replayed feed moves all satellites in lockstep
 * because they are samples of one scaled signal.
 *
 * The window's GNSS epochs are split into contiguous runs (a gap >
 * RUN_SPLIT_GAP_S — or a frozen/backwards timestamp, a replay signature —
 * starts a new run). Each run with >= MIN_EPOCHS epochs and
 * >= MIN_SATELLITES_PER_EPOCH common satellites is tested two ways:
 *  1. residual variance ratio — remove the per-epoch mean across satellites;
 *     for independent signals the per-satellite residuals keep almost all of
 *     the original variance (ratio ~ 1 - 1/N), for lockstep the residuals are
 *     near constant (ratio ~ 0). Flag < RESIDUAL_VARIANCE_RATIO_FLAG.
 *  2. mean absolute pairwise Pearson correlation of per-satellite series.
 *     Flag > MAX_MEAN_PAIRWISE_ABS_CORR.
 *
 * Runs with total C/N0 variance below MIN_TOTAL_VARIANCE_DB2 are skipped
 * (open-sky constant signal is not evidence of lockstep). The check needs
 * >= 4 satellites and >= 5 epochs in at least one run; otherwise it passes
 * with a note. passed = no run flagged.
 */
export function cn0Check(window: SensorWindow): CheckResult {
  const eligible = window.gnss.filter(
    (epoch) => Number.isFinite(epoch.timestamp) && epoch.satellites.length >= MIN_SATELLITES_PER_EPOCH,
  );
  if (eligible.length < MIN_EPOCHS) {
    return {
      id: 'cn0',
      passed: true,
      score: 1,
      detail: `only ${eligible.length} epoch(s) with >= ${MIN_SATELLITES_PER_EPOCH} satellites (need ${MIN_EPOCHS})`,
    };
  }

  // Split into contiguous runs on large time gaps.
  const runs: Array<typeof eligible> = [[]];
  for (let i = 0; i < eligible.length; i += 1) {
    const run = runs[runs.length - 1];
    // A frozen or backwards clock is a replay boundary: start a new run.
    if (run.length > 0) {
      const gapSeconds = (eligible[i].timestamp - run[run.length - 1].timestamp) / 1000;
      if (!Number.isFinite(gapSeconds) || gapSeconds > RUN_SPLIT_GAP_S || gapSeconds <= 0) {
        runs.push([]);
      }
    }
    runs[runs.length - 1].push(eligible[i]);
  }

  let flaggedRuns = 0;
  const runDetails: string[] = [];

  for (const run of runs) {
    if (run.length < MIN_EPOCHS) continue;

    // Satellites present in every epoch — key by constellation+svid to avoid
    // cross-constellation SVID collisions (GPS 5 ≠ GLONASS 5).
    const keyOf = (svid: number, constellation: string) => `${constellation}:${svid}`;
    const commonKeys = run[0].satellites
      .map((sat) => keyOf(sat.svid, sat.constellation))
      .filter((key) => run.every((epoch) => epoch.satellites.some((sat) => keyOf(sat.svid, sat.constellation) === key)));
    if (commonKeys.length < MIN_SATELLITES_PER_EPOCH) continue;

    const series = new Map<string, number[]>();
    for (const key of commonKeys) series.set(key, []);
    for (const epoch of run) {
      for (const key of commonKeys) {
        const sat = epoch.satellites.find((candidate) => keyOf(candidate.svid, candidate.constellation) === key);
        const cn0 = sat?.cn0DbHz;
        // Reject non-finite or non-positive C/N0 (Infinity, NaN leak would corrupt variance).
        if (typeof cn0 !== 'number' || !Number.isFinite(cn0) || cn0 <= 0) {
          series.get(key)!.push(Number.NaN);
        } else {
          series.get(key)!.push(cn0);
        }
      }
    }
    if ([...series.values()].some((values) => values.some((value) => !Number.isFinite(value)))) continue;

    const seriesList = [...series.values()];
    const meanVarianceTotal =
      seriesList.reduce((sum, values) => sum + variance(values), 0) / seriesList.length;
    if (meanVarianceTotal < MIN_TOTAL_VARIANCE_DB2) continue;

    // Per-epoch mean across satellites, then per-satellite residuals.
    const epochMeans: number[] = new Array(run.length).fill(0);
    for (const values of seriesList) {
      for (let t = 0; t < values.length; t += 1) epochMeans[t] += values[t] / seriesList.length;
    }
    const meanVarianceResidual =
      seriesList.reduce((sum, values) => sum + variance(values.map((value, t) => value - epochMeans[t])), 0) /
      seriesList.length;
    const residualRatio = meanVarianceResidual / meanVarianceTotal;

    let corrSum = 0;
    let corrCount = 0;
    for (let i = 0; i < seriesList.length; i += 1) {
      for (let j = i + 1; j < seriesList.length; j += 1) {
        const corr = pearson(seriesList[i], seriesList[j]);
        if (corr !== null) {
          corrSum += Math.abs(corr);
          corrCount += 1;
        }
      }
    }
    const meanAbsCorr = corrCount > 0 ? corrSum / corrCount : 0;

    const lockstep = residualRatio < RESIDUAL_VARIANCE_RATIO_FLAG || meanAbsCorr > MAX_MEAN_PAIRWISE_ABS_CORR;
    if (lockstep) flaggedRuns += 1;
    runDetails.push(
      `run of ${run.length} epochs: residual variance ratio ${residualRatio.toFixed(2)} (flag < ${RESIDUAL_VARIANCE_RATIO_FLAG}), mean |corr| ${meanAbsCorr.toFixed(2)} (flag > ${MAX_MEAN_PAIRWISE_ABS_CORR})${lockstep ? ' — LOCKSTEP' : ''}`,
    );
  }

  if (runDetails.length === 0) {
    return {
      id: 'cn0',
      passed: true,
      score: 1,
      detail: `no run with >= ${MIN_EPOCHS} epochs sharing >= ${MIN_SATELLITES_PER_EPOCH} satellites had enough C/N0 variance to evaluate`,
    };
  }

  return {
    id: 'cn0',
    passed: flaggedRuns === 0,
    score: flaggedRuns === 0 ? 1 : 0,
    detail: runDetails.join('; '),
  };
}
