import { kinematicCheck } from '../physics/kinematicCheck';
import { temporalCheck } from '../physics/temporalCheck';
import { altitudeCheck } from '../physics/altitudeCheck';
import { environmentalCheck } from '../physics/environmentalCheck';
import { headingCheck } from '../physics/headingCheck';
import { cn0Check } from '../physics/cn0Check';

import cleanDrive from './fixtures/clean-drive.json';
import spoofedJump from './fixtures/spoofed-jump.json';
import kinematicJump from './fixtures/kinematic-jump.json';
import temporalFrozen from './fixtures/temporal-frozen.json';
import altitudeDivergence from './fixtures/altitude-divergence.json';
import environmentalInvalid from './fixtures/environmental-invalid.json';
import cn0Lockstep from './fixtures/cn0-lockstep.json';
import headingDisagree from './fixtures/heading-disagree.json';

describe('fixture sanity', () => {
  it('clean drive passes all six checks', () => {
    const results = [
      kinematicCheck(cleanDrive),
      temporalCheck(cleanDrive),
      altitudeCheck(cleanDrive),
      environmentalCheck(cleanDrive),
      headingCheck(cleanDrive),
      cn0Check(cleanDrive),
    ];
    for (const result of results) {
      expect(result.passed).toBe(true);
    }
    // Binary checks score 1 on a fully consistent window; headingCheck is
    // graded (track vs magnetic declination vs solar) and passes above 0.8.
    expect(headingCheck(cleanDrive).score).toBeGreaterThan(0.8);
    for (const result of results.filter((r) => r.id !== 'heading')) {
      expect(result.score).toBe(1);
    }
  });
});

describe('kinematicCheck', () => {
  it('passes the clean drive', () => {
    const result = kinematicCheck(cleanDrive);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails the spoofed drive (teleport segment)', () => {
    const result = kinematicCheck(spoofedJump);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/teleport/i);
    expect(result.score).toBe(0);
  });

  it('fails the small jump fixture and nothing else does', () => {
    const result = kinematicCheck(kinematicJump);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    // Isolation: every other check passes the same fixture.
    expect(temporalCheck(kinematicJump).passed).toBe(true);
    expect(environmentalCheck(kinematicJump).passed).toBe(true);
    expect(headingCheck(kinematicJump).passed).toBe(true);
  });

  it('passes with a note on an empty window', () => {
    const result = kinematicCheck({ fixes: [], imu: [], baro: [], gnss: [] });
    expect(result.passed).toBe(true);
    expect(result.detail).toMatch(/insufficient fixes/);
  });

  it('skips duplicate-timestamp pairs instead of dividing by zero', () => {
    const result = kinematicCheck(temporalFrozen);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.passed).toBe(true);
  });
});

describe('temporalCheck', () => {
  it('passes the clean drive', () => {
    const result = temporalCheck(cleanDrive);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails the spoofed drive (frozen clock)', () => {
    const result = temporalCheck(spoofedJump);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/duplicated timestamp/);
  });

  it('fails the frozen fixture and nothing else does', () => {
    const result = temporalCheck(temporalFrozen);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/duplicated/);
    expect(kinematicCheck(temporalFrozen).passed).toBe(true);
    expect(environmentalCheck(temporalFrozen).passed).toBe(true);
    expect(headingCheck(temporalFrozen).passed).toBe(true);
  });

  it('flags quantized replay when intervals are exactly periodic', () => {
    const base = { ...cleanDrive, fixes: cleanDrive.fixes.slice(0, 30) };
    const fixes = base.fixes.map((fix, i) => ({ ...fix, timestamp: 1782072000000 + i * 1000 }));
    const result = temporalCheck({ ...base, fixes });
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/quantized/);
  });
});

describe('altitudeCheck', () => {
  it('passes the clean drive where barometer and GPS agree', () => {
    const result = altitudeCheck(cleanDrive);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails the spoofed drive (GPS altitude shifted +255 m)', () => {
    const result = altitudeCheck(spoofedJump);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/divergence/);
    expect(result.score).toBeLessThan(0.2);
  });

  it('fails the divergence fixture and nothing else does', () => {
    const result = altitudeCheck(altitudeDivergence);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/GPS altitude delta/);
    expect(kinematicCheck(altitudeDivergence).passed).toBe(true);
    expect(environmentalCheck(altitudeDivergence).passed).toBe(true);
    expect(headingCheck(altitudeDivergence).passed).toBe(true);
  });

  it('passes with "no barometer" when baro samples are missing', () => {
    const result = altitudeCheck({ ...cleanDrive, baro: [] });
    expect(result).toEqual({ id: 'altitude', passed: true, score: 1, detail: 'no barometer' });
  });
});

