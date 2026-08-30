import {
  evaluateIntegrity,
  stepIntegrity,
  confidenceOf,
  RECOVERY_DEBOUNCE,
  type IntegrityMachine,
} from '../evaluateIntegrity';
import type { CheckResult, SensorWindow } from '../types';

import cleanDrive from './fixtures/clean-drive.json';
import spoofedJump from './fixtures/spoofed-jump.json';
import kinematicJump from './fixtures/kinematic-jump.json';
import temporalFrozen from './fixtures/temporal-frozen.json';

const clean: SensorWindow = cleanDrive;
const spoofed: SensorWindow = spoofedJump;

/** Window with only a temporal failure (single non-critical check). */
const temporalOnly: SensorWindow = temporalFrozen;
/** Window with only a kinematic failure. */
const kinematicOnly: SensorWindow = kinematicJump;
/** Window failing kinematic + cn0 + heading + temporal + altitude (critical pairs). */
const attack: SensorWindow = spoofed;

function failedIds(results: CheckResult[]): string[] {
  return results.filter((r) => !r.passed).map((r) => r.id);
}

describe('evaluateIntegrity (stateless contract function)', () => {
  it('returns TRUSTED with full confidence for a clean window', () => {
    const verdict = evaluateIntegrity(clean);
    expect(verdict.state).toBe('TRUSTED');
    expect(verdict.failedChecks).toEqual([]);
    expect(verdict.confidence).toBeGreaterThan(0.95);
    expect(verdict.timestamp).toBe(clean.fixes[clean.fixes.length - 1].timestamp);
    expect(verdict.reason).toBe('all checks passed');
  });

  it('returns DEGRADED for exactly one non-critical failure', () => {
    const verdict = evaluateIntegrity(temporalOnly);
    expect(verdict.state).toBe('DEGRADED');
    expect(verdict.failedChecks).toEqual(['temporal']);
    expect(verdict.reason).toBe('degraded: temporal failed');
  });

  it('returns DENIED when the critical pair kinematic+heading fails', () => {
    const verdict = evaluateIntegrity(attack);
    const failed = new Set(verdict.failedChecks);
    expect(failed.has('kinematic') && failed.has('heading')).toBe(true);
    expect(verdict.state).toBe('DENIED');
    expect(verdict.reason).toMatch(/^denied: /);
  });

  it('maps a clean window from DENIED to RECOVERING (stateless view)', () => {
    const verdict = evaluateIntegrity(clean, 'DENIED');
    expect(verdict.state).toBe('RECOVERING');
    expect(verdict.reason).toMatch(/recovery/);
  });

  it('maps a clean window from RECOVERING to TRUSTED', () => {
    const verdict = evaluateIntegrity(clean, 'RECOVERING');
    expect(verdict.state).toBe('TRUSTED');
  });

  it('is idempotent', () => {
    const a = evaluateIntegrity(spoofed, 'DENIED');
    const b = evaluateIntegrity(spoofed, 'DENIED');
    expect(a).toEqual(b);
  });

  it('never throws and degrades on malformed windows', () => {
    const verdict = evaluateIntegrity({ fixes: [], imu: [], baro: [], gnss: [] });
    expect(verdict.state).toBe('TRUSTED');
    expect(verdict.confidence).toBe(1);
  });
});

