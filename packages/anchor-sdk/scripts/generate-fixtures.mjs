#!/usr/bin/env node
/**
 * Deterministic generator for the large physics fixtures:
 *   src/__tests__/fixtures/clean-drive.json    — realistic southbound drive
 *   src/__tests__/fixtures/spoofed-jump.json   — same drive + teleport attack
 *
 * Run from packages/anchor-sdk:  node scripts/generate-fixtures.mjs
 *
 * The seeded PRNG makes output byte-stable across runs; committed JSON is the
 * source of truth for tests, this script documents how it was produced.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'src', '__tests__', 'fixtures');

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xa9c40);
/** Box-Muller gaussian with the shared stream. */
function gaussian(mean, sigma) {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  return mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const M_PER_DEG_LAT = 111320;
const START_LAT = 37.4219983;
const START_LON = -122.084; // Googleplex
const T0 = Date.UTC(2026, 5, 21, 20, 0, 0); // solar azimuth ~177° there, elevation ~76°
const MAGNETIC_DECLINATION_DEG = 14; // Bay Area ~13.9°E, rounded

const FIX_COUNT = 120;
const SATELLITES = [
  { svid: 5, constellation: 'gps' },
  { svid: 12, constellation: 'gps' },
  { svid: 17, constellation: 'gps' },
  { svid: 23, constellation: 'gps' },
  { svid: 3, constellation: 'galileo' },
  { svid: 9, constellation: 'galileo' },
  { svid: 21, constellation: 'beidou' },
];
const SAT_PHASE = SATELLITES.map((_, i) => (i * 2 * Math.PI) / SATELLITES.length);

/** Pressure (hPa) reproducing a given barometric altitude (m). */
function pressureForAltitude(altitudeM) {
  return 1013.25 * (1 - altitudeM / 44330) ** (1 / 0.1903);
}

/** Nominal (unspoofed) kinematic profile at fix index i. */
function profile(i) {
  const bearing = 180 + 20 * Math.sin(i / 30); // southbound meander ±20°
  const speed = 11 + 2 * Math.sin(i / 17); // 9..13 m/s
  return { bearing, speed };
}

/** Builds the clean drive: fixes, barometer, gnss, imu streams. */
function buildCleanDrive() {
  const fixes = [];
  const gnss = [];
  const imu = [];
  const baro = [];

  let lat = START_LAT;
  let lon = START_LON;
  let timestamp = T0;

  for (let i = 0; i < FIX_COUNT; i += 1) {
    const { bearing, speed } = profile(i);
    const dtSeconds = Math.min(1.6, Math.max(0.5, gaussian(1.0, 0.15)));
    if (i > 0) {
      const rad = (bearing * Math.PI) / 180;
      lat += (speed * Math.cos(rad) * dtSeconds) / M_PER_DEG_LAT;
      lon += (speed * Math.sin(rad) * dtSeconds) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      timestamp += dtSeconds * 1000;
    }

    const altitude = 30 + 3 * Math.sin(i / 60) + gaussian(0, 0.8);
    fixes.push({
      latitude: lat,
      longitude: lon,
      altitude,
      accuracy: Math.max(3, 6 + gaussian(0, 1.5)),
      speed: Math.max(0, speed + gaussian(0, 0.3)),
      bearing: bearing + gaussian(0, 1.5),
      timestamp,
    });

    // Independent per-satellite C/N0: distinct slow sinusoid + own noise.
    gnss.push({
      satellites: SATELLITES.map((sat, s) => ({
        svid: sat.svid,
        constellation: sat.constellation,
        cn0DbHz: Math.min(45, Math.max(28, 33 + 4 * Math.sin(i / 23 + SAT_PHASE[s]) + gaussian(0, 1.5))),
      })),
      timestamp: timestamp + 50,
    });

    // ~10 Hz IMU over the whole drive.
    if (i > 0) {
      const prevBearing = profile(i - 1).bearing;
      const dHeadingDegPerS = (bearing - prevBearing) / dtSeconds;
      const steps = Math.round((dtSeconds * 1000) / 100);
      for (let s = 1; s <= steps; s += 1) {
        const frac = s / steps;
        imu.push({
          headingDeg:
            (bearing - MAGNETIC_DECLINATION_DEG) * frac +
            (prevBearing - MAGNETIC_DECLINATION_DEG) * (1 - frac) +
            gaussian(0, 2),
          gyroRadSec: {
            x: gaussian(0, 0.02),
            y: gaussian(0, 0.02),
            z: -(dHeadingDegPerS * Math.PI) / 180 + gaussian(0, 0.05),
          },
          timestamp: timestamp - dtSeconds * 1000 + frac * dtSeconds * 1000,
        });
      }
    }

    // ~2 Hz barometer: pressure reproduces altitude + slow drift + noise.
    if (i % 2 === 0) {
      baro.push({
        pressureHpa: pressureForAltitude(altitude + i * 0.012 + gaussian(0, 0.15)),
        timestamp,
      });
    }
  }

  return { fixes, imu, baro, gnss };
}

/**
 * Applies the teleport attack to fixes 105..119 (the end of the window, where
 * a sliding window would be centred on the anomaly):
 *  - fix 105 repeats fix 104's timestamp (frozen-clock replay signature),
 *  - positions jump ~270 m per second on a NE diagonal (kinematic envelope +
 *    teleport violations) with an extra ~220 m step at fix 112,
 *  - reported speed stays at a nominal 11 m/s,
 *  - GPS altitude climbs +255 m while the barometer keeps drifting gently,
 *  - C/N0 epochs 105..119 are one scaled signal shared by every satellite,
 *  - the IMU is left untouched (real), so magnetic + solar sources disagree
 *    with the spoofed GPS track bearing.
 */
function buildSpoofedJump(drive) {
  const spoofed = JSON.parse(JSON.stringify(drive));
  const SEGMENT_START = 105;
  const SEGMENT_END = 119; // inclusive
  const jumpLatMeters = 2800;
  const jumpLonMeters = 2400;
  const segmentLength = SEGMENT_END - SEGMENT_START + 1;
  const dLatPerFix = jumpLatMeters / M_PER_DEG_LAT / segmentLength;
  const dLonPerFix =
    jumpLonMeters /
    (M_PER_DEG_LAT * Math.cos((spoofed.fixes[SEGMENT_START].latitude * Math.PI) / 180)) /
    segmentLength;

  spoofed.fixes[SEGMENT_START].timestamp = spoofed.fixes[SEGMENT_START - 1].timestamp;

  for (let i = SEGMENT_START; i <= SEGMENT_END; i += 1) {
    let lat = spoofed.fixes[i - 1].latitude + dLatPerFix;
    let lon = spoofed.fixes[i - 1].longitude + dLonPerFix;
    if (i === 112) {
      lat += 180 / M_PER_DEG_LAT; // extra ~220 m step -> clearly beyond 200 m/s implied
    }
    spoofed.fixes[i] = {
      latitude: lat,
      longitude: lon,
      altitude: spoofed.fixes[i].altitude + 17 * (i - SEGMENT_START + 1),
      accuracy: 6,
      speed: 11,
      bearing: 38,
      timestamp: spoofed.fixes[i].timestamp,
    };
    spoofed.gnss[i] = {
      satellites: spoofed.gnss[i].satellites.map((sat, s) => ({
        svid: sat.svid,
        constellation: sat.constellation,
        cn0DbHz: 40 + 5 * Math.sin((i - SEGMENT_START) / 3),
      })),
      timestamp: spoofed.fixes[i].timestamp + 50,
    };
  }

  return spoofed;
}

mkdirSync(FIXTURES, { recursive: true });
const clean = buildCleanDrive();
const spoofed = buildSpoofedJump(clean);
writeFileSync(join(FIXTURES, 'clean-drive.json'), `${JSON.stringify(clean, null, 2)}\n`);
writeFileSync(join(FIXTURES, 'spoofed-jump.json'), `${JSON.stringify(spoofed, null, 2)}\n`);
console.log(
  `wrote clean-drive.json (${clean.fixes.length} fixes, ${clean.imu.length} imu, ${clean.baro.length} baro, ${clean.gnss.length} gnss) and spoofed-jump.json`,
);
