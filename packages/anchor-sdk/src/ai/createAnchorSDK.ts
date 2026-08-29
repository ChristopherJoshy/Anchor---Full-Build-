import type { AnchorSDK, IntegrityState, SensorWindow, Verdict } from '../types';
import { RECOVERY_DEBOUNCE, stepIntegrity, type IntegrityMachine } from '../evaluateIntegrity';
import { explainVerdict } from './explainVerdict';
import { transcribeCommand } from './transcribeCommand';
import { embedText } from './embedText';

/**
 * Creates the public AnchorSDK instance.
 *
 * The returned object owns ONE safety state machine: `evaluate` advances an
 * internal `IntegrityMachine` (via the pure `stepIntegrity`), so the
 * RECOVERY_DEBOUNCE counting is handled for the caller. The optional
 * `prevState` argument is honored only before the first evaluation of this
 * instance; afterwards the internal machine is authoritative — mixing two
 * state owners would break the debounce guarantees.
 *
 * AI methods (explain/transcribe/embed) load their models lazily on first
 * call and never touch the state machine: `AnchorSDK` exposes no mutation
 * path, which is the type-level guarantee that AI cannot alter state.
 */
export function createAnchorSDK(): AnchorSDK {
  let machine: IntegrityMachine | undefined;

  return {
    evaluate(window: SensorWindow, prevState?: IntegrityState): Verdict {
      if (!machine && prevState) {
        machine = {
          state: prevState,
          // A caller-provided RECOVERING state means the debounce was already
          // satisfied on the machine that produced it.
          cleanStreak: prevState === 'RECOVERING' ? RECOVERY_DEBOUNCE : 0,
        };
      }
      const step = stepIntegrity(window, machine);
      machine = step.machine;
      return step.verdict;
    },

    explain(verdict: Verdict): Promise<string> {
      return explainVerdict(verdict);
    },

    transcribe(audio: Float32Array): Promise<string> {
      return transcribeCommand(audio);
    },

    embed(text: string): Promise<number[]> {
      return embedText(text);
    },
  };
}
