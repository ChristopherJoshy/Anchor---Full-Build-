/**
 * Permission decisions, persisted so the primer never re-prompts.
 *
 * `unknown`  — primer not completed yet / never asked
 * `granted`  — native permission granted
 * `denied`   — user declined; dashboard shows degraded paths, never re-prompts
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioModule } from 'expo-audio';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

export type PermissionGrant = 'unknown' | 'granted' | 'denied';

export interface PermissionDecisions {
  location: PermissionGrant;
  mic: PermissionGrant;
  primerCompleted: boolean;
}

const STORAGE_KEY = 'anchor.permissions.v1';

const DEFAULTS: PermissionDecisions = {
  location: 'unknown',
  mic: 'unknown',
  primerCompleted: false,
};

function normalize(raw: string | null): PermissionDecisions {
  if (raw === null) {
    return DEFAULTS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PermissionDecisions>;
    return {
      location: parsed.location === 'granted' || parsed.location === 'denied' ? parsed.location : 'unknown',
      mic: parsed.mic === 'granted' || parsed.mic === 'denied' ? parsed.mic : 'unknown',
      primerCompleted: parsed.primerCompleted === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function usePermissions() {
  const [decisions, setDecisions] = useState<PermissionDecisions>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => setDecisions(normalize(raw)))
      .catch(() => setDecisions(DEFAULTS))
      .finally(() => setLoaded(true));
  }, []);

  const persist = useCallback((next: PermissionDecisions) => {
    setDecisions(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  /** Runs the native dialogs in sequence and persists each outcome. */
  const requestAll = useCallback(async (): Promise<PermissionDecisions> => {
    const locationResult = await Location.requestForegroundPermissionsAsync().catch(() => null);
    const location: PermissionGrant = locationResult?.granted ? 'granted' : 'denied';

    const micResult = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
    const mic: PermissionGrant = micResult?.granted ? 'granted' : 'denied';

    const next: PermissionDecisions = { location, mic, primerCompleted: true };
    persist(next);
    return next;
  }, [persist]);

  return { decisions, loaded, requestAll };
}
