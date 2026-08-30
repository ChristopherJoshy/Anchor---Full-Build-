/**
 * Instrument dashboard — real signals only, structured sections, scrollable.
 *
 * Layout (top to bottom):
 *   StatusStrip      — fixed pipeline state banner (color = state)
 *   ModelStatus      — real ExecuTorch download progress (hides when ready)
 *   [scroll]
 *     TELEMETRY      — live sensor rail, all measured values
 *     CHECKS         — six physics tape gauges
 *     NETWORK        — real AnchorNet VPN probe + IP↔GPS divergence panel
 *     INTEGRITY      — RAIM/FDE verdict + on-device Qwen advisory
 *     FLIGHT LOG     — recorder of machine transitions + network events
 *     DEMO CONTROLS  — disarmed by default; the ONLY staged-input surface
 *   BottomBar        — fixed: voice, search, harness actions
 *
 * Every displayed number traces to a real sensor/SDK value. Synthetic attack
 * frames exist exclusively inside the armed DEMO CONTROLS path.
 */
import { BottomBar } from '@/components/BottomBar';
import { EventLog } from '@/components/EventLog';
import { IntegrityPanel } from '@/components/IntegrityPanel';
import { ModelStatus } from '@/components/ModelStatus';
import { StatusStrip } from '@/components/StatusStrip';
import { TapeGauge } from '@/components/TapeGauge';
import { useRouter } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useAnchorPipeline } from '@/hooks/useAnchorPipeline';
import type { EventLogEntry } from '@/hooks/useAnchorPipeline';
import { useNetworkIntelligence, DIVERGENCE_LIMIT_KM } from '@/hooks/useNetworkIntegrity';
import { usePermissions } from '@/hooks/usePermissions';
import { useVoiceCommands } from '@/hooks/useVoiceCommands';
import { colors, colorForIntegrityState, fonts, hairline, monoNumeric, monoNumericBold, spacing } from '@/theme';
import { cosineSimilarity } from '@/lib/search';
import { startupLog } from '@/lib/startupLog';
import type { AnchorSDK, CheckId, CheckResult } from 'anchor-sdk';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CHECK_ORDER: CheckId[] = ['kinematic', 'heading', 'temporal', 'altitude', 'environmental', 'cn0'];

