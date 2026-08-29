/**
 * Instrument dashboard — single screen, no scroll feed. StatusStrip on top,
 * six PFD tape gauges, flight-recorder event log, persistent bottom bar with
 * voice + semantic search + labeled test harness.
 */
import { BottomBar } from '@/components/BottomBar';
import { EventLog } from '@/components/EventLog';
import { StatusStrip } from '@/components/StatusStrip';
import { TapeGauge } from '@/components/TapeGauge';
import { useAnchorPipeline } from '@/hooks/useAnchorPipeline';
import type { EventLogEntry } from '@/hooks/useAnchorPipeline';
import { usePermissions } from '@/hooks/usePermissions';
import { useVoiceCommands } from '@/hooks/useVoiceCommands';
import { colors, colorForIntegrityState, fonts, hairline, monoNumeric, monoNumericBold, spacing } from '@/theme';
import type { AnchorSDK, CheckId, CheckResult } from 'anchor-sdk';
import { Linking } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cosineSimilarity } from '@/lib/search';
import { startupLog } from '@/lib/startupLog';
import { HybridPanel } from '@/components/HybridPanel';
import { hybridExplain } from '@/lib/hybridEngine';


const CHECK_ORDER: CheckId[] = ['kinematic', 'heading', 'temporal', 'altitude', 'environmental', 'cn0'];

interface SearchOverlayData {
  query: string;
  hits: Array<{ entry: EventLogEntry; score: number }>;
}

/** Location-denied real empty state — the instrument cannot function. */
function LocationDenied() {
  return (
    <View style={styles.deniedWrap}>
      <Text style={styles.deniedTitle}>NO POSITION SOURCE</Text>
      <Text style={styles.deniedBody}>
        Anchor can&apos;t function without location. It reads GPS fixes to check them against
        physics; without them there is nothing to verify.
      </Text>
      <Pressable style={styles.deniedBtn} onPress={() => void Linking.openSettings()}>
        <Text style={styles.deniedBtnText}>OPEN SETTINGS</Text>
      </Pressable>
    </View>
  );
}


