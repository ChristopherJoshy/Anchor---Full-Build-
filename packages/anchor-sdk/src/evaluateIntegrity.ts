import type { CheckId, CheckResult, IntegrityState, SensorWindow, Verdict } from './types';
import { kinematicCheck } from './physics/kinematicCheck';
import { headingCheck } from './physics/headingCheck';
import { temporalCheck } from './physics/temporalCheck';
import { altitudeCheck } from './physics/altitudeCheck';
import { environmentalCheck } from './physics/environmentalCheck';
import { cn0Check } from './physics/cn0Check';

/**
 * Deterministic RAIM/FDE-style state machine transitions.
 *
 * Rules (per evaluation over the given window):
 *  - all six checks pass:
 *      TRUSTED/DEGRADED/none -> TRUSTED
 *      DENIED                -> stays DENIED until RECOVERY_DEBOUNCE
 *                               consecutive clean evaluations have elapsed,
 *                               then RECOVERING (entering RECOVERING marks the
 *                               end of the debounce); the next clean
 *                               evaluation after that -> TRUSTED
 *      RECOVERING            -> TRUSTED
 *  - one non-critical check fails:
 *      TRUSTED/DEGRADED/none -> DEGRADED
 *      DENIED/RECOVERING     -> DENIED (never relax on a failing evaluation;
 *                               the debounce resets)
 *  - two or more checks fail, or the critical pair kinematic+cn0 or
 *    kinematic+heading fails: -> DENIED from any state
 *
 * All counting lives in the machine state carried between calls
 * (`cleanStreak`), so every function here is pure: same inputs -> same
 * outputs, no module-level state.
 */

/** Consecutive clean evaluations required to leave DENIED. */
export const RECOVERY_DEBOUNCE = 5;

/**
 * Relative weight of each check in the confidence score. Kinematic and cn0
 * are the strongest spoof discriminators and dominate the score.
 */
const CHECK_WEIGHTS: Record<CheckId, number> = {
  kinematic: 0.25,
  cn0: 0.25,
  heading: 0.15,
  temporal: 0.1,
  altitude: 0.1,
  environmental: 0.15,
};

/** Check pairs whose joint failure means an active attack, not drift. */
const CRITICAL_PAIRS: Array<[CheckId, CheckId]> = [
  ['kinematic', 'cn0'],
  ['kinematic', 'heading'],
];

const CHECKS: Array<{ id: CheckId; run: (window: SensorWindow) => CheckResult }> = [
  { id: 'kinematic', run: kinematicCheck },
  { id: 'heading', run: headingCheck },
  { id: 'temporal', run: temporalCheck },
  { id: 'altitude', run: altitudeCheck },
  { id: 'environmental', run: environmentalCheck },
  { id: 'cn0', run: cn0Check },
];

/** Stateful carrier for the recovery debounce, owned by the caller. */
export interface IntegrityMachine {
  state: IntegrityState;
  cleanStreak: number;
}

export interface EvaluateResult extends Verdict {
  /** Clean-evaluation counter carried in the machine state after this step. */
  cleanStreak: number;
}

/** Weighted confidence from the check scores, in [0, 1]. */
export function confidenceOf(results: CheckResult[]): number {
  let confidence = 0;
  for (const result of results) {
    confidence += CHECK_WEIGHTS[result.id] * result.score;
  }
  return Math.min(1, Math.max(0, confidence));
}

function isCritical(failed: Set<CheckId>): boolean {
  return CRITICAL_PAIRS.some(([a, b]) => failed.has(a) && failed.has(b));
}

function runChecks(window: SensorWindow): { results: CheckResult[]; failedChecks: CheckId[] } {
  const results = CHECKS.map(({ run }) => run(window));
  const failedChecks = results.filter((result) => !result.passed).map((result) => result.id);
  return { results, failedChecks };
}

function reasonFor(
  state: IntegrityState,
  failedChecks: CheckId[],
  prev: IntegrityMachine,
  next: IntegrityMachine,
): string {
  if (failedChecks.length === 0) {
    if (state === 'DENIED') {
      return `recovery debounce ${next.cleanStreak}/${RECOVERY_DEBOUNCE} clean evaluations`;
    }
    if (state === 'RECOVERING') {
      return `recovery debounce satisfied after ${next.cleanStreak} clean evaluations`;
    }
    return 'all checks passed';
  }
  const list = failedChecks.join(', ');
  if (state === 'DENIED') {
    if (prev.state === 'RECOVERING') {
      return `regression during recovery: ${list} failed`;
    }
    return `denied: ${list} failed`;
  }
  return `degraded: ${list} failed`;
}

/**
 * One step of the safety state machine: evaluate the window and advance the
 * machine. Pure — callers thread the returned `machine` into the next call.
 * Omitting the machine starts from TRUSTED with an empty debounce.
 */
export function stepIntegrity(
  window: SensorWindow,
  machine?: IntegrityMachine,
): { verdict: EvaluateResult; machine: IntegrityMachine } {
  const prev: IntegrityMachine = machine ?? { state: 'TRUSTED', cleanStreak: 0 };
  const { results, failedChecks } = runChecks(window);
  const failedSet = new Set(failedChecks);
  const timestamp = window.fixes.length > 0 ? window.fixes[window.fixes.length - 1].timestamp : 0;

  let state: IntegrityState;
  let cleanStreak = 0;

  if (failedChecks.length === 0) {
    if (prev.state === 'DENIED') {
      cleanStreak = prev.cleanStreak + 1;
      state = cleanStreak >= RECOVERY_DEBOUNCE ? 'RECOVERING' : 'DENIED';
    } else if (prev.state === 'RECOVERING') {
      cleanStreak = prev.cleanStreak + 1;
      state = 'TRUSTED';
    } else {
      state = 'TRUSTED';
    }
  } else if (prev.state === 'DENIED' || prev.state === 'RECOVERING') {
    // Never relax on a failing evaluation; a glitch during RECOVERING is a
    // regression that restarts the debounce from zero.
    state = 'DENIED';
  } else if (failedChecks.length >= 2 || isCritical(failedSet)) {
    state = 'DENIED';
  } else {
    state = 'DEGRADED';
  }

  const next: IntegrityMachine = { state, cleanStreak };
  const verdict: EvaluateResult = {
    state,
    failedChecks,
    results,
    reason: reasonFor(state, failedChecks, prev, next),
    confidence: confidenceOf(results),
    timestamp,
    cleanStreak,
  };
  return { verdict, machine: next };
}

/**
 * Stateless evaluation per the public AnchorSDK contract: derives the
 * transition from `prevState` alone. From DENIED a clean window maps to
 * RECOVERING (the debounce-counted path is available via `stepIntegrity`,
 * which `createAnchorSDK().evaluate` uses).
 */
export function evaluateIntegrity(window: SensorWindow, prevState?: IntegrityState): EvaluateResult {
  // Stateless view: the machine is reconstructed from prevState alone. A
  // DENIED input is assumed to have its debounce already elapsed, so a clean
  // window maps straight to RECOVERING.
  const machine: IntegrityMachine | undefined = prevState
    ? { state: prevState, cleanStreak: prevState === 'DENIED' ? RECOVERY_DEBOUNCE - 1 : 0 }
    : undefined;
  const { verdict } = stepIntegrity(window, machine);
  return verdict;
}