interface SearchOverlayData {
  query: string;
  hits: Array<{ entry: EventLogEntry; score: number }>;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

export default function DashboardScreen() {
  const { decisions, loaded: permsLoaded } = usePermissions();
  const pipeline = useAnchorPipeline();
  const router = useRouter();
  const [searchOverlay, setSearchOverlay] = useState<SearchOverlayData | null>(null);
  const [reasonPanel, setReasonPanel] = useState(false);

  useEffect(() => {
    startupLog(`dashboard mounted: location=${decisions.location} mic=${decisions.mic}`);
  }, [decisions.location, decisions.mic]);

  // Primer not completed (deep link) — permission state was never requested;
  // route back instead of claiming a denial that never happened.
  useEffect(() => {
    if (permsLoaded && decisions.location === 'unknown') {
      router.replace('/');
    }
  }, [permsLoaded, decisions.location, router]);

  const {
    sdk,
    injectSpoof,
    runScenario,
    recoveryDemo,
    reset,
    recordNetwork,
    demoArmed,
    toggleDemoArmed,
    detMs,
    telemetry,
    lastScenario,
  } = pipeline;

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

  const locationDenied = permsLoaded && decisions.location === 'denied';
  const noLiveGps = telemetry === null && !locationDenied;

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
  // Newest explanation from a real machine transition — the newest ENTRY is
  // often a NETWORK recorder row (no explanation), which must not hide the
  // model's advisory for the latest transition.
  const lastExplanation =
    pipeline.events.find(
      (e) => e.explanation !== null && e.explanation !== '(explanation unavailable)',
    )?.explanation ?? null;
  const advisorySource: 'model' | 'deterministic' = lastExplanation ? 'model' : 'deterministic';

  // Real network events into the flight recorder. The first poll only seeds
  // the ref — a tunnel that simply isn't up yet is not a "cleared" event.
  const prevNetRef = useRef<{ vpn: boolean | null; diverged: boolean | null }>({ vpn: null, diverged: null });
  useEffect(() => {
    const diverged = net.divergenceKm !== null && net.divergenceKm > DIVERGENCE_LIMIT_KM;
    if (prevNetRef.current.vpn !== null && net.vpnActive !== prevNetRef.current.vpn) {
      recordNetwork(
        net.vpnActive
          ? `VPN tunnel detected (AnchorNet) — IP ${net.ip ? `${net.ip.ip}${net.ip.city ? ` · ${net.ip.city}, ${net.ip.country ?? ''}` : ''}` : 'resolving'}; network integrity check FAILS while up`
          : 'VPN tunnel cleared — direct network path, integrity restored after debounce',
      );
    }
    prevNetRef.current.vpn = net.vpnActive;
    if (prevNetRef.current.diverged !== null && diverged !== prevNetRef.current.diverged && diverged) {
      recordNetwork(
        `IP↔GPS divergence ${Math.round(net.divergenceKm ?? 0)} km — network location untrusted, GNSS physics authoritative`,
      );
    }
    prevNetRef.current.diverged = diverged;
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

  const networkResult = resultFor('network');
  const netBannerVisible = net.vpnActive || (net.divergenceKm !== null && net.divergenceKm > DIVERGENCE_LIMIT_KM);

  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusStrip verdict={pipeline.verdict} />
      <ModelStatus />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* NO LIVE GPS / permission banners */}
        {locationDenied || noLiveGps ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>
              {locationDenied ? 'NO LIVE GPS — PERMISSION DENIED' : 'NO LIVE GPS — WAITING FOR FIX'}
            </Text>
            <Text style={styles.bannerBody}>
              {locationDenied
                ? 'The instrument needs location permission to stream fixes.'
                : 'Waiting for the first GNSS fix — all checks idle until then.'}
            </Text>
            {locationDenied ? (
              <Pressable style={styles.openSettingsBtn} onPress={() => void Linking.openSettings()}>
                <Text style={styles.openSettingsText}>OPEN SETTINGS</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* TELEMETRY */}
        {telemetry ? (
          <View>
            <SectionHeader title="TELEMETRY" meta={`${telemetry.imuCount} IMU · ${telemetry.baroCount} BARO · ${telemetry.gnssEpochs} GNSS`} />
            <View style={styles.panel}>
              <View style={styles.telRow}>
                <Text style={styles.telLabel}>POS</Text>
                <Text style={styles.telVal}>
                  {Math.abs(telemetry.lat).toFixed(4)}°{telemetry.lat >= 0 ? 'N' : 'S'} {Math.abs(telemetry.lon).toFixed(4)}°{telemetry.lon >= 0 ? 'E' : 'W'}
                </Text>
              </View>
              <View style={styles.telRow}>
                <Text style={styles.telLabel}>ALT</Text>
                <Text style={styles.telVal}>{Number.isFinite(telemetry.alt) ? `${telemetry.alt.toFixed(1)}m` : '—'}</Text>
                <Text style={styles.telLabel}>ACC</Text>
                <Text style={[styles.telVal, telemetry.acc > 25 ? styles.telWarn : null]}>
                  {Number.isFinite(telemetry.acc) ? `${telemetry.acc.toFixed(1)}m` : '—'}
                </Text>
                <Text style={styles.telLabel}>FIX</Text>
                <Text style={[styles.telVal, telemetry.fixAgeMs !== null && telemetry.fixAgeMs > 5000 ? styles.telWarn : null]}>
                  {telemetry.fixAgeMs !== null ? `${(telemetry.fixAgeMs / 1000).toFixed(0)}s` : '—'}
                </Text>
              </View>
              <View style={styles.telRow}>
                <Text style={styles.telLabel}>SPD</Text>
                <Text style={styles.telVal}>{Number.isFinite(telemetry.speed) ? `${telemetry.speed.toFixed(1)}m/s` : '—'}</Text>
                <Text style={styles.telLabel}>TRK</Text>
                <Text style={styles.telVal}>{Number.isFinite(telemetry.bearing) ? `${telemetry.bearing.toFixed(0)}°` : '—'}</Text>
                <Text style={styles.telLabel}>SAT</Text>
                <Text style={[styles.telVal, telemetry.sats !== null && telemetry.sats < 4 ? styles.telWarn : null]}>
                  {telemetry.sats ?? '—'}
                </Text>
                <Text style={styles.telLabel}>BARO</Text>
                <Text style={styles.telVal}>{telemetry.baroHpa !== null ? `${telemetry.baroHpa.toFixed(1)}hPa` : '—'}</Text>
              </View>
              <View style={[styles.telRow, styles.telLast]}>
                <Text style={styles.telLabel}>SENSORS</Text>
                <Text style={styles.telVal}>
                  <Text style={pipeline.locationError ? styles.telFail : styles.telOk}>GPS{pipeline.locationError ? '✗' : '✓'}</Text>
                  {' · '}
                  <Text style={pipeline.imuError ? styles.telFail : styles.telOk}>IMU{pipeline.imuError ? '✗' : '✓'}</Text>
                  {' · '}
                  <Text style={pipeline.baroError ? styles.telFail : styles.telOk}>BARO{pipeline.baroError ? '✗' : '✓'}</Text>
                  {' · '}
                  <Text style={pipeline.gnssSupported === false ? styles.telMuted : pipeline.gnssError ? styles.telFail : styles.telOk}>
                    GNSS{pipeline.gnssSupported === false ? 'N/A' : pipeline.gnssError ? '✗' : '✓'}
                  </Text>
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* CHECKS */}
        <View>
          <SectionHeader title="CHECKS" meta="6 PHYSICS • SCORE 0-100" />
          <View style={styles.panel}>
            <View style={styles.gaugeRow}>
              {CHECK_ORDER.slice(0, 3).map((id) => {
                const r = resultFor(id);
                return (
                  <View key={id} style={styles.gaugeCell}>
                    <TapeGauge
                      checkId={id}
                      score={r ? r.score : null}
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
                      score={r ? r.score : null}
                      passed={r?.passed ?? true}
                      stateColor={stateColor}
                    />
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* NETWORK */}
        <View>
          <SectionHeader title="NETWORK" meta="ANCHORNET • OS-REPORTED" />
          <View style={styles.panel}>
            <View style={styles.netRow}>
              <Text style={styles.telLabel}>VPN</Text>
              <Text style={[styles.telVal, net.vpnActive ? styles.telFail : styles.telOk]}>
                {net.vpnActive ? 'TUNNEL ACTIVE — INCONSISTENT' : 'no tunnel'}
              </Text>
            </View>
            <View style={styles.netRow}>
              <Text style={styles.telLabel}>CHECK</Text>
              <Text style={[styles.telVal, networkResult && !networkResult.passed ? styles.telFail : styles.telOk]}>
                {networkResult ? (networkResult.passed ? 'OK' : 'FAIL') : '—'}
              </Text>
              <Text style={styles.telLabel}>IP↔GPS</Text>
              <Text style={[styles.telVal, net.divergenceKm !== null && net.divergenceKm > DIVERGENCE_LIMIT_KM ? styles.telWarn : null]}>
                {net.divergenceKm !== null ? `${net.divergenceKm >= 1000 ? `${(net.divergenceKm / 1000).toFixed(1)}k` : Math.round(net.divergenceKm)} km` : '—'}
              </Text>
            </View>
            <View style={[styles.netRow, styles.telLast]}>
              <Text style={styles.telLabel}>IP</Text>
              <Text style={styles.telVal} numberOfLines={1}>
                {net.ip ? `${net.ip.ip}${net.ip.city ? ` · ${net.ip.city}, ${net.ip.country ?? ''}` : ''}` : net.checking ? 'resolving…' : '—'}
              </Text>
            </View>
          </View>
          {netBannerVisible ? (
            <View style={[styles.banner, net.vpnActive ? styles.bannerVpn : styles.bannerWarn]}>
              <Text style={styles.bannerTitle}>
                {net.vpnActive ? 'VPN TUNNEL ACTIVE — OS-REPORTED' : 'IP↔GPS DIVERGENCE'}
              </Text>
              <Text style={styles.bannerBody}>
                {net.vpnActive
                  ? 'The tunnel re-terminates the network path elsewhere: the network check fails and the machine will not hold TRUSTED until it clears and the debounce elapses.'
                  : 'Network location does not match the GNSS fix; GNSS physics remain authoritative.'}
              </Text>
            </View>
          ) : null}
        </View>

        {/* INTEGRITY */}
        <View>
          <SectionHeader title="INTEGRITY" meta="RAIM/FDE" />
          <IntegrityPanel
            verdict={pipeline.verdict}
            reasoning={advisorySource === 'model' ? lastExplanation : pipeline.verdict?.reason ?? null}
            advisorySource={advisorySource}
            detMs={detMs}
          />
        </View>

        {/* RECOVERY VERIFIED — derived from real machine transitions in the log */}
        {recoveryPair ? (
          <View style={styles.recoveryNote}>
            <Text style={styles.recoveryTitle}>RECOVERY VERIFIED — DEBOUNCE 5/5 CLEAN EVALUATIONS</Text>
            <Text style={styles.recoveryBody}>
              RECOVERING @{formatClock(recoveryPair.recoveringAt)} → TRUSTED @{formatClock(recoveryPair.trustedAt)} · real state-machine transition, recorded by the flight recorder
            </Text>
          </View>
        ) : null}

        {/* FLIGHT LOG */}
        <View>
          <SectionHeader title="FLIGHT LOG" meta={`${pipeline.events.length} ENTRIES`} />
          <View style={styles.logWrap}>
            <EventLog events={pipeline.events} />
          </View>
        </View>

        {/* DEMO CONTROLS — the only staged-input surface; disarmed by default */}
        <View>
          <SectionHeader title="DEMO CONTROLS" meta={demoArmed ? 'ARMED — STAGED ATTACKS' : 'LIVE SENSORS ONLY'} />
          <View style={styles.panel}>
            <View style={styles.armRow}>
              <Text style={[styles.armLabel, demoArmed && styles.armLabelOn]}>
                {demoArmed ? 'DEMO ARMED' : 'DISARMED'}
              </Text>
              <Switch
                value={demoArmed}
                onValueChange={toggleDemoArmed}
                trackColor={{ false: colors.chrome, true: colors.trusted }}
                thumbColor="#E8EDF2"
              />
            </View>
            {demoArmed ? (
              <>
                <Text style={styles.harnessHint}>
                  Armed frames enter the same evaluate() path as live GPS — every gauge and state change is real physics. Disarming purges the queue instantly.
                </Text>
                <View style={styles.harnessGrid}>
                  {[
                    { k: 'teleport' as const, label: 'TELEPORT', desc: 'kinematic' },
                    { k: 'attack' as const, label: 'ATTACK', desc: 'kin+cn0' },
                    { k: 'cno' as const, label: 'C/N0', desc: 'lockstep' },
                    { k: 'altitude' as const, label: 'ALT', desc: 'baro Δ' },
                    { k: 'heading' as const, label: 'HDG', desc: 'track Δ' },
                    { k: 'temporal' as const, label: 'TIME', desc: 'replay' },
                    { k: 'environmental' as const, label: 'ENV', desc: 'bounds' },
                  ].map((m) => {
                    const kind = m.k === 'attack' ? 'compound' : m.k;
                    return (
                      <Pressable
                        key={m.k}
                        onPress={() => runScenario(kind)}
                        style={[styles.harnessBtn, lastScenario === kind && styles.harnessBtnActive]}
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
                  style={styles.recoveryBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Run recovery demonstration"
                >
                  <Text style={styles.recoveryBtnText}>RECOVERY PATH — DENIED → RECOVERING → TRUSTED</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.harnessHint}>
                All values are live sensors. Arm only to stage attacks that cannot be performed live (VPN spoofing is always real — flip a VPN on the device).
              </Text>
            )}
          </View>
        </View>
      </ScrollView>

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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    ...monoNumericBold,
    fontSize: 11,
    letterSpacing: 3,
    color: colors.textMuted,
  },
  sectionMeta: {
    ...monoNumeric,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  panel: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.panelSurface,
    borderBottomWidth: hairline,
    borderBottomColor: colors.chrome,
  },
  banner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.panelSurface,
    borderLeftWidth: 2,
    borderLeftColor: colors.caution,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerWarn: {
    borderLeftColor: colors.caution,
  },
  bannerVpn: {
    borderLeftColor: colors.denied,
  },
  bannerTitle: {
    ...monoNumericBold,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.caution,
  },
  bannerBody: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  openSettingsBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.caution,
  },
  openSettingsText: {
    ...monoNumericBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.textOnColor,
  },
  telRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: hairline,
    borderBottomColor: colors.panelBg,
  },
  telLast: {
    borderBottomWidth: 0,
  },
  telLabel: {
    ...monoNumeric,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
    width: 56,
  },
  telVal: {
    ...monoNumeric,
    fontSize: 12,
    color: colors.textPrimary,
    flex: 1,
  },
  telWarn: {
    color: colors.caution,
  },
  telFail: {
    color: colors.denied,
  },
  telOk: {
    color: colors.textPrimary,
  },
  telMuted: {
    color: colors.textMuted,
  },
  gaugeRow: {
    flexDirection: 'row',
  },
  gaugeCell: {
    flex: 1,
    borderRightWidth: hairline,
    borderRightColor: colors.panelBg,
  },
  gaugeDivider: {
    height: hairline,
    backgroundColor: colors.panelBg,
  },
  netRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: hairline,
    borderBottomColor: colors.panelBg,
  },
  recoveryNote: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.panelSurface,
    borderLeftWidth: 2,
    borderLeftColor: colors.trusted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  recoveryTitle: {
    ...monoNumericBold,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.trusted,
  },
  recoveryBody: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  logWrap: {
    marginHorizontal: spacing.lg,
    height: 200,
    backgroundColor: colors.panelSurface,
  },
  armRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.panelBg,
  },
  armLabel: {
    ...monoNumericBold,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.textMuted,
  },
  armLabelOn: {
    color: colors.trusted,
  },
  harnessHint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  harnessGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  harnessBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: hairline,
    borderColor: colors.chrome,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.panelBg,
  },
  harnessBtnActive: {
    borderColor: colors.caution,
  },
  harnessBtnLabel: {
    ...monoNumericBold,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.textPrimary,
  },
  harnessBtnDesc: {
    ...monoNumeric,
    fontSize: 10,
    color: colors.textMuted,
  },
  recoveryBtn: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderWidth: hairline,
    borderColor: colors.trusted,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  recoveryBtnText: {
    ...monoNumericBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.trusted,
  },
  overlayScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(12, 17, 22, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  overlayPanel: {
    alignSelf: 'stretch',
    backgroundColor: colors.panelSurface,
    borderWidth: hairline,
    borderColor: colors.chrome,
    padding: spacing.lg,
    maxHeight: '70%',
  },
  overlayTitle: {
    ...monoNumericBold,
    fontSize: 12,
    letterSpacing: 3,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  overlayScroll: {
    flexGrow: 0,
  },
  overlayBody: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  overlayHint: {
    ...monoNumeric,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  hitRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: hairline,
    borderBottomColor: colors.panelBg,
  },
  hitScore: {
    ...monoNumeric,
    fontSize: 12,
    color: colors.caution,
    width: 40,
  },
  hitReason: {
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
    flex: 1,
  },
});