export default function DashboardScreen() {
  const { decisions, loaded: permsLoaded } = usePermissions();
  const pipeline = useAnchorPipeline();
  const [searchOverlay, setSearchOverlay] = useState<SearchOverlayData | null>(null);
  const [reasonPanel, setReasonPanel] = useState(false);
  const [hybridReasoning, setHybridReasoning] = useState<string | null>(null);
  const [hybridTiming, setHybridTiming] = useState<{ deterministicMs: number; quantizedMs: number | null; totalMs: number } | null>(null);
  const [hybridCached, setHybridCached] = useState(false);
  const [hybridConf, setHybridConf] = useState<number | null>(null);

  useEffect(() => {
    startupLog(`dashboard mounted: location=${decisions.location} mic=${decisions.mic}`);
  }, [decisions.location, decisions.mic]);

  const { sdk, injectSpoof, mock, reset, vpnActive, lastMock, detMs, telemetry } = pipeline;

  // Deterministic + advisory reasoning showcase. detMs is REAL (measured
  // evaluate() time from the pipeline); advisory ms is the real elapsed time
  // of the simulated advisory budget in showcase mode.
  useEffect(() => {
    if (!pipeline.verdict) {
      setHybridReasoning(null);
      setHybridTiming(null);
      setHybridConf(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await hybridExplain(pipeline.verdict!, sdk);
      if (cancelled) return;
      const det = pipeline.detMs ?? 0;
      setHybridReasoning(res.reasoning);
      setHybridTiming({ deterministicMs: det, quantizedMs: res.quantizedMs, totalMs: det + res.quantizedMs });
      setHybridCached(res.cached);
      setHybridConf(null);
    })();
    return () => { cancelled = true; };
  }, [pipeline.verdict, pipeline.detMs, sdk]);

  const onCommand = useCallback(
    (command: 'simulate spoof' | 'reset' | 'show reason') => {
      if (command === 'simulate spoof') {
        injectSpoof();
      } else if (command === 'reset') {
        reset();
      } else {
        setReasonPanel(true);
      }
    },
    [injectSpoof, reset],
  );
  const voice = useVoiceCommands(sdk as AnchorSDK, onCommand);

  const locationDenied = permsLoaded && (decisions.location === 'denied' || pipeline.locationGranted === false);

  const stateColor = pipeline.verdict ? colorForIntegrityState(pipeline.verdict.state) : colors.textMuted;

  const resultFor = useCallback(
    (id: CheckId): CheckResult | null =>
      pipeline.verdict?.results.find((r) => r.id === id) ?? null,
    [pipeline.verdict],
  );

  const onSearch = useCallback(
    (query: string) => {
      void (async () => {
        try {
          const vector = await sdk.embed(query);
          const hits = pipeline.events
            .filter((e) => e.embedding !== null)
            .map((entry) => ({ entry, score: cosineSimilarity(vector, entry.embedding as number[]) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
          setSearchOverlay({ query, hits });
        } catch {
          setSearchOverlay({ query, hits: [] });
        }
      })();
    },
    [sdk, pipeline.events],
  );

  const lastExplanation = hybridReasoning ?? pipeline.events[0]?.explanation ?? null;

  if (locationDenied) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <LocationDenied />
        <BottomBar
          micDenied={decisions.mic === 'denied'}
          voiceStatus={voice.status}
          onToggleMic={voice.toggle}
          lastTranscript={voice.lastTranscript}
          lastError={voice.lastError}
          onSearch={onSearch}
          spoofing={pipeline.spoofing}
          onSpoof={injectSpoof}
          onReset={reset}
          onShowReason={() => setReasonPanel(true)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusStrip verdict={pipeline.verdict} />

      {/* live telemetry rail — measured values, 1 Hz */}
      {telemetry ? (
        <View style={styles.telemetryRail}>
          <View style={styles.telemetryRow}>
            <Text style={styles.telLabel}>POS</Text>
            <Text style={styles.telVal}>
              {Math.abs(telemetry.lat).toFixed(4)}°{telemetry.lat >= 0 ? 'N' : 'S'} {Math.abs(telemetry.lon).toFixed(4)}°{telemetry.lon >= 0 ? 'E' : 'W'}
            </Text>
            <Text style={styles.telLabel}>ALT</Text>
            <Text style={styles.telVal}>{telemetry.alt.toFixed(1)}m</Text>
            <Text style={styles.telLabel}>ACC</Text>
            <Text style={[styles.telVal, telemetry.acc > 25 ? styles.telWarn : null]}>{Number.isFinite(telemetry.acc) ? `${telemetry.acc.toFixed(1)}m` : '—'}</Text>
          </View>
          <View style={styles.telemetryRow}>
            <Text style={styles.telLabel}>SPD</Text>
            <Text style={styles.telVal}>{telemetry.speed.toFixed(1)}m/s</Text>
            <Text style={styles.telLabel}>TRK</Text>
            <Text style={styles.telVal}>{telemetry.bearing.toFixed(0)}°</Text>
            <Text style={styles.telLabel}>SAT</Text>
            <Text style={[styles.telVal, telemetry.sats !== null && telemetry.sats < 4 ? styles.telWarn : null]}>{telemetry.sats ?? '—'}</Text>
            <Text style={styles.telLabel}>BARO</Text>
            <Text style={styles.telVal}>{telemetry.baroHpa !== null ? `${telemetry.baroHpa.toFixed(1)}hPa` : '—'}</Text>
          </View>
        </View>
      ) : null}

      {vpnActive ? (
        <View style={styles.vpnBanner}>
          <Text style={styles.vpnTitle}>VPN DETECTED — IP ≠ GPS</Text>
          <Text style={styles.vpnBody}>IP geolocation jumped (VPN/proxy), but GPS physics checks all pass. Correctly NOT flagged — VPN does not spoof GNSS. GPS remains trusted.</Text>
        </View>
      ) : null}

      {/* six PFD tape gauges — realtime physics, 500ms eased, 0-100 */}
      <View style={styles.gaugesWrap}>
        <View style={styles.gaugeRow}>
          {CHECK_ORDER.slice(0, 3).map((id) => {
            const r = resultFor(id);
            return (
              <View key={id} style={styles.gaugeCell}>
                <TapeGauge
                  checkId={id}
                  score={r?.score ?? 0}
                  passed={r?.passed ?? true}
                  stateColor={stateColor}
                />
              </View>
            );
          })}
        </View>
        <View style={styles.gaugeDivider} />
        <View style={styles.gaugeRow}>
          {CHECK_ORDER.slice(3).map((id) => {
            const r = resultFor(id);
            return (
              <View key={id} style={styles.gaugeCell}>
                <TapeGauge
                  checkId={id}
                  score={r?.score ?? 0}
                  passed={r?.passed ?? true}
                  stateColor={stateColor}
                />
              </View>
            );
          })}
        </View>
      </View>

      <HybridPanel
        verdict={pipeline.verdict}
        reasoning={hybridReasoning}
        timing={hybridTiming}
        cached={hybridCached}
        hybridConfidence={hybridConf}
      />

      {/* Scenario injector — every frame runs through the REAL RAIM/FDE pipeline */}
      <View style={styles.mockPanel}>
        <View style={styles.mockHeader}>
          <Text style={styles.mockTitle}>SCENARIO INJECTOR — REAL PHYSICS</Text>
          <Text style={styles.mockHint}>1 frame/s through full pipeline</Text>
        </View>
        <View style={styles.mockGrid}>
          {[
            { k: 'vpn' as const, label: 'VPN', desc: 'IP jump' },
            { k: 'teleport' as const, label: 'TELEPORT', desc: 'kinematic' },
            { k: 'cno' as const, label: 'C/N0', desc: 'lockstep' },
            { k: 'altitude' as const, label: 'ALT', desc: 'baro vs GPS' },
            { k: 'heading' as const, label: 'HDG', desc: 'track vs mag' },
            { k: 'temporal' as const, label: 'TIME', desc: 'replay' },
            { k: 'environmental' as const, label: 'ENV', desc: 'bounds' },
            { k: 'compound' as const, label: 'COMPOUND', desc: 'krit pair' },
          ].map((m) => (
            <Pressable
              key={m.k}
              onPress={() => mock(m.k)}
              style={[styles.mockBtn, lastMock === m.k && styles.mockBtnActive, vpnActive && m.k === 'vpn' && styles.mockBtnVpn]}
              accessibilityRole="button"
              accessibilityLabel={`Mock ${m.label}`}
            >
              <Text style={[styles.mockBtnLabel, lastMock === m.k && styles.mockBtnLabelActive]}>{m.label}</Text>
              <Text style={styles.mockBtnDesc}>{m.desc}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.mockFoot}>Frames enter the same evaluate() path as live GPS — gauges and status react to measured physics. VPN keeps GPS TRUSTED (IP ≠ GNSS).</Text>
      </View>

      <EventLog events={pipeline.events} />

      <BottomBar
        micDenied={decisions.mic === 'denied'}
        voiceStatus={voice.status}
        onToggleMic={voice.toggle}
        lastTranscript={voice.lastTranscript}
        lastError={voice.lastError}
        onSearch={onSearch}
        spoofing={pipeline.spoofing}
        onSpoof={injectSpoof}
        onReset={reset}
        onShowReason={() => setReasonPanel(true)}
      />

      {/* SHOW REASON panel — last LLM explanation inline */}
      {reasonPanel ? (
        <Pressable style={styles.overlayScrim} onPress={() => setReasonPanel(false)}>
          <Pressable style={styles.overlayPanel} onPress={() => {}}>
            <Text style={styles.overlayTitle}>LAST REASON — AI EXPLANATION</Text>
            <ScrollView style={styles.overlayScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.overlayBody}>
                {lastExplanation ?? '(waiting for on-device model — explanation appears after the next transition)'}
              </Text>
            </ScrollView>
            <Pressable onPress={() => setReasonPanel(false)}>
              <Text style={styles.overlayHint}>TAP ANYWHERE TO CLOSE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      ) : null}

      {/* semantic search results overlay */}
      {searchOverlay ? (
        <Pressable style={styles.overlayScrim} onPress={() => setSearchOverlay(null)}>
          <Pressable style={styles.overlayPanel} onPress={() => {}}>
            <Text style={styles.overlayTitle}>SEARCH — &quot;{searchOverlay.query}&quot;</Text>
            <ScrollView style={styles.overlayScroll} keyboardShouldPersistTaps="handled">
              {searchOverlay.hits.length === 0 ? (
                <Text style={styles.overlayBody}>
                  No embedded events yet (embeddings index after the first transition) or no
                  matches.
                </Text>
              ) : (
                searchOverlay.hits.map(({ entry, score }) => (
                  <View key={entry.id} style={styles.hitRow}>
                    <Text style={styles.hitScore}>{Number.isFinite(score) ? Math.round(score * 100).toString().padStart(3, '0') : '000'}%</Text>
                    <Text style={styles.hitReason} numberOfLines={2}>
                      {entry.reason}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
            <Pressable onPress={() => setSearchOverlay(null)}>
              <Text style={styles.overlayHint}>TAP ANYWHERE TO CLOSE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.panelBg,
  },
  telemetryRail: {
    backgroundColor: colors.panelSurface,
    borderBottomWidth: hairline,
    borderBottomColor: colors.chrome,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    gap: 2,
  },
  telemetryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    flexWrap: 'wrap',
  },
  telLabel: {
    ...monoNumeric,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  telVal: {
    ...monoNumericBold,
    fontSize: 11,
    color: colors.textPrimary,
    marginRight: spacing.xs,
  },
  telWarn: {
    color: colors.caution,
  },
  vpnBanner: {
    backgroundColor: 'rgba(0,217,163,0.08)',
    borderTopWidth: hairline,
    borderBottomWidth: hairline,
    borderColor: colors.trusted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  vpnTitle: {
    ...monoNumericBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.trusted,
  },
  vpnBody: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textPrimary,
  },
  mockPanel: {
    backgroundColor: colors.panelBg,
    borderTopWidth: hairline,
    borderTopColor: colors.chrome,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  mockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 4,
  },
  mockTitle: {
    ...monoNumericBold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.textPrimary,
  },
  mockHint: {
    ...monoNumeric,
    fontSize: 8,
    color: colors.textMuted,
  },
  mockGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  mockBtn: {
    width: '23%',
    minWidth: 72,
    borderWidth: hairline,
    borderColor: colors.chrome,
    backgroundColor: colors.panelSurface,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 1,
  },
  mockBtnActive: {
    borderColor: colors.caution,
    backgroundColor: 'rgba(255,179,0,0.08)',
  },
  mockBtnVpn: {
    borderColor: colors.trusted,
    backgroundColor: 'rgba(0,217,163,0.08)',
  },
  mockBtnLabel: {
    ...monoNumericBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  mockBtnLabelActive: {
    color: colors.caution,
  },
  mockBtnDesc: {
    ...monoNumeric,
    fontSize: 7,
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
  mockFoot: {
    ...monoNumeric,
    fontSize: 8,
    color: colors.textMuted,
  },
  gaugesWrap: {
    paddingVertical: spacing.sm,
    backgroundColor: colors.panelBg,
  },
  gaugeRow: {
    flexDirection: 'row',
  },
  gaugeCell: {
    flex: 1,
    alignItems: 'center',
  },
  gaugeDivider: {
    height: hairline,
    backgroundColor: colors.chrome,
    marginVertical: spacing.sm,
  },
  deniedWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  deniedTitle: {
    ...monoNumericBold,
    fontSize: 18,
    letterSpacing: 3,
    color: colors.caution,
  },
  deniedBody: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  deniedBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.caution,
  },
  deniedBtnText: {
    ...monoNumericBold,
    fontSize: 13,
    letterSpacing: 3,
    color: colors.caution,
  },
  overlayScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(12, 17, 22, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  overlayPanel: {
    width: '100%',
    maxHeight: '70%',
    borderWidth: hairline,
    borderColor: colors.chrome,
    backgroundColor: colors.panelSurface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  overlayTitle: {
    ...monoNumericBold,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.textPrimary,
  },
  overlayScroll: {
    maxHeight: 320,
  },
  overlayBody: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  overlayHint: {
    ...monoNumeric,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.textMuted,
    textAlign: 'center',
  },
  hitRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: 4,
    borderBottomWidth: hairline,
    borderBottomColor: colors.panelBg,
    alignItems: 'flex-start',
  },
  hitScore: {
    ...monoNumericBold,
    fontSize: 12,
    color: colors.trusted,
    width: 44,
  },
  hitReason: {
    ...monoNumeric,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
    flex: 1,
  },
});
