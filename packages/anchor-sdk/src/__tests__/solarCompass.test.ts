import { solarCompassHeading } from '../physics/solarCompass';

describe('solarCompassHeading', () => {
  it('places the sun nearly overhead at the equator on the equinox at noon', () => {
    // 2026-03-20T12:00:00Z, (0, 0): declination ~0, sun crosses near zenith.
    // (Azimuth is degenerate at zenith, so only elevation is asserted there.)
    const { elevationDeg } = solarCompassHeading(0, 0, new Date('2026-03-20T12:00:00Z'));
    expect(elevationDeg).toBeGreaterThan(88);
  });

  it('puts the morning sun in the east at the equator', () => {
    // 2026-03-20T09:00:00Z, (0, 0): ~3h before solar noon, sun low in the east.
    const { azimuthDeg, elevationDeg } = solarCompassHeading(0, 0, new Date('2026-03-20T09:00:00Z'));
    expect(azimuthDeg).toBeGreaterThan(85);
    expect(azimuthDeg).toBeLessThan(95);
    expect(elevationDeg).toBeGreaterThan(40);
    expect(elevationDeg).toBeLessThan(46);
  });

  it('matches the geometry of the June solstice at Greenwich', () => {
    // Declination +23.44°: expected elevation ~90 - (51.5 - 23.44) = ~61.9°.
    const { azimuthDeg, elevationDeg } = solarCompassHeading(51.5, 0, new Date('2026-06-21T12:00:00Z'));
    expect(elevationDeg).toBeGreaterThan(60.5);
    expect(elevationDeg).toBeLessThan(63.5);
    expect(azimuthDeg).toBeGreaterThan(175);
    expect(azimuthDeg).toBeLessThan(185);
  });

  it('matches the December solstice seen from Sydney', () => {
    // Solar noon Sydney (~151.2E) ~01:55 UTC; elevation ~90 - |-33.87 + 23.44| = ~79.3°.
    const { azimuthDeg, elevationDeg } = solarCompassHeading(-33.8688, 151.2153, new Date('2026-12-21T01:55:00Z'));
    expect(elevationDeg).toBeGreaterThan(78);
    expect(elevationDeg).toBeLessThan(81);
    // Southern-hemisphere winter: the noon sun is due NORTH (~358°).
    expect(azimuthDeg).toBeGreaterThan(350);
  });

  it('shows the sun low in the north for polar night edge cases', () => {
    // Tromsø (69.65N) on the winter solstice: sun stays just below the horizon.
    const { elevationDeg } = solarCompassHeading(69.6492, 18.9553, new Date('2026-12-21T12:00:00Z'));
    expect(elevationDeg).toBeLessThan(0);
  });

  it('gives ~177° azimuth at the clean-drive fixture location/time', () => {
    // Anchor for the fixture design: Googleplex, 2026-06-21T20:00:00Z.
    const { azimuthDeg, elevationDeg } = solarCompassHeading(37.4219983, -122.084, new Date('2026-06-21T20:00:00Z'));
    // ~10 min before solar noon: azimuth ~170°, moving ~1°/min near noon.
    expect(azimuthDeg).toBeGreaterThan(165);
    expect(azimuthDeg).toBeLessThan(180);
    expect(elevationDeg).toBeGreaterThan(72);
    expect(elevationDeg).toBeLessThan(79);
  });

  it('moves the azimuth from east to west across the morning', () => {
    const morning = solarCompassHeading(37.42, -122.084, new Date('2026-06-21T14:00:00Z')).azimuthDeg;
    const afternoon = solarCompassHeading(37.42, -122.084, new Date('2026-06-21T23:00:00Z')).azimuthDeg;
    expect(morning).toBeLessThan(180);
    expect(afternoon).toBeGreaterThan(180);
  });
});
