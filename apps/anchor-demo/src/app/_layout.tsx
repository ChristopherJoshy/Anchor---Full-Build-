import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';
import { AnchorProvider } from 'anchor-sdk';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import { consoleLog, startupLog } from '@/lib/startupLog';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const FONT_TIMEOUT_MS = 10_000;

/** True once `active` has stayed true for `timeoutMs` (false while inactive). */
function useTimedOut(active: boolean, timeoutMs: number): boolean {
  const [timedOut, setTimedOut] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setTimedOut(false);
      startedAtRef.current = null;
      return;
    }
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }
    const remaining = timeoutMs - (Date.now() - startedAtRef.current);
    if (remaining <= 0) {
      setTimedOut(true);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), remaining);
    return () => clearTimeout(timer);
  }, [active, timeoutMs]);

  return timedOut;
}

/**
 * Resilient font gate: waits for the custom fonts, but a load failure OR a
 * 10 s hang resolves the gate anyway and proceeds with system fonts instead
 * of blanking the app. If the load completes later, the next render simply
 * swaps the families in.
 */
function useFontGate(): { fontsReady: boolean; useCustomFonts: boolean } {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexMono_400Regular,
    IBMPlexMono_600SemiBold,
    Inter_400Regular,
    Inter_600SemiBold,
  });

  useEffect(() => {
    if (fontError) {
      consoleLog('ERROR', `font load failed: ${fontError.message}`);
    }
  }, [fontError]);

  const timedOut = useTimedOut(!fontsLoaded, FONT_TIMEOUT_MS);

  useEffect(() => {
    if (timedOut) {
      consoleLog('WARN', `font gate timed out after ${FONT_TIMEOUT_MS} ms — continuing with system fonts`);
    }
  }, [timedOut]);

  if (fontsLoaded) {
    return { fontsReady: true, useCustomFonts: true };
  }
  if (fontError || timedOut) {
    return { fontsReady: true, useCustomFonts: false };
  }
  return { fontsReady: false, useCustomFonts: false };
}

export default function RootLayout() {
  const { fontsReady, useCustomFonts } = useFontGate();

  useEffect(() => {
    if (fontsReady) {
      startupLog(useCustomFonts ? 'fonts loaded' : 'fonts unavailable — system fonts in use');
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsReady, useCustomFonts]);

  if (!fontsReady) {
    return null;
  }

  return (
    <RootErrorBoundary>
      <AnchorProvider>
        <StartupLogEffect />
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.panelBg },
            animation: 'none',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="dashboard" />
        </Stack>
      </AnchorProvider>
    </RootErrorBoundary>
  );
}

/** Logs once after mount so logcat proves the tree is actually rendering. */
function StartupLogEffect() {
  useEffect(() => {
    startupLog('root tree mounted (error boundary + provider + router)');
  }, []);
  return null;
}