describe('stepIntegrity (debounce-counted state machine)', () => {
  it('holds DENIED for RECOVERY_DEBOUNCE - 1 clean evaluations', () => {
    let machine: IntegrityMachine = { state: 'DENIED', cleanStreak: 0 };
    for (let i = 1; i < RECOVERY_DEBOUNCE; i += 1) {
      const step = stepIntegrity(clean, machine);
      machine = step.machine;
      expect(machine.state).toBe('DENIED');
      expect(machine.cleanStreak).toBe(i);
      expect(step.verdict.reason).toMatch(/debounce i?\/?\d/);
    }
    expect(machine.cleanStreak).toBe(RECOVERY_DEBOUNCE - 1);
  });

  it('enters RECOVERING on the RECOVERY_DEBOUNCE-th clean evaluation', () => {
    let machine: IntegrityMachine = { state: 'DENIED', cleanStreak: 0 };
    for (let i = 1; i < RECOVERY_DEBOUNCE; i += 1) {
      machine = stepIntegrity(clean, machine).machine;
    }
    const final = stepIntegrity(clean, machine);
    expect(final.machine.state).toBe('RECOVERING');
    expect(final.verdict.reason).toMatch(/satisfied/);
  });

  it('moves RECOVERING -> TRUSTED on the next clean evaluation', () => {
    let machine: IntegrityMachine = { state: 'RECOVERING', cleanStreak: RECOVERY_DEBOUNCE };
    const step = stepIntegrity(clean, machine);
    expect(step.machine.state).toBe('TRUSTED');
    expect(step.verdict.reason).toBe('all checks passed');
  });

  it('resets the debounce on a glitch while DENIED', () => {
    let machine: IntegrityMachine = { state: 'DENIED', cleanStreak: RECOVERY_DEBOUNCE - 1 };
    const glitch = stepIntegrity(temporalOnly, machine);
    expect(glitch.machine.state).toBe('DENIED');
    expect(glitch.machine.cleanStreak).toBe(0);
    // And a subsequent clean evaluation starts counting from 1 again.
    const after = stepIntegrity(clean, glitch.machine);
    expect(after.machine.cleanStreak).toBe(1);
  });

  it('treats a glitch during RECOVERING as a regression back to DENIED', () => {
    let machine: IntegrityMachine = { state: 'RECOVERING', cleanStreak: RECOVERY_DEBOUNCE };
    const step = stepIntegrity(kinematicOnly, machine);
    expect(step.machine.state).toBe('DENIED');
    expect(step.machine.cleanStreak).toBe(0);
    expect(step.verdict.reason).toMatch(/regression during recovery/);
  });

  it('denies on the critical pair even from TRUSTED', () => {
    const step = stepIntegrity(attack, { state: 'TRUSTED', cleanStreak: 0 });
    expect(step.machine.state).toBe('DENIED');
    expect(failedIds(step.verdict.results).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps DEGRADED on repeated single non-critical failures and re-earns trust through the debounce', () => {
    let machine: IntegrityMachine = { state: 'TRUSTED', cleanStreak: 0 };
    machine = stepIntegrity(temporalOnly, machine).machine;
    expect(machine.state).toBe('DEGRADED');
    machine = stepIntegrity(temporalOnly, machine).machine;
    expect(machine.state).toBe('DEGRADED');
    // A clean evaluation must NOT snap straight back to TRUSTED: the machine
    // counts clean evaluations, passes through RECOVERING, then TRUSTED.
    for (let i = 1; i < RECOVERY_DEBOUNCE; i += 1) {
      machine = stepIntegrity(clean, machine).machine;
      expect(machine.state).toBe('DEGRADED');
      expect(machine.cleanStreak).toBe(i);
    }
    machine = stepIntegrity(clean, machine).machine;
    expect(machine.state).toBe('RECOVERING');
    machine = stepIntegrity(clean, machine).machine;
    expect(machine.state).toBe('TRUSTED');
  });

  it('is idempotent for identical inputs', () => {
    const machine: IntegrityMachine = { state: 'DENIED', cleanStreak: 3 };
    const a = stepIntegrity(clean, machine);
    const b = stepIntegrity(clean, machine);
    expect(a).toEqual(b);
  });

  it('is 1 when every check scores 1', () => {
    const perfect: CheckResult[] = [
      { id: 'kinematic', passed: true, score: 1, detail: '' },
      { id: 'heading', passed: true, score: 1, detail: '' },
      { id: 'temporal', passed: true, score: 1, detail: '' },
      { id: 'altitude', passed: true, score: 1, detail: '' },
      { id: 'environmental', passed: true, score: 1, detail: '' },
      { id: 'cn0', passed: true, score: 1, detail: '' },
      { id: 'network', passed: true, score: 1, detail: '' },
    ];
    expect(confidenceOf(perfect)).toBeCloseTo(1, 10);
    // The clean drive is graded only by headingCheck (declination + solar).
    const { verdict } = stepIntegrity(clean);
    expect(confidenceOf(verdict.results)).toBeGreaterThan(0.9);
  });

  it('weights kinematic and cn0 highest', () => {
    const perfect: CheckResult[] = [
      { id: 'kinematic', passed: true, score: 1, detail: '' },
      { id: 'heading', passed: true, score: 1, detail: '' },
      { id: 'temporal', passed: true, score: 1, detail: '' },
      { id: 'altitude', passed: true, score: 1, detail: '' },
      { id: 'environmental', passed: true, score: 1, detail: '' },
      { id: 'cn0', passed: true, score: 1, detail: '' },
      { id: 'network', passed: true, score: 1, detail: '' },
    ];
    const degradedKinematic = perfect.map((r) =>
      r.id === 'kinematic' ? { ...r, score: 0 } : r,
    );
    const degradedTemporal = perfect.map((r) =>
      r.id === 'temporal' ? { ...r, score: 0 } : r,
    );
    expect(confidenceOf(perfect)).toBeCloseTo(1, 10);
    expect(1 - confidenceOf(degradedKinematic)).toBeGreaterThan(1 - confidenceOf(degradedTemporal));
  });

  it('clamps into [0, 1]', () => {
    expect(confidenceOf([])).toBe(0);
  });
});
