import { useEffect, useRef, useState } from 'react';
import AnchorGnss, {
  type AnchorGnssStatus,
} from '../gnss/AnchorGnssModule';
import type { GnssMeasurementSample } from '../types';
import { RingBuffer } from '../utils/ringBuffer';

export interface GnssMeasurementsStream {
  latest: GnssMeasurementSample | null;
  /** Last `historyLength` measurement epochs, chronological (oldest first). */
  history: GnssMeasurementSample[];
  error: string | null;
  status: AnchorGnssStatus | null;
  supported: boolean | null;
}

/**
 * Streams raw GNSS C/N0 measurement epochs from the AnchorGnss native module
 * and retains the last `historyLength` epochs in a ring buffer (default 600,
 * ~10 minutes at 1 Hz).
 *
 * Like the other sensor hooks this does NOT request permissions: the app must
 * have ACCESS_FINE_LOCATION granted before mounting. Permission failures,
 * disabled GPS, and unsupported devices surface through `error`.
 */
export function useGnssMeasurements(historyLength = 600): GnssMeasurementsStream {
  const [latest, setLatest] = useState<GnssMeasurementSample | null>(null);
  const [history, setHistory] = useState<GnssMeasurementSample[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AnchorGnssStatus | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const bufferRef = useRef(new RingBuffer<GnssMeasurementSample>(historyLength));

  useEffect(() => {
    let cancelled = false;

    const measurementSubscription = AnchorGnss.addListener('onMeasurement', (event) => {
      if (cancelled) return;
      const sample: GnssMeasurementSample = {
        satellites: event.satellites.map((satellite) => ({
          svid: satellite.svid,
          constellation: satellite.constellation,
          cn0DbHz: satellite.cn0DbHz,
        })),
        timestamp: event.timestamp,
        ...(event.elapsedRealtimeNanos !== undefined
          ? { elapsedRealtimeNanos: event.elapsedRealtimeNanos }
          : {}),
      };
      bufferRef.current.push(sample);
      setLatest(sample);
      setHistory(bufferRef.current.toArray());
    });

    const errorSubscription = AnchorGnss.addListener('onError', (event) => {
      if (cancelled) return;
      setError(`${event.code}: ${event.message}`);
    });

    const statusSubscription = AnchorGnss.addListener('onStatus', (event) => {
      if (cancelled) return;
      setStatus(event.status);
    });

    (async () => {
      const isSupported = AnchorGnss.isSupported();
      if (cancelled) return;
      setSupported(isSupported);
      if (!isSupported) {
        setError('E_UNSUPPORTED: Raw GNSS measurements require Android 7.0 (API 24)+ with a LocationManager.');
        return;
      }
      await AnchorGnss.start();
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      measurementSubscription.remove();
      errorSubscription.remove();
      statusSubscription.remove();
      AnchorGnss.stop().catch(() => {
        // stop() failing at teardown (module already torn down) is not actionable.
      });
    };
  }, [historyLength]);

  return { latest, history, error, status, supported };
}