describe('environmentalCheck', () => {
  it('passes the clean drive', () => {
    const result = environmentalCheck(cleanDrive);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('passes even the spoofed drive (attack stays physically plausible)', () => {
    expect(environmentalCheck(spoofedJump).passed).toBe(true);
  });

  it('fails the invalid fixture and nothing else does', () => {
    const result = environmentalCheck(environmentalInvalid);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/2 of 4 fixes/);
    expect(result.detail).toMatch(/altitude 12000 m/);
    expect(kinematicCheck(environmentalInvalid).passed).toBe(true);
    expect(temporalCheck(environmentalInvalid).passed).toBe(true);
    expect(headingCheck(environmentalInvalid).passed).toBe(true);
  });

  it('rejects the (0, 0) null island position', () => {
    const window = { ...cleanDrive, fixes: [{ ...cleanDrive.fixes[0], latitude: 0, longitude: 0 }] };
    const result = environmentalCheck(window);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/invalid/);
  });
});

describe('headingCheck', () => {
  it('passes the clean drive (track, magnetic, solar all agree)', () => {
    const result = headingCheck(cleanDrive);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.8);
  });

  it('fails the spoofed drive (GPS track yanked NE while IMU stays real)', () => {
    const result = headingCheck(spoofedJump);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/max disagreement/);
  });

  it('fails the disagreement fixture and nothing else does', () => {
    const result = headingCheck(headingDisagree);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/track 90°, magnetic 265°/);
    expect(kinematicCheck(headingDisagree).passed).toBe(true);
    expect(temporalCheck(headingDisagree).passed).toBe(true);
    expect(environmentalCheck(headingDisagree).passed).toBe(true);
  });

  it('passes with a note when stationary even with disagreeing IMU', () => {
    const stationary = { ...headingDisagree, imu: headingDisagree.imu };
    const fixes = stationary.fixes.map((fix) => ({ ...fix, speed: 0 }));
    const result = headingCheck({ ...stationary, fixes });
    expect(result.passed).toBe(true);
    expect(result.detail).toMatch(/stationary/);
  });

  it('passes with a note when only one direction source is available', () => {
    // Night at the fixture location: sun below the horizon, no IMU samples —
    // only the GPS track bearing remains.
    const night = {
      fixes: [0, 1, 2].map((i) => ({
        latitude: 37.42 - i * 0.00009,
        longitude: -122.084,
        altitude: 30,
        accuracy: 5,
        speed: 10,
        bearing: 180,
        timestamp: 1782117600000 + i * 1000, // 2026-06-22T06:00Z = 23:00 local
      })),
      imu: [],
      baro: [],
      gnss: [],
    };
    const result = headingCheck(night);
    expect(result.passed).toBe(true);
    expect(result.detail).toMatch(/sources/);
  });
});

describe('cn0Check', () => {
  it('passes the clean drive (independent per-satellite noise)', () => {
    const result = cn0Check(cleanDrive);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.detail).not.toMatch(/LOCKSTEP/);
  });

  it('fails the spoofed drive (lockstep C/N0 segment)', () => {
    const result = cn0Check(spoofedJump);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/LOCKSTEP/);
  });

  it('fails the lockstep fixture and nothing else does', () => {
    const result = cn0Check(cn0Lockstep);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(kinematicCheck(cn0Lockstep).passed).toBe(true);
    expect(temporalCheck(cn0Lockstep).passed).toBe(true);
    expect(headingCheck(cn0Lockstep).passed).toBe(true);
    expect(altitudeCheck(cn0Lockstep).passed).toBe(true);
    expect(environmentalCheck(cn0Lockstep).passed).toBe(true);
  });

  it('passes with a note when there is not enough data', () => {
    const result = cn0Check({ fixes: [], imu: [], baro: [], gnss: [] });
    expect(result.passed).toBe(true);
    expect(result.detail).toMatch(/epoch/);
  });

  it('skips runs with too little variance instead of flagging open sky', () => {
    const flat = {
      fixes: [],
      imu: [],
      baro: [],
      gnss: Array.from({ length: 10 }, (_, i) => ({
        satellites: [5, 12, 17, 23].map((svid) => ({ svid, constellation: 'gps', cn0DbHz: 40 })),
        timestamp: 1782072000000 + i * 1000,
      })),
    };
    const result = cn0Check(flat);
    expect(result.passed).toBe(true);
    expect(result.detail).toMatch(/no run/);
  });
});
