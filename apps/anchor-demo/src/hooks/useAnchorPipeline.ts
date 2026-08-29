/**
 * useAnchorPipeline — app-side wiring of the anchor-sdk integrity pipeline.
 *
 * NO simulated data paths anywhere: the six physics checks, the RAIM/FDE machine,
 * telemetry, timing, and every displayed number come from the real sensor
 * streams and the real SDK output. The only staged input in the entire app
 * is the labeled DEMO CONTROLS harness (attack-scenario frames), which is DISARMED by
 * default and exists purely to stage spoofing attacks that cannot be performed
 * live. Armed frames enter the SAME sdk.evaluate() path as live GPS — the
 * pipeline never knows the difference and nothing else is ever substituted.
 */
import { useBarometerStream, useGnssMeasurements, useImuStream, useLocationStream } from 'anchor-sdk';
import type {
  AnchorSDK,
  BaroSample,
  CheckId,
  Fix,
  GnssMeasurementSample,
  ImuSample,
  IntegrityState,
  Verdict,
} from 'anchor-sdk';
import { createAnchorSDK } from 'anchor-sdk';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';

export const WINDOW_FIX_CAP = 12;
export const WINDOW_IMU_CAP = 60;
export const WINDOW_BARO_CAP = 60;
export const WINDOW_GNSS_CAP = 12;

/** Attack-scenario kinds for the armed TEST HARNESS (presentation stimulus only). */
export type ScenarioKind =
  | 'teleport'
  | 'cno'
  | 'altitude'
  | 'heading'
  | 'temporal'
  | 'environmental'
  | 'compound';

/** Live sensor readouts for the telemetry rail — all values measured. */
export interface Telemetry {
  lat: number;
  lon: number;
  alt: number;
  acc: number;
  speed: number;
  bearing: number;
  sats: number | null;
  baroHpa: number | null;
  fixAgeMs: number | null;
  imuCount: number;
  baroCount: number;
  gnssEpochs: number;
}

/** One flight-recorder line: a pipeline state transition or network event. */
export interface EventLogEntry {
  id: number;
  timestamp: number;
  state: IntegrityState;
  reason: string;
  failedChecks: CheckId[];
  /** Plain-language explanation from the on-device Qwen3 model when it resolves. */
  explanation: string | null;
  /** Reason embedding from the on-device embedder (semantic search). */
  embedding: number[] | null;
}

function pushCapped<T>(arr: T[], item: T, cap: number): T[] {
  const next = arr.length >= cap ? arr.slice(arr.length - cap + 1) : arr.slice();
  next.push(item);
  return next;
}

/** Real elapsed-time measurement of a synchronous call (performance.now). */
export function measureDeterministic<T>(fn: () => T): { result: T; ms: number } {
  const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const result = fn();
  const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  return { result, ms: Math.max(0.1, Math.round((t1 - t0) * 10) / 10) };
}

/**
 * Attack frames: ~400 m/s teleport while claiming implausibly good accuracy
 * and a speed that contradicts the implied displacement. The SDK's real checks
 * do the judging.
 */
function buildSpoofFixes(base: Fix, count: number): Fix[] {
  const out: Fix[] = [];
  let lat = base.latitude;
  let lon = base.longitude;
  for (let i = 0; i < count; i += 1) {
    lat += 400 / 111_320;
    lon += 150 / (111_320 * Math.cos((base.latitude * Math.PI) / 180));
    out.push({
      latitude: lat,
      longitude: lon,
      altitude: base.altitude + 40 * (i + 1),
      accuracy: 2.5,
      speed: 4.2,
      bearing: 15,
      timestamp: base.timestamp + (i + 1) * 1000,
    });
  }
  return out;
}

/** GPS altitude walks +120 m while the barometer stays on its real trend. */
function buildAltitudeSpoofFixes(base: Fix, count: number): Fix[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: base.latitude + (Math.random() - 0.5) * 0.00002,
    longitude: base.longitude + (Math.random() - 0.5) * 0.00002,
    altitude: base.altitude + 120 + i * 5,
    accuracy: 4,
    speed: base.speed,
    bearing: base.bearing,
    timestamp: base.timestamp + (i + 1) * 1000,
  }));
}

/** Track bears east at 12 m/s while the real IMU keeps its true heading. */
function buildHeadingSpoofFixes(base: Fix, count: number): Fix[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: base.latitude,
    longitude: base.longitude + ((90 + i * 2) / (111_320 * Math.cos((base.latitude * Math.PI) / 180))),
    altitude: base.altitude,
    accuracy: 5,
    speed: 12,
    bearing: 90,
    timestamp: base.timestamp + (i + 1) * 1000,
  }));
}

