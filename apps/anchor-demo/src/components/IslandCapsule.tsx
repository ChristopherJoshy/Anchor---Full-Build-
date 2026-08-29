/**
 * IslandCapsule — Dynamic-Island-style integrity capsule for the iQOO 15 demo
 * device. A compact pill floats at the top center of the display (hugging the
 * camera cutout) showing the live RAIM/FDE state and confidence; it expands
 * into a full readout card on any non-TRUSTED state change or tap. Pure UI —
 * every value shown is the real pipeline output; nothing is synthesized.
 */
import { colorForIntegrityState, colors, fonts, hairline, monoNumeric, monoNumericBold, spacing } from '@/theme';
import type { Verdict } from 'anchor-sdk';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const PILL_H = 34;

export interface IslandCapsuleProps {
  verdict: Verdict | null;
  /** Measured evaluate() latency from the last pipeline tick. */
  detMs: number | null;
  /** Real AnchorNet VPN signal. */
  vpnActive?: boolean;
  /** Real IP↔GPS divergence (km) when known. */
  divergenceKm?: number | null;
  /** Status-bar inset so the capsule hugs the camera cutout. */
  topInset: number;
}

export function IslandCapsule({ verdict, detMs, vpnActive, divergenceKm, topInset }: IslandCapsuleProps) {
  const [expanded, setExpanded] = useState(false);
  const state = verdict?.state ?? null;
  const fill = verdict ? colorForIntegrityState(verdict.state) : colors.panelSurface;
  const pillOpacity = useSharedValue(1);

  // Expand on any non-TRUSTED transition; hold 4 s; auto-collapse. Tap toggles.
  useEffect(() => {
    pillOpacity.value = 0;
    pillOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    if (state && state !== 'TRUSTED') {
      setExpanded(true);
      const t = setTimeout(() => setExpanded(false), 4000);
      return () => clearTimeout(t);
    }
    setExpanded(false);
  }, [state, pillOpacity]);

  const pillFade = useAnimatedStyle(() => ({ opacity: pillOpacity.value }));
  const top = Math.max(topInset - 16, 6);
  const textOn = verdict ? colors.textOnColor : colors.textMuted;

  return (
    <>
      {/* compact pill */}
      <Animated.View pointerEvents={expanded ? 'none' : 'box-none'} style={[styles.wrap, { top }, pillFade]}>
        <Pressable
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel={`Integrity ${state ?? 'standby'}`}
          style={[styles.pill, { backgroundColor: fill, borderColor: verdict ? fill : colors.chrome }]}
        >
          <View style={[styles.dot, { backgroundColor: verdict ? textOn : colors.textMuted }]} />
          <Text style={[styles.pillText, { color: textOn }]} numberOfLines={1}>
            {state ?? 'STANDBY'}
          </Text>
          {verdict ? (
            <Text style={[styles.pillConf, { color: textOn }]}>{Math.round(verdict.confidence * 100)}%</Text>
          ) : null}
        </Pressable>
      </Animated.View>

      {/* expanded readout card */}
      {expanded ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(160)}
          pointerEvents="box-none"
          style={[styles.wrap, { top: Math.max(topInset - 4, 4), zIndex: 61 }]}
        >
          <Pressable
            onPress={() => setExpanded(false)}
            accessibilityRole="button"
            accessibilityLabel="Collapse integrity capsule"
            style={[styles.card, { borderColor: verdict ? fill : colors.chrome }]}
          >
            <View style={styles.cardHead}>
              <View style={[styles.dot, { backgroundColor: verdict ? fill : colors.textMuted }]} />
              <Text style={[styles.cardState, { color: verdict ? fill : colors.textMuted }]}>
                {state ?? 'STANDBY'}
              </Text>
              <Text style={styles.cardSpacer}>·</Text>
              <Text style={styles.cardKv}>CONF</Text>
              <Text style={styles.cardVal}>{verdict ? `${Math.round(verdict.confidence * 100)}%` : '—'}</Text>
              <Text style={styles.cardSpacer}>·</Text>
              <Text style={styles.cardKv}>EVAL</Text>
              <Text style={styles.cardVal}>{detMs !== null ? `${detMs.toFixed(1)}ms` : '—'}</Text>
            </View>
            <Text style={styles.cardReason} numberOfLines={3}>
              {verdict ? verdict.reason : 'Awaiting first fix — six physics checks idle'}
            </Text>
            <View style={styles.cardFoot}>
              <Text style={styles.cardKv}>FAILED</Text>
              <Text style={[styles.cardVal, verdict && verdict.failedChecks.length > 0 && styles.cardFail]}>
                {verdict ? (verdict.failedChecks.length === 0 ? 'none' : verdict.failedChecks.join('+')) : '—'}
              </Text>
              <Text style={styles.cardSpacer}>·</Text>
              <Text style={styles.cardKv}>VPN</Text>
              <Text style={[styles.cardVal, vpnActive && styles.cardWarn]}>
                {vpnActive && divergenceKm != null
                  ? `TUNNEL ${divergenceKm >= 1000 ? `${(divergenceKm / 1000).toFixed(1)}k` : Math.round(divergenceKm)}km`
                  : vpnActive
                    ? 'TUNNEL'
                    : '—'}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 60,
    elevation: 8,
  },
  pill: {
    height: PILL_H,
    borderRadius: PILL_H / 2,
    borderWidth: hairline,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    ...monoNumericBold,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  pillConf: {
    ...monoNumeric,
    fontSize: 10,
    opacity: 0.85,
  },
  card: {
    width: '86%',
    maxWidth: 340,
    borderRadius: 22,
    borderWidth: hairline,
    backgroundColor: colors.panelSurface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardState: {
    ...monoNumericBold,
    fontSize: 13,
    letterSpacing: 2,
  },
  cardSpacer: {
    ...monoNumeric,
    fontSize: 10,
    color: colors.chrome,
  },
  cardKv: {
    ...monoNumeric,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  cardVal: {
    ...monoNumericBold,
    fontSize: 11,
    color: colors.textPrimary,
  },
  cardFail: {
    color: colors.caution,
  },
  cardWarn: {
    color: colors.caution,
  },
  cardReason: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
  },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
