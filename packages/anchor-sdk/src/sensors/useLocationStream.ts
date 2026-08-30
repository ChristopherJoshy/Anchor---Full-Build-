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
 * Streams foreground location fixes at 1 Hz.
 *
 * Balanced accuracy is used for real-phone indoor robustness: High (~10 m)
 * would require a GPS satellite fix that is unavailable indoors on many
 * devices (e.g., iQOO I2501 shows 0 GPS reports but fused has a fix), so the
 * stream would stall and the dashboard would show stale HOLD. Balanced
 * delivers fused/network fixes indoors at ~20-50 m accuracy, which the
 * kinematic envelope and heading checks handle via the reported accuracy
 * value as physics input — the checks remain real, just with larger
 * tolerances, and the app stays live.
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

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 1000, distanceInterval: 0 },
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
