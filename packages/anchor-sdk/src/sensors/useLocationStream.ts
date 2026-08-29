import { useEffect, useState } from 'react';
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
 * Streams foreground location fixes at 1 Hz (High accuracy, ~10 m fixes).
 *
 * High (not Balanced) is deliberate: the kinematic envelope and heading
 * track-bearing checks judge the fix against its reported accuracy — tight,
 * trustworthy fixes make the integrity checks meaningful, and the accuracy
 * value itself is part of the physics.
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

    (async () => {
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
        { accuracy: Location.Accuracy.High, timeInterval: 1000 },
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
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return { fix, error, granted };
}
