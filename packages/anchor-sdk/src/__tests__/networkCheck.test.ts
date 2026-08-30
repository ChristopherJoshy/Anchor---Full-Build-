import { networkCheck } from '../physics/networkCheck';
import type { SensorWindow } from '../types';

function windowWith(network: SensorWindow['network']): SensorWindow {
  return { fixes: [], imu: [], baro: [], gnss: [], ...(network ? { network } : {}) };
}

describe('networkCheck', () => {
  it('abstains (passes) when no network signal is present', () => {
    const result = networkCheck(windowWith(undefined));
    expect(result.id).toBe('network');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.detail).toMatch(/no network-integrity signal/);
  });

  it('fails when a VPN tunnel is reported active', () => {
    const result = networkCheck(windowWith({ vpnActive: true }));
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.detail).toMatch(/VPN tunnel active/);
  });

  it('passes with a clean direct path', () => {
    const result = networkCheck(windowWith({ vpnActive: false }));
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.detail).toMatch(/no VPN tunnel/);
  });
});
