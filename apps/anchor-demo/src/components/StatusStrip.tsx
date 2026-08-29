/**
 * StatusStrip — full-width pipeline state readout. State color fills the
 * strip; text contrasts. Crossfades on every state transition.
 */
import { colorForIntegrityState, colors, fonts, hairline, monoNumeric, monoNumericBold, spacing } from '@/theme';
import type { Verdict } from 'anchor-sdk';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export function StatusStrip({ verdict }: { verdict: Verdict | null }) {
  const state = verdict?.state ?? 'STANDBY';
  const fill = useMemo(
    () => (verdict ? colorForIntegrityState(verdict.state) : colors.panelSurface),
    [verdict],
  );
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) });
  }, [state, opacity]);

  const crossfade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.strip, { backgroundColor: fill }, crossfade]}>
      <View style={styles.stateRow}>
        <Text style={[styles.stateText, verdict ? { color: colors.textOnColor } : styles.stateStandby]}>
          {state}
        </Text>
        {verdict ? (
          <Text style={styles.confidence}>CONF {Math.round(verdict.confidence * 100)}%</Text>
        ) : null}
      </View>
      <Text
        style={[styles.reason, verdict ? { color: colors.textOnColor } : styles.reasonStandby]}
        numberOfLines={2}
      >
        {verdict ? verdict.reason : 'Awaiting first fix — evaluating once GNSS data arrives'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  strip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.chrome,
    minHeight: 72,
  },
  stateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  stateText: {
    ...monoNumericBold,
    fontSize: 20,
    letterSpacing: 4,
  },
  stateStandby: {
    color: colors.textMuted,
  },
  confidence: {
    ...monoNumeric,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.textOnColor,
    opacity: 0.75,
  },
  reason: {
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  reasonStandby: {
    color: colors.textMuted,
  },
});
