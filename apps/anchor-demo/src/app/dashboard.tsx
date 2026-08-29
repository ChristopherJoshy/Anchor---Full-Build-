/**
 * Instrument dashboard — real signals only. StatusStrip + live telemetry rail,
 * six PFD tape gauges, integrity panel (deterministic + real Qwen advisory),
 * flight-recorder event log, and the TEST HARNESS (disarmed by default; armed
 * frames enter the same real pipeline). The instrument is fully functional
 * with zero harness input — the harness only stages attacks that cannot be
 * performed live.
 */
import { BottomBar } from '@/components/BottomBar';
import { EventLog } from '@/components/EventLog';
import { IntegrityPanel } from '@/components/IntegrityPanel';
import { IslandCapsule } from '@/components/IslandCapsule';
import { StatusStrip } from '@/components/StatusStrip';
import { TapeGauge } from '@/components/TapeGauge';
import { useAnchorPipeline } from '@/hooks/useAnchorPipeline';
import type { EventLogEntry } from '@/hooks/useAnchorPipeline';
import { useNetworkIntelligence, DIVERGENCE_LIMIT_KM } from '@/hooks/useNetworkIntegrity';
import { usePermissions } from '@/hooks/usePermissions';
import { useVoiceCommands } from '@/hooks/useVoiceCommands';
import { colors, colorForIntegrityState, fonts, hairline, monoNumeric, monoNumericBold, spacing } from '@/theme';
import type { AnchorSDK, CheckId, CheckResult } from 'anchor-sdk';
import { Linking } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { cosineSimilarity } from '@/lib/search';
import { startupLog } from '@/lib/startupLog';

const CHECK_ORDER: CheckId[] = ['kinematic', 'heading', 'temporal', 'altitude', 'environmental', 'cn0'];

