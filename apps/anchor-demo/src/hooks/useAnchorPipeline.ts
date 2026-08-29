/**
 * useAnchorPipeline — app-side wiring of the anchor-sdk integrity pipeline.
 *
 * Owns NO physics and NO state-machine logic: all six checks, the verdict,
 * explanations, embeddings, and transcription come from the SDK. This hook
 * only feeds SDK sensor streams into ring buffers, calls sdk.evaluate on each
 * fix, records state transitions into the flight-recorder event log, and
 * exposes the labeled SIMULATE SPOOF test-harness injection (synthetic jumped
 * fix burst + degraded C/N0 epochs pushed through the normal pipeline).
 */
import { useBarometerStream, useGnssMeasurements, useImuStream, useLocationStream } from 'anchor-sdk';
import type {
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
 * match the implied displacement. The SDK's kinematic/cn0 checks do the
 * judging; this only fabricates the sensor frames the demo injects.
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

/** Synthetic measurement epoch with a collapsing C/N0 profile. */
function buildSpoofGnssEpoch(timestamp: number): GnssMeasurementSample {
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
      cn0DbHz: 14 + ((i * 7) % 9), // 14..22 dB-Hz — deep degradation vs typical 30..50
    })),
    timestamp,
  };
}

export function useAnchorPipeline() {
  const sdk = useMemo(() => createAnchorSDK(), []);
  const location = useLocationStream();
  const imu = useImuStream();
  const baro = useBarometerStream();
  const gnss = useGnssMeasurements(WINDOW_GNSS_CAP);

  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [spoofing, setSpoofing] = useState(false);

  // Sensor window lives in refs: sensor ticks are far more frequent than
  // renders; only verdicts trigger UI updates.
  const fixesRef = useRef<Fix[]>([]);
  const imuRef = useRef<ImuSample[]>([]);
  const baroRef = useRef<BaroSample[]>([]);
  const gnssRef = useRef<GnssMeasurementSample[]>([]);
  const prevStateRef = useRef<IntegrityState | undefined>(undefined);
  const lastStateRef = useRef<IntegrityState | null>(null);
  const eventIdRef = useRef(0);
  // Pending SIMULATE SPOOF frames queued by injectSpoof().
  const spoofFixesRef = useRef<Fix[]>([]);
  const spoofGnssRef = useRef<GnssMeasurementSample[]>([]);

  const recordTransition = useCallback(
    (v: Verdict) => {
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
      sdk
        .explain(v)
        .then((explanation: string) => {
          setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, explanation } : e)));
        })
        .catch(() => {
          setEvents((prev) =>
            prev.map((e) => (e.id === id ? { ...e, explanation: '(explanation unavailable)' } : e)),
          );
        });
      sdk
        .embed(v.reason)
        .then((embedding: number[]) => {
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

  // Drive evaluation once per fix (1 Hz). Buffer updates land in refs; only
  // verdict changes re-render the instrument.
  useEffect(() => {
    if (!location.fix) {
      return;
    }
    fixesRef.current = pushCapped(fixesRef.current, location.fix, WINDOW_FIX_CAP);
    if (imu.sample) {
      imuRef.current = pushCapped(imuRef.current, imu.sample, WINDOW_IMU_CAP);
    }
    if (baro.sample) {
      baroRef.current = pushCapped(baroRef.current, baro.sample, WINDOW_BARO_CAP);
    }
    if (spoofFixesRef.current.length > 0) {
      const [spoofFix, ...rest] = spoofFixesRef.current;
      spoofFixesRef.current = rest;
      fixesRef.current = pushCapped(fixesRef.current, spoofFix, WINDOW_FIX_CAP);
    }
    if (gnss.latest) {
      gnssRef.current = pushCapped(gnssRef.current, gnss.latest, WINDOW_GNSS_CAP);
    }
    if (spoofGnssRef.current.length > 0) {
      const [spoofEpoch, ...rest] = spoofGnssRef.current;
      spoofGnssRef.current = rest;
      gnssRef.current = pushCapped(gnssRef.current, spoofEpoch, WINDOW_GNSS_CAP);
    }

    const v = sdk.evaluate(
      {
        fixes: fixesRef.current,
        imu: imuRef.current,
        baro: baroRef.current,
        gnss: gnssRef.current,
      },
      prevStateRef.current,
    );
    prevStateRef.current = v.state;
    setVerdict(v);

    if (lastStateRef.current !== v.state) {
      lastStateRef.current = v.state;
      recordTransition(v);
      hapticForState(v.state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.fix, recordTransition, hapticForState, sdk]);

  /** Labeled test-harness control: queue a jumped fix burst + degraded C/N0. */
  const injectSpoof = useCallback(() => {
    setSpoofing(true);
    const base =
      fixesRef.current[fixesRef.current.length - 1] ??
      ({
        latitude: 0,
        longitude: 0,
        altitude: 0,
        accuracy: 10,
        speed: 0,
        bearing: 0,
        timestamp: Date.now(),
      } satisfies Fix);
    spoofFixesRef.current = spoofFixesRef.current.concat(buildSpoofFixes(base, 5));
    const now = Date.now();
    spoofGnssRef.current = spoofGnssRef.current.concat(
      [0, 1, 2, 3, 4].map((i) => buildSpoofGnssEpoch(now + i * 1000)),
    );
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
    prevStateRef.current = undefined;
    lastStateRef.current = null;
    eventIdRef.current = 0;
    setVerdict(null);
    setEvents([]);
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
