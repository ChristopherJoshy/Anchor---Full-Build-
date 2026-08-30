/**
 * TapeGauge — PFD-style vertical scrolling tape. The tick scale scrolls behind
 * a fixed, hard-edged center readout; the current value's tick aligns with the
 * center marker. Mono numerals, chrome ticks, state-colored readout. Value
 * changes are eased with Reanimated.
 */
import type { CheckId } from 'anchor-sdk';
import { useEffect } from 'react';
import { colors, hairline, monoNumeric, monoNumericBold } from '@/theme';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const VIEWPORT_H = 132;
const PX_PER_UNIT = 2.4;
const TOP_VALUE = 125; // scale spans -25..125 so the needle never clips
const MAJOR_STEP = 25;
const MINOR_STEP = 5;

interface TickDef {
  value: number;
  major: boolean;
}

const TICKS: TickDef[] = (() => {
  const out: TickDef[] = [];
  for (let v = -25; v <= 125; v += MINOR_STEP) {
    out.push({ value: v, major: v % MAJOR_STEP === 0 });
  }
  return out;
})();

const COLUMN_H = (TOP_VALUE - -25) * PX_PER_UNIT;

export interface TapeGaugeProps {
  checkId: CheckId;
  /** Check score, 0..1 — null before the first verdict (no data yet). */
  score: number | null;
  passed: boolean;
  /** Overall pipeline state color (semantic — see theme). */
  stateColor: string;
}

export function TapeGauge({ checkId, score, passed, stateColor }: TapeGaugeProps) {
  const hasData = score !== null && Number.isFinite(score);
  const safeScore = hasData ? Math.max(0, Math.min(1, score as number)) : 0;
  const displayScore = Math.round(safeScore * 100);
  const value = useSharedValue(displayScore);

  useEffect(() => {
    value.value = withTiming(displayScore, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });
  }, [displayScore, value]);

  const columnStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: VIEWPORT_H / 2 - (TOP_VALUE - value.value) * PX_PER_UNIT }],
  }));

  return (
    <View style={styles.cell}>
      <Text style={styles.label}>{checkId.toUpperCase()}</Text>
      <View style={styles.viewport}>
        <Animated.View style={[styles.column, columnStyle]}>
          {TICKS.map((tick) => (
            <View
              key={tick.value}
              style={[styles.tickRow, { top: (TOP_VALUE - tick.value) * PX_PER_UNIT - 1 }]}
            >
              {tick.major && tick.value >= 0 ? (
                <Text style={styles.numeral}>{tick.value}</Text>
              ) : null}
              <View style={[styles.tick, tick.major ? styles.tickMajor : styles.tickMinor]} />
            </View>
          ))}
        </Animated.View>
        {/* fixed center marker */}
        <View style={[styles.centerMarker, { backgroundColor: hasData ? stateColor : colors.chrome }]} />
        {/* fixed readout — static text, column is animated */}
        <View style={[styles.readout, { borderColor: hasData ? stateColor : colors.chrome }]}>
          <Text style={[styles.readoutText, { color: hasData ? stateColor : colors.textMuted }]}>
            {hasData ? displayScore.toString().padStart(3, '0') : '—'}
          </Text>
        </View>
      </View>
      <View style={[styles.flag, { borderColor: !hasData ? colors.chrome : passed ? colors.chrome : colors.caution }]}>
        <Text style={[styles.flagText, !hasData ? styles.flagHold : passed ? styles.flagOk : styles.flagFail]}>
          {!hasData ? 'HOLD' : passed ? 'OK' : 'FAIL'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    alignItems: 'center',
  },
  label: {
    ...monoNumeric,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.textMuted,
    marginBottom: 4,
  },
  viewport: {
    width: 96,
    height: VIEWPORT_H,
    borderWidth: hairline,
    borderColor: colors.chrome,
    backgroundColor: colors.panelSurface,
    overflow: 'hidden',
  },
  column: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: COLUMN_H,
  },
  tickRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  numeral: {
    ...monoNumeric,
    fontSize: 9,
    color: colors.textMuted,
    marginRight: 3,
  },
  tick: {
    height: 2,
    backgroundColor: colors.chrome,
  },
  tickMajor: {
    width: 18,
  },
  tickMinor: {
    width: 9,
  },
  centerMarker: {
    position: 'absolute',
    left: 0,
    right: 34,
    top: VIEWPORT_H / 2 - 1,
    height: 2,
  },
  readout: {
    position: 'absolute',
    right: 0,
    top: VIEWPORT_H / 2 - 12,
    height: 24,
    width: 38,
    borderWidth: hairline,
    borderColor: colors.chrome,
    backgroundColor: colors.panelBg,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 3,
  },
  readoutText: {
    ...monoNumericBold,
    fontSize: 13,
  },
  flag: {
    marginTop: 4,
    borderWidth: hairline,
    borderColor: colors.chrome,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 34,
    alignItems: 'center',
  },
  flagText: {
    ...monoNumericBold,
    fontSize: 9,
    letterSpacing: 1,
  },
  flagOk: {
    color: colors.textMuted,
  },
  flagHold: {
    color: colors.textMuted,
  },
  flagFail: {
    color: colors.caution,
  },
});
