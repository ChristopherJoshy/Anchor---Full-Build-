import { useEffect, useRef, useState } from 'react';
import { Gyroscope, Magnetometer } from 'expo-sensors';
import { magnetometerHeadingDeg, wrapAngleDelta } from './headingMath';
import type { ImuSample } from '../types';

export { magnetometerHeadingDeg };

/** Complementary-filter gain: weight of the magnetometer correction per mag sample. */
const MAG_GAIN = 0.1;
/** Update interval for both sensors, ms (~10 Hz each). */
const UPDATE_INTERVAL_MS = 100;

/** |B| sanity window, µT: Earth field is 25–65 µT. Outside = uncalibrated or interfered. */
export const MAG_FIELD_MIN_UT = 25;
export const MAG_FIELD_MAX_UT = 65;

/** Max |ωz| (rad/s) for the recent window to count as "at rest" for bias estimation. */
const GYRO_REST_RATE_RAD_S = 0.05;
/** Rolling window size for rest-bias estimation (~1 s at 10 Hz). */
const GYRO_BIAS_WINDOW = 10;

export interface ImuStream {
  sample: ImuSample | null;
  error: string | null;
}

/**
 * Streams fused inertial samples at ~10 Hz with live calibration signals.
 *
 * Fusion: a complementary filter — the gyroscope's z-axis rate propagates the
 * heading between magnetometer samples, and each magnetometer sample applies a
 * small correction (gain MAG_GAIN) via the shortest angular difference.
 *
 * Calibration (all computed from raw data — expo-sensors drops the native
 * SENSOR_STATUS_* callback, so quality is derived from physics):
 *  - Compass: |B| = √(x²+y²+z²) must sit inside the 25–65 µT Earth window;
 *    outside it the HAL's hard-iron estimate is off or the environment is
 *     magnetically hostile (figure-8 motion re-converges it).
 *  - Gyro: while the recent ω window stays under GYRO_REST_RATE_RAD_S the
 *    device is at rest and the window mean is a live z-bias estimate; it is
 *    subtracted from every integrated rate (AOSP app-side rest-bias recipe).
 */
export function useImuStream(): ImuStream {
  const [sample, setSample] = useState<ImuSample | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter state lives in refs so listeners never go stale across renders.
  const headingRef = useRef<number | null>(null);
  const lastGyroTimeRef = useRef<number | null>(null);
  const latestGyroRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const magFieldRef = useRef<number | null>(null);
  const magCalibratedRef = useRef<boolean | null>(null);
  const gyroBiasZRef = useRef<number>(0);
  const gyroWindowRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Per-subscription handles so teardown never disturbs other consumers
    // (removeAllListeners would kill subscriptions owned by other components).
    const subscriptions: Array<{ remove: () => void }> = [];

    const emit = () => {
      setSample({
        headingDeg: headingRef.current,
        gyroRadSec: latestGyroRef.current,
        timestamp: Date.now(),
        magFieldUt: magFieldRef.current,
        magCalibrated: magCalibratedRef.current,
        gyroBiasRadSec: gyroWindowRef.current.length >= GYRO_BIAS_WINDOW ? gyroBiasZRef.current : null,
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
        subscriptions.push(Magnetometer.addListener(({ x, y, z }) => {
          if (cancelled) return;
          // |B| magnitude — real physics-based calibration quality signal.
          const magnitude = Math.sqrt(x * x + y * y + z * z);
          if (Number.isFinite(magnitude) && magnitude > 0) {
            magFieldRef.current = magnitude;
            magCalibratedRef.current =
              magnitude >= MAG_FIELD_MIN_UT && magnitude <= MAG_FIELD_MAX_UT;
          }
          const magHeading = magnetometerHeadingDeg(x, y);
          headingRef.current =
            headingRef.current === null
              ? magHeading
              : headingRef.current + MAG_GAIN * wrapAngleDelta(magHeading - headingRef.current);
          emit();
        }));
      }

      if (gyroAvailable) {
        Gyroscope.setUpdateInterval(UPDATE_INTERVAL_MS);
        subscriptions.push(Gyroscope.addListener(({ x, y, z }) => {
          if (cancelled) return;
          const now = Date.now();
          // Rolling rest window for the live bias estimate: every |ω| small
          // over the window ⇒ device at rest ⇒ mean z is the true bias.
          gyroWindowRef.current.push(z);
          if (gyroWindowRef.current.length > GYRO_BIAS_WINDOW) gyroWindowRef.current.shift();
          if (gyroWindowRef.current.length === GYRO_BIAS_WINDOW) {
            const atRest = gyroWindowRef.current.every(
              (rate) => Math.abs(rate - gyroBiasZRef.current) < GYRO_REST_RATE_RAD_S,
            );
            if (atRest) {
              const mean =
                gyroWindowRef.current.reduce((sum, rate) => sum + rate, 0) / GYRO_BIAS_WINDOW;
              gyroBiasZRef.current = mean;
            }
          }
          const last = lastGyroTimeRef.current;
          if (headingRef.current !== null && last !== null && now > last) {
            const dtSeconds = (now - last) / 1000;
            // Positive gz rotates counterclockwise; compass heading is
            // clockwise-positive, so the integrated rate is negated. The
            // live rest-bias estimate is subtracted before integrating.
            const rateZ = z - gyroBiasZRef.current;
            headingRef.current -= (rateZ * dtSeconds * 180) / Math.PI;
            headingRef.current = ((headingRef.current % 360) + 360) % 360;
          }
          lastGyroTimeRef.current = now;
          latestGyroRef.current = { x, y, z };
          emit();
        }));
      }
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  return { sample, error };
}
