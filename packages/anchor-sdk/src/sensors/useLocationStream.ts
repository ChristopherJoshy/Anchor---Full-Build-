import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import type { Fix } from '../types';

/**
 * Maps an expo-location fix onto the SDK `Fix` contract.
 *
 * Nullability policy (native location fields can be null):
 *  - altitude null   -> 0 (absence treated as "no altitude information";
 *    altitudeCheck then sees a flat GPS altitude and defers to barometer)
 *  - accuracy null   -> +Infinity (unknown accuracy must not artificially pass
 *    the kinematic envelope; the environmental accuracy gate will fail it)
 *  - speed null      -> 0 (stationary unless proven otherwise)
 *  - heading null    -> 0 (bearing unknown; heading check only judges while moving)
 */
export function locationToFix(location: Location.LocationObject): Fix {
  const { coords, timestamp } = location;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    altitude: coords.altitude ?? 0,
    accuracy: coords.accuracy ?? Number.POSITIVE_INFINITY,
    speed: coords.speed ?? 0,
    bearing: coords.heading ?? 0,
    timestamp,
  };
}

export interface LocationStream {
  fix: Fix | null;
  error: string | null;
  granted: boolean;
}

/**
 * Streams foreground location fixes at 1 Hz (Balanced accuracy).
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
        { accuracy: Location.Accuracy.Balanced, timeInterval: 1000 },
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
