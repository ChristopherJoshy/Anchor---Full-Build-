import type { Message } from 'react-native-executorch';
import type { Verdict } from '../types';
import { loadLlm } from './executorchRuntime';

/** Human-readable phrasing for each integrity state. */
const STATE_PHRASES: Record<Verdict['state'], string> = {
  TRUSTED: 'the device position data looks trustworthy',
  DEGRADED: 'the device position data has reduced confidence',
  DENIED: 'the device position data is being rejected as unreliable and possibly manipulated',
  RECOVERING: 'the device position data is recovering after a recent anomaly',
};

/**
 * Builds the compact deterministic prompt for a verdict. Pure and unit-
 * testable: the model only ever sees this template plus the check details.
 */
export function buildExplanationPrompt(verdict: Verdict): Message[] {
  const failedList =
    verdict.results.filter((result) => !result.passed).length > 0
      ? verdict.results
          .filter((result) => !result.passed)
          .map((result) => `- ${result.id} (score ${result.score.toFixed(2)}): ${result.detail}`)
          .join('\n')
      : '- none; every consistency check passed';

  const user: Message = {
    role: 'user',
    content: `GNSS integrity verdict for a phone user:

state: ${verdict.state} (meaning: ${STATE_PHRASES[verdict.state]})
confidence: ${(verdict.confidence * 100).toFixed(0)}%
failed checks:
${failedList}

Explain in 1-2 plain-language sentences what is happening with the position data and why. Do not give advice and do not invent details beyond this verdict.`,
  };
  return [
    {
      role: 'system',
      content:
        'You explain on-device GPS integrity verdicts in plain language. Answer with one or two short sentences, no lists, no advice.',
    },
    user,
  ];
}

/**
 * Explains a verdict in plain language using the on-device LLM
 * (Llama 3.2 1B quantized via ExecuTorch).
 *
 * STRICT: takes the verdict, returns text. There is deliberately no path from
 * here back to the state machine — explanations can never change state.
 * Lazy: the model loads on the first call (or earlier if AnchorProvider is
 * mounted); repeated calls reuse the loaded instance and each call is
 * stateless (the full context travels in the prompt, not in chat history).
 */
export async function explainVerdict(verdict: Verdict): Promise<string> {
  const llm = await loadLlm();
  const response = await llm.generate(buildExplanationPrompt(verdict));
  return response.trim();
}