/** Replayed clock: the first frames share one timestamp. */
function buildTemporalSpoofFixes(base: Fix, count: number): Fix[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: base.latitude + i * 0.00001,
    longitude: base.longitude,
    altitude: base.altitude,
    accuracy: 5,
    speed: 10,
    bearing: 180,
    timestamp: base.timestamp + (i < 3 ? 0 : 1000),
  }));
}

/** Physically impossible altitudes / accuracies. */
function buildEnvironmentalFixes(base: Fix): Fix[] {
  return [
    { ...base, altitude: 12000, accuracy: 500, timestamp: base.timestamp + 1000 },
    { ...base, altitude: 9500, accuracy: 150, timestamp: base.timestamp + 2000 },
  ];
}

/**
 * Lockstep C/N0 epochs — every satellite traces one waveform, the signature of
 * a generated constellation. Variance stays above the flat-signal skip
 * threshold so the real cn0Check flags it.
 */
function buildSpoofGnssEpoch(timestamp: number, epochIdx: number): GnssMeasurementSample {
  const constellations = [
    'GPS', 'GPS', 'GPS', 'GLONASS', 'GLONASS', 'GALILEO',
    'GALILEO', 'BEIDOU', 'BEIDOU', 'GPS', 'GALILEO', 'BEIDOU',
  ];
  return {
    satellites: constellations.map((constellation, i) => ({
      svid: i + 1,
      constellation,
      cn0DbHz: 22 + 8 * Math.sin(epochIdx),
    })),
    timestamp,
  };
}

function defaultFix(): Fix {
  return {
    latitude: 37.42,
    longitude: -122.084,
    altitude: 30,
    accuracy: 5,
    speed: 10,
    bearing: 180,
    timestamp: Date.now(),
  };
}

