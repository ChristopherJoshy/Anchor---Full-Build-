/**
 * Anchor design system — avionics glass-cockpit instrument.
 *
 * Hard edges (zero radius everywhere), hairline dividers, tabular mono
 * numerals, no gradients. Semantic color rule, never decorative:
 *   trusted  — ONLY for pipeline state TRUSTED
 *   caution  — DEGRADED and RECOVERING states, and per-check failure flags
 *   denied   — ONLY for pipeline state DENIED
 */
import type { TextStyle } from 'react-native';
import type { IntegrityState } from 'anchor-sdk';

export const colors = {
  panelBg: '#0C1116',
  panelSurface: '#151B21',
  chrome: '#3A434D',
  trusted: '#00D9A3',
  caution: '#FFB300',
  denied: '#FF3B30',
  textPrimary: '#E8EDF2',
  textMuted: '#8A949E',
  textOnColor: '#0C1116',
} as const;

/** The one state color, per the semantic rule. */
export function colorForIntegrityState(state: IntegrityState): string {
  switch (state) {
    case 'TRUSTED':
      return colors.trusted;
    case 'DEGRADED':
    case 'RECOVERING':
      return colors.caution;
    case 'DENIED':
      return colors.denied;
  }
}

export const fonts = {
  mono: 'IBMPlexMono_400Regular',
  monoSemiBold: 'IBMPlexMono_600SemiBold',
  sans: 'Inter_400Regular',
  sansSemiBold: 'Inter_600SemiBold',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const hairline = 1;

/** Numeric text must always pair mono with tabular figures. */
export const monoNumeric: TextStyle = {
  fontFamily: fonts.mono,
  fontVariant: ['tabular-nums'],
};

export const monoNumericBold: TextStyle = {
  fontFamily: fonts.monoSemiBold,
  fontVariant: ['tabular-nums'],
};
