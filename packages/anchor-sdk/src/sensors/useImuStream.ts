import { useEffect, useRef, useState } from 'react';
import { Gyroscope, Magnetometer } from 'expo-sensors';
import { magnetometerHeadingDeg, wrapAngleDelta } from './headingMath';
import type { ImuSample } from '../types';

export { magnetometerHeadingDeg };

/** Complementary-filter gain: weight of the magnetometer correction per mag sample. */
const MAG_GAIN = 0.1;
/** Update interval for both sensors, ms (~10 Hz each). */
const UPDATE_INTERVAL_MS = 100;

export interface ImuStream {
  sample: ImuSample | null;
  error: string | null;
}

/**
 * Streams fused inertial samples at ~10 Hz.
 *
 * A complementary filter fuses the two sensors: the gyroscope's z-axis rate
 * (rad/s; positive = counterclockwise seen from above, i.e. compass heading
 * decreasing) propagates the heading between magnetometer samples, and each
 * magnetometer sample applies a small correction (gain MAG_GAIN) via the
 * shortest angular difference. headingDeg is null until the first
 * magnetometer fix; gyroRadSec is null until the first gyroscope event. A
 * sample is emitted on every sensor event (up to ~20 Hz while both run).
 */
export function useImuStream(): ImuStream {
  const [sample, setSample] = useState<ImuSample | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter state lives in refs so listeners never go stale across renders.
  const headingRef = useRef<number | null>(null);
  const lastGyroTimeRef = useRef<number | null>(null);
  const latestGyroRef = useRef<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const emit = () => {
      setSample({
        headingDeg: headingRef.current,
        gyroRadSec: latestGyroRef.current,
        timestamp: Date.now(),
      });
    };

    (async () => {
      const [magAvailable, gyroAvailable] = await Promise.all([
        Magnetometer.isAvailableAsync(),
        Gyroscope.isAvailableAsync(),
      ]);
      if (cancelled) return;
      if (!magAvailable && !gyroAvailable) {
        setError('No magnetometer or gyroscope available on this device.');
        return;
      }

      if (magAvailable) {
        Magnetometer.setUpdateInterval(UPDATE_INTERVAL_MS);
        Magnetometer.addListener(({ x, y }) => {
          if (cancelled) return;
          const magHeading = magnetometerHeadingDeg(x, y);
          headingRef.current =
            headingRef.current === null
              ? magHeading
              : headingRef.current + MAG_GAIN * wrapAngleDelta(magHeading - headingRef.current);
          emit();
        });
      }

      if (gyroAvailable) {
        Gyroscope.setUpdateInterval(UPDATE_INTERVAL_MS);
        Gyroscope.addListener(({ x, y, z }) => {
          if (cancelled) return;
          const now = Date.now();
          const last = lastGyroTimeRef.current;
          if (headingRef.current !== null && last !== null && now > last) {
            const dtSeconds = (now - last) / 1000;
            // Positive gz rotates counterclockwise; compass heading is
            // clockwise-positive, so the integrated rate is negated.
            headingRef.current -= (z * dtSeconds * 180) / Math.PI;
            headingRef.current = ((headingRef.current % 360) + 360) % 360;
          }
          lastGyroTimeRef.current = now;
          latestGyroRef.current = { x, y, z };
          emit();
        });
      }
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      Magnetometer.removeAllListeners();
      Gyroscope.removeAllListeners();
    };
  }, []);

  return { sample, error };
}