export function useAnchorPipeline() {
  // The SDK instance owns the recovery-debounce machine; RESET replaces it.
  const [sdk, setSdk] = useState<AnchorSDK>(() => createAnchorSDK());
  const location = useLocationStream();
  const imu = useImuStream();
  const baro = useBarometerStream();
  const gnss = useGnssMeasurements(WINDOW_GNSS_CAP);

  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [spoofing, setSpoofing] = useState(false);
  const [lastScenario, setLastScenario] = useState<ScenarioKind | null>(null);
  // Test harness is DISARMED by default: with it off, the app is 100% live sensors.
  const [demoArmed, setDemoArmed] = useState(false);
  const [detMs, setDetMs] = useState<number | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);

  const fixesRef = useRef<Fix[]>([]);
  const imuRef = useRef<ImuSample[]>([]);
  const baroRef = useRef<BaroSample[]>([]);
  const gnssRef = useRef<GnssMeasurementSample[]>([]);
  const lastStateRef = useRef<IntegrityState | null>(null);
  const eventIdRef = useRef(0);
  const generationRef = useRef(0);
  const lastFixTsRef = useRef<number | null>(null);
  const lastImuTsRef = useRef<number | null>(null);
  const lastBaroTsRef = useRef<number | null>(null);
  const lastGnssTsRef = useRef<number | null>(null);
  const locationFixRef = useRef<Fix | null>(null);
  const lastEvalAtRef = useRef(0);
  const spoofFixesRef = useRef<Fix[]>([]);
  const spoofGnssRef = useRef<GnssMeasurementSample[]>([]);

  const recordTransition = useCallback(
    (v: Verdict) => {
      const gen = generationRef.current;
      const id = (eventIdRef.current += 1);
      const entry: EventLogEntry = {
        id,
        timestamp: v.timestamp,
        state: v.state,
        reason: v.reason,
        failedChecks: v.failedChecks,
        explanation: null,
        embedding: null,
      };
      setEvents((prev) => [entry, ...prev]);

      // REAL on-device advisory enrichment (Qwen3 1.7B + mpnet embeddings).
      // The UI shows the deterministic reason until the model produces text.
      sdk
        .explain(v)
        .then((explanation: string) => {
          if (generationRef.current !== gen) return;
          setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, explanation } : e)));
        })
        .catch(() => {
          if (generationRef.current !== gen) return;
          setEvents((prev) =>
            prev.map((e) => (e.id === id ? { ...e, explanation: '(explanation unavailable)' } : e)),
          );
        });
      sdk
        .embed(v.reason)
        .then((embedding: number[]) => {
          if (generationRef.current !== gen) return;
          setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, embedding } : e)));
        })
        .catch(() => {});
    },
    [sdk],
  );

  /** Real network-integrity events (VPN tunnel / IP-GPS divergence) into the log. */
  const recordNetwork = useCallback((text: string) => {
    const id = (eventIdRef.current += 1);
    const entry: EventLogEntry = {
      id,
      timestamp: Date.now(),
      state: lastStateRef.current ?? 'TRUSTED',
      reason: text,
      failedChecks: [],
      explanation: null,
      embedding: null,
    };
    setEvents((prev) => [entry, ...prev]);
  }, []);

  const hapticForState = useCallback((state: IntegrityState) => {
    const type =
      state === 'DENIED'
        ? Haptics.NotificationFeedbackType.Error
        : state === 'TRUSTED'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning;
    void Haptics.notificationAsync(type).catch(() => {});
  }, []);

  // Real sensor streams push into the window refs, deduplicated by timestamp.
  useEffect(() => {
    if (!imu.sample) return;
    if (lastImuTsRef.current !== null && imu.sample.timestamp === lastImuTsRef.current) return;
    lastImuTsRef.current = imu.sample.timestamp;
    imuRef.current = pushCapped(imuRef.current, imu.sample, WINDOW_IMU_CAP);
  }, [imu.sample]);

  useEffect(() => {
    if (!baro.sample) return;
    if (lastBaroTsRef.current !== null && baro.sample.timestamp === lastBaroTsRef.current) return;
    lastBaroTsRef.current = baro.sample.timestamp;
    baroRef.current = pushCapped(baroRef.current, baro.sample, WINDOW_BARO_CAP);
  }, [baro.sample]);

  useEffect(() => {
    if (!gnss.latest) return;
    if (lastGnssTsRef.current !== null && gnss.latest.timestamp === lastGnssTsRef.current) return;
    lastGnssTsRef.current = gnss.latest.timestamp;
    gnssRef.current = pushCapped(gnssRef.current, gnss.latest, WINDOW_GNSS_CAP);
  }, [gnss.latest]);

  // One evaluation step: absorb new sensor data, drain at most one armed
  // harness frame, run the REAL pipeline with measured timing.
  const evaluateNow = useCallback(() => {
    const fix = locationFixRef.current;
    if (fix && (lastFixTsRef.current === null || fix.timestamp !== lastFixTsRef.current)) {
      lastFixTsRef.current = fix.timestamp;
      fixesRef.current = pushCapped(fixesRef.current, fix, WINDOW_FIX_CAP);
    }
    if (spoofFixesRef.current.length > 0) {
      const [spoofFix, ...rest] = spoofFixesRef.current;
      spoofFixesRef.current = rest;
      fixesRef.current = pushCapped(fixesRef.current, spoofFix, WINDOW_FIX_CAP);
    }
    if (spoofGnssRef.current.length > 0) {
      const [spoofEpoch, ...rest] = spoofGnssRef.current;
      spoofGnssRef.current = rest;
      gnssRef.current = pushCapped(gnssRef.current, spoofEpoch, WINDOW_GNSS_CAP);
    }
    if (fixesRef.current.length === 0) return;

    const { result: v, ms } = measureDeterministic(() =>
      sdk.evaluate({
        fixes: fixesRef.current,
        imu: imuRef.current,
        baro: baroRef.current,
        gnss: gnssRef.current,
      }),
    );
    lastEvalAtRef.current = Date.now();
    setVerdict(v);
    setDetMs(ms);

    const lastFix = fixesRef.current[fixesRef.current.length - 1];
    const lastEpoch = gnssRef.current[gnssRef.current.length - 1];
    const lastBaro = baroRef.current[baroRef.current.length - 1];
    setTelemetry({
      lat: lastFix.latitude,
      lon: lastFix.longitude,
      alt: lastFix.altitude,
      acc: lastFix.accuracy,
      speed: lastFix.speed,
      bearing: lastFix.bearing,
      sats: lastEpoch ? lastEpoch.satellites.length : null,
      baroHpa: lastBaro ? lastBaro.pressureHpa : null,
      fixAgeMs: Date.now() - lastFix.timestamp,
      imuCount: imuRef.current.length,
      baroCount: baroRef.current.length,
      gnssEpochs: gnssRef.current.length,
    });

    if (lastStateRef.current !== v.state) {
      lastStateRef.current = v.state;
      recordTransition(v);
      hapticForState(v.state);
    }
  }, [sdk, recordTransition, hapticForState]);

  // Immediate path: evaluate as soon as a NEW fix lands (live GPS at 1 Hz).
  useEffect(() => {
    if (!location.fix) return;
    locationFixRef.current = location.fix;
    if (lastFixTsRef.current === null || location.fix.timestamp !== lastFixTsRef.current) {
      evaluateNow();
    }
  }, [location.fix, evaluateNow]);

  // Stall-proof 1 Hz tick: keeps status/gauges live when GPS fixes stop, and
  // drains armed harness frames at a fixed cadence. Skips when the fix path
  // just evaluated so the debounce machine advances at ~1 eval/s, not 2.
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastEvalAtRef.current < 900) return;
      evaluateNow();
    }, 1000);
    return () => clearInterval(id);
  }, [evaluateNow]);

  const toggleDemoArmed = useCallback(() => setDemoArmed((v) => !v), []);

  const queueAttack = useCallback((fixes: Fix[], epochs: GnssMeasurementSample[]) => {
    if (spoofFixesRef.current.length > 0 || spoofGnssRef.current.length > 0) {
      spoofFixesRef.current = fixes;
      spoofGnssRef.current = epochs;
    } else {
      spoofFixesRef.current = spoofFixesRef.current.concat(fixes);
      spoofGnssRef.current = spoofGnssRef.current.concat(epochs);
    }
  }, []);

  const attackEpochs = useCallback(
    (count: number) => {
      const now = Date.now();
      return Array.from({ length: count }, (_, i) => buildSpoofGnssEpoch(now + i * 1000, i));
    },
    [],
  );

  /** TEST HARNESS (armed only): full compound attack — teleport + lockstep C/N0. */
  const injectSpoof = useCallback(() => {
    if (!demoArmed) return;
    setSpoofing(true);
    setLastScenario('compound');
    const base = fixesRef.current[fixesRef.current.length - 1] ?? defaultFix();
    queueAttack(buildSpoofFixes(base, 5), attackEpochs(5));
  }, [demoArmed, queueAttack, attackEpochs]);

  /** TEST HARNESS (armed only): single-fault scenarios, one per physics check. */
  const runScenario = useCallback(
    (kind: ScenarioKind) => {
      if (!demoArmed) return;
      setSpoofing(true);
      setLastScenario(kind);
      const base = fixesRef.current[fixesRef.current.length - 1] ?? defaultFix();
      switch (kind) {
        case 'teleport':
          queueAttack(buildSpoofFixes(base, 5), []);
          break;
        case 'cno':
          queueAttack([], attackEpochs(5));
          break;
        case 'altitude':
          queueAttack(buildAltitudeSpoofFixes(base, 5), []);
          break;
        case 'heading':
          queueAttack(buildHeadingSpoofFixes(base, 5), []);
          break;
        case 'temporal':
          queueAttack(buildTemporalSpoofFixes(base, 5), []);
          break;
        case 'environmental':
          queueAttack(buildEnvironmentalFixes(base), []);
          break;
        case 'compound':
          queueAttack(buildSpoofFixes(base, 5), attackEpochs(5));
          break;
      }
    },
    [demoArmed, queueAttack, attackEpochs],
  );

  /** Clear all pipeline state; the next evaluation starts from a fresh machine. */
  const reset = useCallback(() => {
    setSpoofing(false);
    setLastScenario(null);
    spoofFixesRef.current = [];
    spoofGnssRef.current = [];
    fixesRef.current = [];
    imuRef.current = [];
    baroRef.current = [];
    gnssRef.current = [];
    lastStateRef.current = null;
    lastFixTsRef.current = null;
    lastImuTsRef.current = null;
    lastBaroTsRef.current = null;
    lastGnssTsRef.current = null;
    eventIdRef.current = 0;
    generationRef.current += 1;
    setVerdict(null);
    setEvents([]);
    setDetMs(null);
    setTelemetry(null);
    setSdk(createAnchorSDK());
  }, []);

  /**
   * TEST HARNESS (armed only): full real RECOVERY arc on the real machine —
   * fresh state machine, staged attack drives TRUSTED→DEGRADED→DENIED, the
   * frames then age out of the window, 5 clean evaluations elapse, the machine
   * enters RECOVERING, and the next clean evaluation returns TRUSTED. Nothing
   * every transition is the real machine; the harness only stages the attack frames.
   */
  const recoveryDemo = useCallback(() => {
    if (!demoArmed) return;
    reset();
    setSpoofing(true);
    setLastScenario('compound');
    queueAttack(buildSpoofFixes(defaultFix(), 5), attackEpochs(5));
  }, [demoArmed, reset, queueAttack, attackEpochs]);

  return {
    // sensor health passthrough for instrument labels
    locationGranted: location.granted,
    locationError: location.error,
    imuError: imu.error,
    baroError: baro.error,
    gnssError: gnss.error,
    gnssStatus: gnss.status,
    gnssSupported: gnss.supported,
    // pipeline state
    verdict,
    events,
    spoofing,
    lastScenario,
    demoArmed,
    toggleDemoArmed,
    detMs,
    telemetry,
    injectSpoof,
    runScenario,
    recoveryDemo,
    recordNetwork,
    reset,
    sdk,
  };
}
