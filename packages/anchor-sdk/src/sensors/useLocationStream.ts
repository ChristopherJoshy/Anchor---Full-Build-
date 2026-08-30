import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { locationToFix } from './fixMapping';
import type { Fix } from '../types';

export { locationToFix };

export interface LocationStream {
  fix: Fix | null;
  error: string | null;
  granted: boolean;
}

/**
 * Streams foreground location fixes at ~1 Hz.
 *
 * BestForNavigation is the live-data choice (Expo SDK 57 maps it to Android
 * PRIORITY_HIGH_ACCURACY with a 500 ms interval and 0 m distance gate): the
 * fused provider uses GPS + Wi-Fi + cell, delivering every computed fix
 * outdoors at ~1 Hz and indoors from the network layer, instead of Balanced,
 * which stops computing entirely while the device sits on one Wi-Fi AP.
 *
 * A real last-known position (LocationManager cache) seeds the stream
 * immediately with its own original timestamp — staleness is judged from that
 * timestamp downstream, never re-stamped.
 *
 * Permission policy: the embedding app is responsible for requesting location
 * permission BEFORE mounting this hook; this hook only reads the current
 * permission status and reports `granted` + a descriptive error otherwise.
 */
export function useLocationStream(): LocationStream {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    const start = async (): Promise<void> => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (cancelled) return;
      setGranted(permission.granted);
      if (!permission.granted) {
        setError(
          'Location permission has not been granted. Request foreground location permission in the app before streaming.',
        );
        return;
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (cancelled) return;
      if (!servicesEnabled) {
        setError('Location services are disabled. Enable device location to receive fixes.');
        return;
      }

      // Real cached fix first (own timestamp preserved — may be stale, the
      // pipeline judges age downstream). Never synthesized, never re-stamped.
      try {
        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 15_000,
          requiredAccuracy: 500,
        });
        if (!cancelled && lastKnown) {
          setFix(locationToFix(lastKnown));
        }
      } catch {
        // No usable cached fix — the live stream below delivers the first one.
      }

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (location) => {
          if (cancelled) return;
          setError(null);
          setFix(locationToFix(location));
        },
        (watchError) => {
          if (cancelled) return;
          setError(watchError || 'Unknown location error.');
        },
      );
    };

    // Re-sample permission/services whenever the app returns to foreground:
    // a user granting in system settings and returning must resume the
    // stream without an app restart.
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (subscription) return; // already streaming
      void start();
    });

    void start();

    return () => {
      cancelled = true;
      appStateSubscription.remove();
      subscription?.remove();
    };
  }, []);

  return { fix, error, granted };
}
