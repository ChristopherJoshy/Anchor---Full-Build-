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
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cosineSimilarity } from '@/lib/search';

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
  const { decisions } = usePermissions();
  const pipeline = useAnchorPipeline();
  const [searchOverlay, setSearchOverlay] = useState<SearchOverlayData | null>(null);
  const [reasonPanel, setReasonPanel] = useState(false);

  const { sdk } = pipeline;

  const onCommand = useCallback(
    (command: 'simulate spoof' | 'reset' | 'show reason') => {
      if (command === 'simulate spoof') {
        pipeline.injectSpoof();
      } else if (command === 'reset') {
        pipeline.reset();
      } else {
        setReasonPanel(true);
      }
    },
    [pipeline],
  );
  const voice = useVoiceCommands(sdk as AnchorSDK, onCommand);

  const locationDenied = decisions.location === 'denied' || pipeline.locationGranted === false;

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

  const lastExplanation = pipeline.events[0]?.explanation ?? null;

  if (locationDenied) {
    return (
      <View style={styles.screen}>
        <LocationDenied />
        <BottomBar
          micDenied={decisions.mic === 'denied'}
          voiceStatus={voice.status}
          onToggleMic={voice.toggle}
          lastTranscript={voice.lastTranscript}
          onSearch={onSearch}
          spoofing={pipeline.spoofing}
          onSpoof={pipeline.injectSpoof}
          onReset={pipeline.reset}
          onShowReason={() => setReasonPanel(true)}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
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

      <EventLog events={pipeline.events} />

      <BottomBar
        micDenied={decisions.mic === 'denied'}
        voiceStatus={voice.status}
        onToggleMic={voice.toggle}
        lastTranscript={voice.lastTranscript}
        onSearch={onSearch}
        spoofing={pipeline.spoofing}
        onSpoof={pipeline.injectSpoof}
        onReset={pipeline.reset}
        onShowReason={() => setReasonPanel(true)}
      />

      {/* SHOW REASON panel — last LLM explanation inline */}
      {reasonPanel ? (
        <Pressable style={styles.overlayScrim} onPress={() => setReasonPanel(false)}>
          <View style={styles.overlayPanel}>
            <Text style={styles.overlayTitle}>LAST REASON — AI EXPLANATION</Text>
            <ScrollView style={styles.overlayScroll}>
              <Text style={styles.overlayBody}>
                {lastExplanation ?? '(waiting for on-device model — explanation appears after the next transition)'}
              </Text>
            </ScrollView>
            <Text style={styles.overlayHint}>TAP ANYWHERE TO CLOSE</Text>
          </View>
        </Pressable>
      ) : null}

      {/* semantic search results overlay */}
      {searchOverlay ? (
        <Pressable style={styles.overlayScrim} onPress={() => setSearchOverlay(null)}>
          <View style={styles.overlayPanel}>
            <Text style={styles.overlayTitle}>SEARCH — &quot;{searchOverlay.query}&quot;</Text>
            <ScrollView style={styles.overlayScroll}>
              {searchOverlay.hits.length === 0 ? (
                <Text style={styles.overlayBody}>
                  No embedded events yet (embeddings index after the first transition) or no
                  matches.
                </Text>
              ) : (
                searchOverlay.hits.map(({ entry, score }) => (
                  <View key={entry.id} style={styles.hitRow}>
                    <Text style={styles.hitScore}>{Math.round(score * 100).toString().padStart(3, '0')}%</Text>
                    <Text style={styles.hitReason} numberOfLines={2}>
                      {entry.reason}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
            <Text style={styles.overlayHint}>TAP ANYWHERE TO CLOSE</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
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
