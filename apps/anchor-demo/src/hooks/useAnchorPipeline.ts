/**
 * useAnchorPipeline — app-side wiring of the anchor-sdk integrity pipeline.
 *
 * Owns NO physics and NO state-machine logic: all six checks, the verdict,
 * explanations, embeddings, and transcription come from the SDK. This hook
 * only feeds SDK sensor streams into ring buffers, calls sdk.evaluate on each
 * fix, records state transitions into the flight-recorder event log, and
 * exposes the labeled SIMULATE SPOOF test-harness injection (synthetic jumped
 * fix burst + degraded C/N0 epochs pushed through the normal pipeline).
 *
 * The SDK's evaluate() owns the recovery-debounce state machine internally
 * (prevState only seeds its first call), so this hook never threads its own
 * state; RESET swaps in a fresh SDK instance, which resets that machine.
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

export const WINDOW_FIX_CAP = 60;
export const WINDOW_IMU_CAP = 60;
export const WINDOW_BARO_CAP = 60;
export const WINDOW_GNSS_CAP = 30;

/** One flight-recorder line: a pipeline state transition. */
export interface EventLogEntry {
  id: number;
  timestamp: number;
  state: IntegrityState;
  reason: string;
  failedChecks: CheckId[];
  /** Plain-language explanation, filled in when sdk.explain resolves. */
  explanation: string | null;
  /** Reason embedding, filled in when sdk.embed resolves (semantic search). */
  embedding: number[] | null;
}

function pushCapped<T>(arr: T[], item: T, cap: number): T[] {
  const next = arr.length >= cap ? arr.slice(arr.length - cap + 1) : arr.slice();
  next.push(item);
  return next;
}

/**
 * Builds the labeled SIMULATE SPOOF segment: fixes that teleport ~400 m per
 * second while claiming implausibly good accuracy and a speed that does not
 * match the implied displacement. The SDK's checks do the judging; this only
 * fabricates the sensor frames the demo injects.
 */
function buildSpoofFixes(base: Fix, count: number): Fix[] {
  const out: Fix[] = [];
  let lat = base.latitude;
  let lon = base.longitude;
  for (let i = 0; i < count; i += 1) {
    lat += 400 / 111_320; // ~400 m north per second of "flight"
    lon += 150 / (111_320 * Math.cos((base.latitude * Math.PI) / 180));
    out.push({
      latitude: lat,
      longitude: lon,
      altitude: base.altitude + 40 * (i + 1),
      accuracy: 2.5, // spoofers report suspiciously good accuracy
      speed: 4.2, // claimed speed wildly inconsistent with 400 m/s implied
      bearing: 15,
      timestamp: base.timestamp + (i + 1) * 1000,
    });
  }
  return out;
}

/**
 * Synthetic measurement epoch whose satellites move in LOCKSTEP — every
 * satellite traces the same waveform across the injected epochs, which is the
 * signature of a generated (spoofed) constellation. Waveform variance stays
 * above the flat-signal skip threshold so the SDK's cn0Check flags it instead
 * of skipping it.
 */
function buildSpoofGnssEpoch(timestamp: number, epochIdx: number): GnssMeasurementSample {
  const constellations = [
    'GPS',
    'GPS',
    'GPS',
    'GLONASS',
    'GLONASS',
    'GALILEO',
    'GALILEO',
    'BEIDOU',
    'BEIDOU',
    'GPS',
    'GALILEO',
    'BEIDOU',
  ];
  return {
    satellites: constellations.map((constellation, i) => ({
      svid: i + 1,
      constellation,
      cn0DbHz: 22 + 8 * Math.sin(epochIdx), // identical across satellites per epoch
    })),
    timestamp,
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

  // Sensor window lives in refs: sensor ticks are far more frequent than
  // renders; only verdict changes re-render the instrument.
  const fixesRef = useRef<Fix[]>([]);
  const imuRef = useRef<ImuSample[]>([]);
  const baroRef = useRef<BaroSample[]>([]);
  const gnssRef = useRef<GnssMeasurementSample[]>([]);
  const lastStateRef = useRef<IntegrityState | null>(null);
  const eventIdRef = useRef(0);
  const generationRef = useRef(0);
  // Dedup refs — ensure each sensor sample is pushed once.
  const lastFixTsRef = useRef<number | null>(null);
  const lastImuTsRef = useRef<number | null>(null);
  const lastBaroTsRef = useRef<number | null>(null);
  const lastGnssTsRef = useRef<number | null>(null);
  // Pending SIMULATE SPOOF frames queued by injectSpoof().
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

      // Fire-and-forget AI enrichment; the UI never waits on it.
      // Generation guard prevents stale promises from overwriting after RESET.
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

  const hapticForState = useCallback((state: IntegrityState) => {
    const type =
      state === 'DENIED'
        ? Haptics.NotificationFeedbackType.Error
        : state === 'TRUSTED'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning;
    void Haptics.notificationAsync(type).catch(() => {});
  }, []);

  // Keep IMU/baro/GNSS windows fresh at their own cadence, deduplicated.
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

  // Drive evaluation once per fix (1 Hz). Buffer updates land in refs; only
  // verdict changes re-render the instrument.
  useEffect(() => {
    if (!location.fix) {
      return;
    }
    if (lastFixTsRef.current !== null && location.fix.timestamp === lastFixTsRef.current) return;
    lastFixTsRef.current = location.fix.timestamp;
    fixesRef.current = pushCapped(fixesRef.current, location.fix, WINDOW_FIX_CAP);
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

    const v = sdk.evaluate({
      fixes: fixesRef.current,
      imu: imuRef.current,
      baro: baroRef.current,
      gnss: gnssRef.current,
    });
    setVerdict(v);

    if (lastStateRef.current !== v.state) {
      lastStateRef.current = v.state;
      recordTransition(v);
      hapticForState(v.state);
    }
  }, [location.fix, sdk, recordTransition, hapticForState]);

  /** Labeled test-harness control: queue a jumped fix burst + degraded C/N0. */
  const injectSpoof = useCallback(() => {
    setSpoofing(true);
    // Bound queue: replace pending spoof if already queued, don't accumulate unbounded.
    const base =
      fixesRef.current[fixesRef.current.length - 1] ??
      ({
        latitude: 37.42,
        longitude: -122.084,
        altitude: 30,
        accuracy: 5,
        speed: 10,
        bearing: 180,
        timestamp: Date.now(),
      } satisfies Fix);
    const fixes = buildSpoofFixes(base, 5);
    const now = Date.now();
    const epochs = [0, 1, 2, 3, 4].map((epochIdx) => buildSpoofGnssEpoch(now + epochIdx * 1000, epochIdx));
    // Cap concurrent spoof queue to one burst (5 fixes/epochs); drop previous if still pending.
    if (spoofFixesRef.current.length > 0 || spoofGnssRef.current.length > 0) {
      spoofFixesRef.current = fixes;
      spoofGnssRef.current = epochs;
    } else {
      spoofFixesRef.current = spoofFixesRef.current.concat(fixes);
      spoofGnssRef.current = spoofGnssRef.current.concat(epochs);
    }
  }, []);

  /** Labeled test-harness control: clear all pipeline state; next evaluation starts fresh. */
  const reset = useCallback(() => {
    setSpoofing(false);
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
    // Fresh instance resets the SDK-internal recovery-debounce machine.
    setSdk(createAnchorSDK());
  }, []);

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
    injectSpoof,
    reset,
    sdk,
  };
}
