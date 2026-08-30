import type { CheckResult, SensorWindow } from '../types';

/**
 * Network-integrity check: a VPN tunnel is a location-integrity inconsistency.
 * The tunnel re-terminates the device's IP path elsewhere, so any network-
 * derived corroboration (IP geolocation, geofencing, content licensing, and
 * every network-based position estimate) is unreliable while it is up.
 *
 * The signal is the real OS report (AnchorNet: tun/tap interfaces ∨
 * TRANSPORT_VPN capability) passed in the window — never synthesized here.
 *
 * Semantics: a tunnel up fails the check, and because `network` participates
 * in CRITICAL_PAIRS only with itself, a lone tunnel DEGRADES the instrument
 * (VPN use is common and legitimate) while a concurrent physics failure
 * compounds toward DENIED. With no signal the check abstains (passes with a
 * note) rather than inventing one.
 *
 * Score: 0 when the tunnel is up, 1 otherwise. The weighted confidence in
 * evaluateIntegrity absorbs the score; the state machine handles transitions.
 */
export function networkCheck(window: SensorWindow): CheckResult {
  const signal = window.network;
  if (!signal) {
    return { id: 'network', passed: true, score: 1, detail: 'no network-integrity signal this window' };
  }
  if (signal.vpnActive) {
    return {
      id: 'network',
      passed: false,
      score: 0,
      detail: 'VPN tunnel active — network path cannot corroborate location (OS-reported)',
    };
  }
  return { id: 'network', passed: true, score: 1, detail: 'no VPN tunnel; direct network path' };
}
