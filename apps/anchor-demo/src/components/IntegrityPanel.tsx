/**
 * IntegrityPanel — the REAL pipeline readout, no synthetic values anywhere.
 * Shows the measured deterministic evaluate() latency, the deterministic
 * confidence, and the advisory explanation from the on-device Qwen3 1.7B
 * (ExecuTorch) once the model has produced one. Until then the deterministic
 * reason is shown and clearly labeled as such.
 */
import { colors, fonts, hairline, monoNumeric, monoNumericBold, spacing } from '@/theme';
import type { Verdict } from 'anchor-sdk';
import { StyleSheet, Text, View } from 'react-native';

export interface IntegrityPanelProps {
  verdict: Verdict | null;
  /** Advisory text — real Qwen3 output when available, else the deterministic reason. */
  reasoning: string | null;
  /** Where `reasoning` came from: the loaded on-device model or the deterministic machine. */
  advisorySource: 'model' | 'deterministic';
  /** Measured evaluate() latency (ms) from the last pipeline tick. */
  detMs: number | null;
}

export function IntegrityPanel({ verdict, reasoning, advisorySource, detMs }: IntegrityPanelProps) {
  if (!verdict) {
    return (
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>INTEGRITY • RAIM/FDE</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>6 CHECKS • DETERMINISTIC</Text>
          </View>
        </View>
        <Text style={styles.standby}>Awaiting first fix — six physics checks idle</Text>
      </View>
    );
  }

  const failed = verdict.failedChecks;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>INTEGRITY • RAIM/FDE</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            EVAL {detMs !== null ? `${detMs.toFixed(1)}MS` : '—'} • 6 CHECKS
          </Text>
        </View>
      </View>

      <View style={styles.row}>
        <Text style={styles.kvKey}>STATE</Text>
        <Text style={styles.kvVal}>{verdict.state}</Text>
        <Text style={styles.kvSep}>│</Text>
        <Text style={styles.kvKey}>CONF</Text>
        <Text style={styles.kvVal}>{Math.round(verdict.confidence * 100)}%</Text>
        <Text style={styles.kvSep}>│</Text>
        <Text style={styles.kvKey}>FAILED</Text>
        <Text style={[styles.kvVal, failed.length > 0 && styles.kvFail]}>
          {failed.length === 0 ? 'none' : failed.join('+')}
        </Text>
      </View>

      <Text style={styles.reason} numberOfLines={4}>
        {reasoning ?? verdict.reason}
      </Text>

      <Text style={styles.source}>
        {advisorySource === 'model'
          ? 'ADVISORY: Qwen3 1.7B 8DA4W · ExecuTorch XNNPACK — live on-device model output'
          : 'ADVISORY: deterministic summary — Qwen3 model loading/available on device'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.panelSurface,
    borderTopWidth: hairline,
    borderTopColor: colors.chrome,
    borderBottomWidth: hairline,
    borderBottomColor: colors.chrome,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    ...monoNumericBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.trusted,
  },
  badge: {
    borderWidth: hairline,
    borderColor: colors.chrome,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: colors.panelBg,
  },
  badgeText: {
    ...monoNumeric,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  kvKey: {
    ...monoNumeric,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  kvVal: {
    ...monoNumericBold,
    fontSize: 11,
    color: colors.textPrimary,
  },
  kvSep: {
    ...monoNumeric,
    fontSize: 10,
    color: colors.chrome,
  },
  kvFail: {
    color: colors.caution,
  },
  reason: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
  },
  source: {
    ...monoNumeric,
    fontSize: 8,
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
  standby: {
    ...monoNumeric,
    fontSize: 11,
    color: colors.textMuted,
  },
});
