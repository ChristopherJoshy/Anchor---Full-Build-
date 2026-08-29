import type { Fix } from '../types';
import type { LocationObject } from 'expo-location';

/**
 * Maps an expo-location fix onto the SDK `Fix` contract.
 *
 * Nullability policy (native location fields can be null):
 *  - altitude null   -> 0 (absence treated as "no altitude information";
 *    altitudeCheck then sees a flat GPS altitude and defers to the barometer)
 *  - accuracy null   -> +Infinity (unknown accuracy must not artificially pass
 *    the kinematic envelope; the environmental accuracy gate will fail it)
 *  - speed null      -> 0 (stationary unless proven otherwise)
 *  - heading null    -> 0 (bearing unknown; heading check only judges while moving)
 *
 * Kept free of runtime expo-location imports so it is unit-testable in Node;
 * the type-only import disappears at runtime.
 */
export function locationToFix(location: LocationObject): Fix {
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
