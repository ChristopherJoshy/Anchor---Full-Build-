import { useEffect, useRef, useState } from 'react';
import { Barometer } from 'expo-sensors';
import type { BaroSample } from '../types';

export interface BarometerStream {
  sample: BaroSample | null;
  error: string | null;
}

/**
 * Streams barometric pressure at ~10 Hz as { pressureHpa, timestamp }.
 *
 * The device barometer reports absolute atmospheric pressure in hPa; altitude
 * derivation from pressure happens in altitudeCheck via the barometric
 * formula, not here.
 *
 * `error` is set when the device has no barometer. No data is ever
 * synthesized in its place.
 */
export function useBarometerStream(): BarometerStream {
  const [sample, setSample] = useState<BaroSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const available = await Barometer.isAvailableAsync();
      if (cancelled) return;
      if (!available) {
        // No barometer hardware (e.g., iQOO I2501) — not an error, just no data;
        // altitudeCheck handles this as "no barometer" and passes, telemetry shows —.
        return;
      }
      Barometer.setUpdateInterval(100);
      // Keep the handle in a ref so cleanup always sees the live subscription.
      subscriptionRef.current = Barometer.addListener((measurement) => {
        if (cancelled) return;
        // Contract timestamps are epoch milliseconds; the sensor timestamp is
        // in seconds, so receipt time is used for the window ordering clock.
        setSample({ pressureHpa: measurement.pressure, timestamp: Date.now() });
      });
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, []);

  return { sample, error };
}
