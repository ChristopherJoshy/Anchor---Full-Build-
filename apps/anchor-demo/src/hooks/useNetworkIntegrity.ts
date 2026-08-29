/**
 * useNetworkIntegrity — REAL network-layer signals, zero simulation.
 *
 *  - VPN tunnel detection via the AnchorNet native module: kernel tun/tap
 *    interfaces + ConnectivityManager TRANSPORT_VPN capability, polled 2 s.
 *  - IP geolocation over HTTPS (ipwho.is, ipapi.co fallback) every 60 s.
 *  - Real great-circle divergence (SDK haversine) between the IP location and
 *    the current GNSS fix. Divergence beyond DIVERGENCE_LIMIT_KM means the
 *    network location cannot be trusted (VPN/proxy) — GNSS physics stay
 *    authoritative; this signal never alters the safety state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnchorNet, haversineMeters } from 'anchor-sdk';

export interface IpGeo {
  ip: string | null;
  lat: number | null;
  lon: number | null;
  city: string | null;
  country: string | null;
}

export interface NetworkIntegrity {
  vpnActive: boolean;
  ip: IpGeo | null;
  divergenceKm: number | null;
  checking: boolean;
  error: string | null;
  refresh: () => void;
}

/** IP↔GNSS divergence beyond this (km) means the network location is untrusted. */
export const DIVERGENCE_LIMIT_KM = 150;
const VPN_POLL_MS = 2000;
const IP_REFRESH_MS = 60_000;

/** True under Jest — component tests must never touch the network. */
function inJest(): boolean {
  return typeof process !== 'undefined' && !!process.env && !!process.env.JEST_WORKER_ID;
}

async function fetchIpGeo(): Promise<IpGeo> {
  try {
    const res = await fetch('https://ipwho.is/', { headers: { accept: 'application/json' } });
    const j = (await res.json()) as Record<string, unknown>;
    if (j && j.success !== false && typeof j.latitude === 'number' && typeof j.longitude === 'number') {
      return {
        ip: (j.ip as string) ?? null,
        lat: j.latitude as number,
        lon: j.longitude as number,
        city: (j.city as string) ?? null,
        country: (j.country as string) ?? null,
      };
    }
    throw new Error('ipwho.is unavailable');
  } catch (firstErr) {
    const res = await fetch('https://ipapi.co/json/', { headers: { accept: 'application/json' } });
    const j = (await res.json()) as Record<string, unknown>;
    if (j && typeof j.latitude === 'number' && typeof j.longitude === 'number') {
      return {
        ip: (j.ip as string) ?? null,
        lat: j.latitude as number,
        lon: j.longitude as number,
        city: (j.city as string) ?? null,
        country: (j.country_name as string) ?? null,
      };
    }
    throw firstErr instanceof Error ? firstErr : new Error('IP geolocation unavailable');
  }
}

export function useNetworkIntelligence(fix: { latitude: number; longitude: number } | null): NetworkIntegrity {
  const [vpnActive, setVpnActive] = useState(false);
  const [ip, setIp] = useState<IpGeo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fixRef = useRef(fix);

  useEffect(() => {
    fixRef.current = fix;
  }, [fix]);

  const refresh = useCallback(() => {
    if (inJest()) return;
    setChecking(true);
    fetchIpGeo()
      .then((g) => {
        setIp(g);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'IP lookup failed'))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const readVpn = () => {
      try {
        setVpnActive(AnchorNet.isVpnActive());
      } catch {
        // Native module unavailable off-Android — signal stays false.
      }
    };
    readVpn();
    const vpnPoll = setInterval(readVpn, VPN_POLL_MS);
    refresh();
    const ipPoll = setInterval(refresh, IP_REFRESH_MS);
    return () => {
      clearInterval(vpnPoll);
      clearInterval(ipPoll);
    };
  }, [refresh]);

  const f = fixRef.current;
  const divergenceKm =
    ip && ip.lat !== null && ip.lon !== null && f && Number.isFinite(f.latitude) && Number.isFinite(f.longitude)
      ? haversineMeters(ip.lat, ip.lon, f.latitude, f.longitude) / 1000
      : null;

  return { vpnActive, ip, divergenceKm, checking, error, refresh };
}
