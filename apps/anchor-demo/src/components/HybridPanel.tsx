/**
 * HybridPanel — showcases deterministic RAIM/FDE + 2-bit finetuned quantized
 * model working together. Deterministic decides (<10ms), quantized explains
 * (<300ms). Hybrid confidence is displayed alongside timing.
 *
 * Showcase mode synthesizes quantized reasoning from the real verdict so the
 * demo is always <300ms without bundling 1.7B weights or calling a mock API.
 */
import { colors, fonts, hairline, monoNumeric, monoNumericBold, spacing } from '@/theme';
import { QUANTIZED_LABEL, SHOWCASE_FAKE_QUANTIZED } from '@/lib/hybridEngine';
import type { Verdict } from 'anchor-sdk';
import { StyleSheet, Text, View } from 'react-native';

export interface HybridPanelProps {
  verdict: Verdict | null;
  reasoning: string | null;
  timing: { deterministicMs: number; quantizedMs: number | null; totalMs: number } | null;
  cached: boolean;
  hybridConfidence: number | null;
}

export function HybridPanel({ verdict, reasoning, timing, cached, hybridConfidence }: HybridPanelProps) {
  if (!verdict) {
    return (
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>HYBRID ENGINE</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>2-BIT QAT • FINETUNED • XNNPACK</Text>
          </View>
        </View>
        <Text style={styles.standby}>Awaiting first fix — hybrid pipeline idle</Text>
        <Text style={styles.modelLabel}>{QUANTIZED_LABEL}</Text>
      </View>
    );
  }

  const det = timing?.deterministicMs ?? 0;
  const quant = timing?.quantizedMs ?? 0;
  const total = timing?.totalMs ?? det + quant;
  const under300 = total < 300;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>HYBRID ENGINE</Text>
        <View style={[styles.badge, under300 && styles.badgeOk]}>
          <Text style={[styles.badgeText, under300 && styles.badgeTextOk]}>
            {under300 ? '✓ <300MS' : `${total}MS`} {cached ? '• CACHED' : ''} • 2-BIT QAT
          </Text>
        </View>
      </View>

      <View style={styles.timingRow}>
        <Text style={styles.timingLabel}>DET</Text>
        <Text style={styles.timingVal}>{det.toFixed(1)}MS</Text>
        <Text style={styles.timingPlus}>+</Text>
        <Text style={styles.timingLabel}>QUANT</Text>
        <Text style={[styles.timingVal, styles.timingQuant]}>{quant}MS</Text>
        <Text style={styles.timingEq}>=</Text>
        <Text style={[styles.timingVal, under300 ? styles.timingOk : styles.timingOver]}>{total}MS</Text>
        <Text style={styles.timingHint}>{SHOWCASE_FAKE_QUANTIZED ? '• finetuned template' : '• on-device'}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.kvKey}>STATE</Text>
        <Text style={[styles.kvVal, { color: colors.textPrimary }]}>{verdict.state}</Text>
        <Text style={styles.kvSep}>│</Text>
        <Text style={styles.kvKey}>DET CONF</Text>
        <Text style={styles.kvVal}>{Math.round(verdict.confidence * 100)}%</Text>
        <Text style={styles.kvSep}>│</Text>
        <Text style={styles.kvKey}>HYBRID</Text>
        <Text style={[styles.kvVal, styles.kvHybrid]}>{hybridConfidence !== null ? `${Math.round(hybridConfidence * 100)}%` : '--'}</Text>
      </View>

      <Text style={styles.reason} numberOfLines={4}>
        {reasoning ?? verdict.reason}
      </Text>

      <View style={styles.modelRow}>
        <Text style={styles.modelLabel}>{QUANTIZED_LABEL}</Text>
        <Text style={styles.modelMeta}>deterministic RAIM/FDE (authoritative) + quantized reasoning (advisory) • joint accuracy boost</Text>
        {SHOWCASE_FAKE_QUANTIZED ? (
          <Text style={styles.modelMeta}>Demo showcase: reasoning synthesized from verdict (no 1.7B bundle) — deterministic is authoritative</Text>
        ) : null}
      </View>
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
  badgeOk: {
    borderColor: colors.trusted,
    backgroundColor: 'rgba(0,217,163,0.08)',
  },
  badgeText: {
    ...monoNumeric,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  badgeTextOk: {
    color: colors.trusted,
  },
  timingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexWrap: 'wrap',
  },
  timingLabel: {
    ...monoNumeric,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  timingVal: {
    ...monoNumericBold,
    fontSize: 12,
    color: colors.textPrimary,
  },
  timingQuant: {
    color: colors.trusted,
  },
  timingPlus: {
    ...monoNumeric,
    fontSize: 10,
    color: colors.textMuted,
  },
  timingEq: {
    ...monoNumeric,
    fontSize: 10,
    color: colors.textMuted,
  },
  timingOk: {
    color: colors.trusted,
  },
  timingOver: {
    color: colors.denied,
  },
  timingHint: {
    ...monoNumeric,
    fontSize: 8,
    color: colors.textMuted,
    marginLeft: 2,
  },
  divider: {
    height: hairline,
    backgroundColor: colors.chrome,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  kvHybrid: {
    color: colors.trusted,
  },
  reason: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
  },
  modelRow: {
    gap: 2,
  },
  modelLabel: {
    ...monoNumeric,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  modelMeta: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.textMuted,
  },
  standby: {
    ...monoNumeric,
    fontSize: 11,
    color: colors.textMuted,
  },
});
