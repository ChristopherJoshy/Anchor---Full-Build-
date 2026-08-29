import { buildExplanationPrompt } from '../ai/explainVerdict';
import type { Verdict } from '../types';

const verdict: Verdict = {
  state: 'DENIED',
  failedChecks: ['kinematic', 'cn0'],
  results: [
    { id: 'kinematic', passed: false, score: 0, detail: 'teleport detected: max implied speed 412 m/s exceeds 200 m/s' },
    { id: 'cn0', passed: false, score: 0, detail: 'run of 15 epochs: residual variance ratio 0.00 — LOCKSTEP' },
    { id: 'heading', passed: true, score: 0.86, detail: 'all sources agree' },
    { id: 'temporal', passed: true, score: 1, detail: 'all intervals healthy' },
    { id: 'altitude', passed: true, score: 1, detail: 'no barometer' },
    { id: 'environmental', passed: true, score: 1, detail: 'all fixes within envelope' },
  ],
  reason: 'denied: kinematic, cn0 failed',
  confidence: 0.42,
  timestamp: 1782072000000,
};

describe('buildExplanationPrompt', () => {
  it('includes state, confidence and only the failing checks', () => {
    const messages = buildExplanationPrompt(verdict);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    const user = messages[1].content ?? '';
    expect(user).toContain('state: DENIED');
    expect(user).toContain('confidence: 42%');
    expect(user).toContain('kinematic (score 0.00): teleport detected');
    expect(user).toContain('cn0 (score 0.00)');
    expect(user).not.toContain('heading');
    expect(user).not.toContain('temporal');
  });

  it('says no checks failed when the verdict is clean', () => {
    const clean: Verdict = {
      state: 'TRUSTED',
      failedChecks: [],
      results: [
        { id: 'kinematic', passed: true, score: 1, detail: 'ok' },
        { id: 'heading', passed: true, score: 1, detail: 'ok' },
        { id: 'temporal', passed: true, score: 1, detail: 'ok' },
        { id: 'altitude', passed: true, score: 1, detail: 'no barometer' },
        { id: 'environmental', passed: true, score: 1, detail: 'ok' },
        { id: 'cn0', passed: true, score: 1, detail: 'ok' },
      ],
      reason: 'all checks passed',
      confidence: 1,
      timestamp: 1782072000000,
    };
    const user = buildExplanationPrompt(clean)[1].content ?? '';
    expect(user).toContain('none; every consistency check passed');
    expect(user).toContain('looks trustworthy');
  });

  it('is deterministic for the same verdict', () => {
    expect(buildExplanationPrompt(verdict)).toEqual(buildExplanationPrompt(verdict));
  });
});
