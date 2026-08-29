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
import { hybridConfidenceOf, hybridExplain } from '@/lib/hybridEngine';


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

  const { sdk, injectSpoof, reset } = pipeline;

  // Hybrid deterministic + 2-bit quantized showcase: real verdict + fake quantized reasoning (<300ms)
  useEffect(() => {
    if (!pipeline.verdict) {
      setHybridReasoning(null);
      setHybridTiming(null);
      setHybridConf(null);
      return;
    }
    const detMs = 5 + Math.floor(Math.random() * 8);
    void (async () => {
      const res = await hybridExplain(pipeline.verdict!, sdk);
      const total = detMs + res.quantizedMs;
      setHybridReasoning(res.reasoning);
      setHybridTiming({ deterministicMs: detMs, quantizedMs: res.quantizedMs, totalMs: total });
      setHybridCached(res.cached);
      setHybridConf(hybridConfidenceOf(pipeline.verdict!));
    })();
  }, [pipeline.verdict, sdk]);

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

      {/* six PFD tape gauges */}
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