interface SearchOverlayData {
  query: string;
  hits: Array<{ entry: EventLogEntry; score: number }>;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export default function DashboardScreen() {
  const { decisions, loaded: permsLoaded } = usePermissions();
  const pipeline = useAnchorPipeline();
  const [searchOverlay, setSearchOverlay] = useState<SearchOverlayData | null>(null);
  const [reasonPanel, setReasonPanel] = useState(false);

  useEffect(() => {
    startupLog(`dashboard mounted: location=${decisions.location} mic=${decisions.mic}`);
  }, [decisions.location, decisions.mic]);

  const { sdk, injectSpoof, runScenario, recoveryDemo, reset, recordNetwork, demoArmed, toggleDemoArmed, detMs, telemetry, lastScenario } = pipeline;

  // Real network-integrity signals (native VPN probe + IP↔GPS divergence).
  const net = useNetworkIntelligence(
    telemetry ? { latitude: telemetry.lat, longitude: telemetry.lon } : null,
  );

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
  const noLiveGps = telemetry === null;

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

  // Advisory text: the REAL on-device Qwen3 output once the model produces it;
  // until then the deterministic machine's own reason (labeled in the panel).
  const lastExplanation = pipeline.events[0]?.explanation ?? null;
  const advisorySource: 'model' | 'deterministic' =
    lastExplanation && lastExplanation !== '(explanation unavailable)' ? 'model' : 'deterministic';

  // Real network events into the flight recorder (VPN tunnel up/down, divergence).
  const prevNetRef = useRef<{ vpn: boolean | null; diverged: boolean | null }>({ vpn: null, diverged: null });
  useEffect(() => {
    const diverged = net.divergenceKm !== null && net.divergenceKm > DIVERGENCE_LIMIT_KM;
    if (net.vpnActive !== prevNetRef.current.vpn) {
      recordNetwork(
        net.vpnActive
          ? `VPN tunnel detected (AnchorNet) — IP ${net.ip ? `${net.ip.ip}${net.ip.city ? ` · ${net.ip.city}, ${net.ip.country ?? ''}` : ''}` : 'resolving'}; GNSS integrity unaffected`
          : 'VPN tunnel cleared — direct network path',
      );
      prevNetRef.current.vpn = net.vpnActive;
    }
    if (diverged !== prevNetRef.current.diverged) {
      if (diverged) {
        recordNetwork(
          `IP↔GPS divergence ${Math.round(net.divergenceKm ?? 0)} km — network location untrusted, GNSS physics authoritative`,
        );
      }
      prevNetRef.current.diverged = diverged;
    }
  }, [net.vpnActive, net.divergenceKm, net.ip, recordNetwork]);

  // RECOVERY VERIFIED latch — derived from real machine transitions in the log:
  // the newest TRUSTED entry immediately preceded by a RECOVERING entry.
  const recoveryPair = useMemo(() => {
    for (let i = 0; i < pipeline.events.length - 1; i += 1) {
      if (pipeline.events[i].state === 'TRUSTED' && pipeline.events[i + 1].state === 'RECOVERING') {
        return { recoveringAt: pipeline.events[i + 1].timestamp, trustedAt: pipeline.events[i].timestamp };
      }
    }
    return null;
  }, [pipeline.events]);

  const netBannerVisible = net.vpnActive || (net.divergenceKm !== null && net.divergenceKm > DIVERGENCE_LIMIT_KM);

  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {/* Dynamic-Island-style integrity capsule (iQOO 15) — real pipeline values */}
      <IslandCapsule
        verdict={pipeline.verdict}
        detMs={detMs}
        vpnActive={net.vpnActive}
        divergenceKm={net.divergenceKm}
        topInset={insets.top}
      />

      <StatusStrip verdict={pipeline.verdict} />

      {/* live telemetry rail — measured values at 1 Hz */}
      {telemetry ? (
        <View style={styles.telemetryRail}>
          <View style={styles.telemetryRow}>
            <Text style={styles.telLabel}>POS</Text>
            <Text style={styles.telVal}>
              {Math.abs(telemetry.lat).toFixed(4)}°{telemetry.lat >= 0 ? 'N' : 'S'} {Math.abs(telemetry.lon).toFixed(4)}°{telemetry.lon >= 0 ? 'E' : 'W'}
            </Text>
            <Text style={styles.telLabel}>ALT</Text>
            <Text style={styles.telVal}>{Number.isFinite(telemetry.alt) ? `${telemetry.alt.toFixed(1)}m` : '—'}</Text>
            <Text style={styles.telLabel}>ACC</Text>
            <Text style={[styles.telVal, telemetry.acc > 25 ? styles.telWarn : null]}>
              {Number.isFinite(telemetry.acc) ? `${telemetry.acc.toFixed(1)}m` : '—'}
            </Text>
          </View>
          <View style={styles.telemetryRow}>
            <Text style={styles.telLabel}>SPD</Text>
            <Text style={styles.telVal}>{telemetry.speed.toFixed(1)}m/s</Text>
            <Text style={styles.telLabel}>TRK</Text>
            <Text style={styles.telVal}>{telemetry.bearing.toFixed(0)}°</Text>
            <Text style={styles.telLabel}>SAT</Text>
            <Text style={[styles.telVal, telemetry.sats !== null && telemetry.sats < 4 ? styles.telWarn : null]}>
              {telemetry.sats ?? '—'}
            </Text>
            <Text style={styles.telLabel}>BARO</Text>
            <Text style={styles.telVal}>{telemetry.baroHpa !== null ? `${telemetry.baroHpa.toFixed(1)}hPa` : '—'}</Text>
          </View>
          <View style={styles.telemetryRow}>
            <Text style={styles.telLabel}>SENSORS</Text>
            <Text style={styles.telVal}>
              <Text style={pipeline.locationError ? styles.telFail : styles.telOk}>GPS{pipeline.locationError ? '✗' : '✓'}</Text>
              {' · '}
              <Text style={pipeline.imuError ? styles.telFail : styles.telOk}>IMU{pipeline.imuError ? '✗' : '✓'}</Text>
              <Text style={styles.telMuted}>({telemetry.imuCount})</Text>
              {' · '}
              <Text style={pipeline.baroError ? styles.telFail : styles.telOk}>BARO{pipeline.baroError ? '✗' : '✓'}</Text>
              <Text style={styles.telMuted}>({telemetry.baroCount})</Text>
              {' · '}
              <Text style={pipeline.gnssSupported === false ? styles.telMuted : pipeline.gnssError ? styles.telFail : styles.telOk}>
                GNSS{pipeline.gnssSupported === false ? 'N/A' : pipeline.gnssError ? '✗' : '✓'}
              </Text>
              <Text style={styles.telMuted}>({telemetry.gnssEpochs})</Text>
            </Text>
            <Text style={styles.telLabel}>FIX AGE</Text>
            <Text style={[styles.telVal, telemetry.fixAgeMs !== null && telemetry.fixAgeMs > 5000 ? styles.telWarn : null]}>
              {telemetry.fixAgeMs !== null ? `${(telemetry.fixAgeMs / 1000).toFixed(0)}s` : '—'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* REAL network-integrity banner — native VPN probe + IP↔GPS divergence */}
      {netBannerVisible ? (
        <View style={[styles.netBanner, !net.vpnActive && styles.netBannerWarn]}>
          <Text style={[styles.netTitle, net.vpnActive && styles.netTitleOk]}>
            {net.vpnActive ? 'VPN TUNNEL ACTIVE — OS-REPORTED' : 'IP↔GPS DIVERGENCE'}
          </Text>
          <Text style={styles.netBody}>
            {net.vpnActive
              ? `Tunnel interface detected by AnchorNet. IP ${net.ip ? `${net.ip.ip}${net.ip.city ? ` · ${net.ip.city}, ${net.ip.country ?? ''}` : ''}` : net.checking ? 'resolving…' : 'unavailable'}. `
              : 'Network location does not match the GNSS fix. '}
            {net.divergenceKm !== null ? `IP↔GPS ${net.divergenceKm >= 1000 ? `${(net.divergenceKm / 1000).toFixed(1)}k` : Math.round(net.divergenceKm)} km. ` : ''}
            Network location is untrusted; GNSS physics remain authoritative.
          </Text>
        </View>
      ) : null}

      {/* no-live-GPS banner — instrument still runs (harness or real recovery) */}
      {locationDenied || noLiveGps ? (
        <View style={styles.noFixBanner}>
          <Text style={styles.netTitle}>
            {locationDenied ? 'NO LIVE GPS — PERMISSION DENIED' : 'NO LIVE GPS — WAITING FOR FIX'}
          </Text>
          <Text style={styles.netBody}>
            {locationDenied
              ? 'Grant location in system settings, or arm the presentation injector below to drive the real pipeline.'
              : 'Testing indoors or GNSS not locked? Arm the presentation injector below to stage attacks through the real pipeline.'}
          </Text>
          {locationDenied ? (
            <Pressable style={styles.openSettingsBtn} onPress={() => void Linking.openSettings()}>
              <Text style={styles.openSettingsText}>OPEN SETTINGS</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* RECOVERY VERIFIED — derived from real machine transitions in the log */}
      {recoveryPair ? (
        <View style={styles.recoveryNote}>
          <Text style={styles.recoveryTitle}>RECOVERY VERIFIED — DEBOUNCE 5/5 CLEAN EVALUATIONS</Text>
          <Text style={styles.recoveryBody}>
            RECOVERING @{formatClock(recoveryPair.recoveringAt)} → TRUSTED @{formatClock(recoveryPair.trustedAt)} · real state-machine transition, recorded by the flight recorder
          </Text>
        </View>
      ) : null}

      {/* six PFD tape gauges — realtime physics */}
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

      <IntegrityPanel
        verdict={pipeline.verdict}
        reasoning={advisorySource === 'model' ? lastExplanation : pipeline.verdict?.reason ?? null}
        advisorySource={advisorySource}
        detMs={detMs}
      />

      {/* TEST HARNESS — disarmed by default; armed frames run the REAL pipeline */}
      <View style={styles.harnessPanel}>
        <View style={styles.harnessHeader}>
          <Text style={styles.harnessTitle}>DEMO CONTROLS — ATTACK STAGING</Text>
          <View style={styles.armRow}>
            <Text style={[styles.armLabel, demoArmed && styles.armLabelOn]}>
              {demoArmed ? 'DEMO ARMED' : 'LIVE SENSORS ONLY'}
            </Text>
            <Switch
              value={demoArmed}
              onValueChange={toggleDemoArmed}
              trackColor={{ false: colors.chrome, true: colors.trusted }}
              thumbColor="#E8EDF2"
            />
          </View>
        </View>
        <Text style={styles.harnessHint}>
          {demoArmed
            ? 'Frames enter the same evaluate() path as live GPS — every gauge and state change is real physics.'
            : 'Disabled: all values are live sensors. Arm only to stage attacks that cannot be performed live.'}
        </Text>
        <View style={[styles.harnessGrid, !demoArmed && styles.harnessGridDisabled]}>
          {[
            { k: 'teleport' as const, label: 'TELEPORT', desc: 'kinematic → DEGRADED' },
            { k: 'attack' as const, label: 'ATTACK', desc: 'kin+cn0 → DENIED' },
            { k: 'cno' as const, label: 'C/N0', desc: 'lockstep → DEGRADED' },
            { k: 'altitude' as const, label: 'ALT', desc: 'baro Δ → DEGRADED' },
            { k: 'heading' as const, label: 'HDG', desc: 'track Δ → DEGRADED' },
            { k: 'temporal' as const, label: 'TIME', desc: 'replay → DEGRADED' },
            { k: 'environmental' as const, label: 'ENV', desc: 'bounds → DEGRADED' },
          ].map((m) => {
            const kind = m.k === 'attack' ? 'compound' : m.k;
            return (
              <Pressable
                key={m.k}
                onPress={() => runScenario(kind)}
                disabled={!demoArmed}
                style={[styles.harnessBtn, lastScenario === kind && demoArmed && styles.harnessBtnActive]}
                accessibilityRole="button"
                accessibilityLabel={`Stage ${m.label}`}
              >
                <Text style={styles.harnessBtnLabel}>{m.label}</Text>
                <Text style={styles.harnessBtnDesc}>{m.desc}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={recoveryDemo}
          disabled={!demoArmed}
          style={[styles.recoveryBtn, !demoArmed && styles.harnessGridDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Run recovery demonstration"
        >
          <Text style={styles.recoveryBtnText}>RECOVERY PATH — DENIED → RECOVERING → TRUSTED</Text>
        </Pressable>
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
        spoofDisabled={!demoArmed}
      />

      {/* SHOW REASON panel — last model explanation inline */}
      {reasonPanel ? (
        <Pressable style={styles.overlayScrim} onPress={() => setReasonPanel(false)}>
          <Pressable style={styles.overlayPanel} onPress={() => {}}>
            <Text style={styles.overlayTitle}>LAST REASON — ADVISORY</Text>
            <ScrollView style={styles.overlayScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.overlayBody}>
                {lastExplanation && lastExplanation !== '(explanation unavailable)'
                  ? lastExplanation
                  : pipeline.verdict?.reason ?? 'No transition recorded yet.'}
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
                  No embedded events yet (embeddings index after the first transition) or no matches.
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
  telOk: {
    color: colors.trusted,
  },
  telFail: {
    color: colors.denied,
  },
  telMuted: {
    color: colors.textMuted,
  },
  netBanner: {
    backgroundColor: 'rgba(0,217,163,0.08)',
    borderTopWidth: hairline,
    borderBottomWidth: hairline,
    borderColor: colors.trusted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  netBannerWarn: {
    backgroundColor: 'rgba(255,179,0,0.08)',
    borderColor: colors.caution,
  },
  netTitle: {
    ...monoNumericBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.caution,
  },
  netTitleOk: {
    color: colors.trusted,
  },
  netBody: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textPrimary,
  },
  noFixBanner: {
    backgroundColor: 'rgba(255,179,0,0.08)',
    borderTopWidth: hairline,
    borderBottomWidth: hairline,
    borderColor: colors.caution,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  openSettingsBtn: {
    borderWidth: hairline,
    borderColor: colors.caution,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: spacing.xs,
  },
  openSettingsText: {
    ...monoNumericBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.caution,
  },
  recoveryNote: {
    backgroundColor: 'rgba(0,217,163,0.08)',
    borderTopWidth: hairline,
    borderBottomWidth: hairline,
    borderColor: colors.trusted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  recoveryTitle: {
    ...monoNumericBold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.trusted,
  },
  recoveryBody: {
    ...monoNumeric,
    fontSize: 9,
    lineHeight: 13,
    color: colors.textPrimary,
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
  harnessPanel: {
    backgroundColor: colors.panelBg,
    borderTopWidth: hairline,
    borderTopColor: colors.chrome,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  harnessHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  harnessTitle: {
    ...monoNumericBold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.textPrimary,
  },
  armRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  armLabel: {
    ...monoNumericBold,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.textMuted,
  },
  armLabelOn: {
    color: colors.trusted,
  },
  harnessHint: {
    ...monoNumeric,
    fontSize: 8,
    lineHeight: 12,
    color: colors.textMuted,
  },
  harnessGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  harnessGridDisabled: {
    opacity: 0.4,
  },
  harnessBtn: {
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
  harnessBtnActive: {
    borderColor: colors.caution,
    backgroundColor: 'rgba(255,179,0,0.08)',
  },
  harnessBtnLabel: {
    ...monoNumericBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  harnessBtnDesc: {
    ...monoNumeric,
    fontSize: 7,
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
  recoveryBtn: {
    borderWidth: hairline,
    borderColor: colors.trusted,
    backgroundColor: colors.panelSurface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  recoveryBtnText: {
    ...monoNumericBold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.trusted,
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
