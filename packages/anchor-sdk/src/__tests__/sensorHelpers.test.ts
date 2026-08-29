import { locationToFix } from '../sensors/fixMapping';
import { magnetometerHeadingDeg, wrapAngleDelta } from '../sensors/headingMath';
import type { LocationObject } from 'expo-location';

describe('locationToFix', () => {
  it('maps a complete location object', () => {
    const location = {
      coords: {
        latitude: 37.42,
        longitude: -122.084,
        altitude: 31.5,
        accuracy: 6.2,
        altitudeAccuracy: 4,
        heading: 182,
        speed: 11.3,
      },
      timestamp: 1782072000000,
    } as LocationObject;
    expect(locationToFix(location)).toEqual({
      latitude: 37.42,
      longitude: -122.084,
      altitude: 31.5,
      accuracy: 6.2,
      speed: 11.3,
      bearing: 182,
      timestamp: 1782072000000,
    });
  });

  it('applies the documented nullability policy', () => {
    const location = {
      coords: {
        latitude: 1,
        longitude: 2,
        altitude: null,
        accuracy: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: 5,
    } as unknown as LocationObject;
    const fix = locationToFix(location);
    expect(fix.altitude).toBe(0);
    expect(fix.accuracy).toBe(Number.POSITIVE_INFINITY);
    expect(fix.speed).toBe(0);
    expect(fix.bearing).toBe(0);
  });
});

describe('magnetometerHeadingDeg', () => {
  // Field pointing magnetic north is my = +Bh when the device top faces north.
  const Bh = 40;

  it('reports 0 when the device top faces north', () => {
    expect(magnetometerHeadingDeg(0, Bh)).toBeCloseTo(0, 5);
  });

  it('reports 90 when the device top faces east', () => {
    expect(magnetometerHeadingDeg(-Bh, 0)).toBeCloseTo(90, 5);
  });

  it('reports 180 when the device top faces south', () => {
    expect(magnetometerHeadingDeg(0, -Bh)).toBeCloseTo(180, 5);
  });

  it('reports 270 when the device top faces west', () => {
    expect(magnetometerHeadingDeg(Bh, 0)).toBeCloseTo(270, 5);
  });

  it('stays in [0, 360)', () => {
    expect(magnetometerHeadingDeg(Bh * 0.7, -Bh * 0.7)).toBeGreaterThanOrEqual(0);
    expect(magnetometerHeadingDeg(Bh * 0.7, -Bh * 0.7)).toBeLessThan(360);
  });
});

describe('wrapAngleDelta', () => {
  it('takes the shortest path across the 0/360 boundary', () => {
    expect(wrapAngleDelta(350 - 10)).toBe(-20);
    expect(wrapAngleDelta(10 - 350)).toBe(20);
    expect(wrapAngleDelta(90)).toBe(90);
    expect(wrapAngleDelta(-90)).toBe(-90);
  });
});
