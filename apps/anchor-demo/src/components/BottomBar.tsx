/**
 * BottomBar — persistent instrument controls: voice capture button (offline
 * transcription via the SDK), semantic search input, and the labeled TEST
 * HARNESS debug panel (SIMULATE SPOOF / RESET / SHOW REASON).
 */
import { colors, fonts, hairline, monoNumeric, monoNumericBold, spacing } from '@/theme';
import type { VoiceStatus } from '@/hooks/useVoiceCommands';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export interface BottomBarProps {
  micDenied: boolean;
  voiceStatus: VoiceStatus;
  onToggleMic: () => void;
  lastTranscript: string | null;
  lastError?: string | null;
  onSearch: (query: string) => void;
  spoofing: boolean;
  onSpoof: () => void;
  onReset: () => void;
  onShowReason: () => void;
}

function HarnessButton({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.harnessBtn,
        active && styles.harnessBtnActive,
        pressed && styles.harnessBtnPressed,
      ]}
    >
      <Text style={[styles.harnessBtnText, active && styles.harnessBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function BottomBar({
  micDenied,
  voiceStatus,
  onToggleMic,
  lastTranscript,
  lastError,
  onSearch,
  spoofing,
  onSpoof,
  onReset,
  onShowReason,
}: BottomBarProps) {
  const [query, setQuery] = useState('');
  const recording = voiceStatus === 'recording';
  const processing = voiceStatus === 'processing';

  const submitSearch = () => {
    const trimmed = query.trim();
    if (trimmed !== '') {
      onSearch(trimmed);
    }
  };

  const micLabel = micDenied
    ? 'MIC OFF'
    : recording
      ? 'LISTENING…'
      : processing
        ? 'TRANSCRIBING…'
        : 'MIC';

  const micHint = lastError
    ? `ERROR: ${lastError}`
    : micDenied
      ? 'Microphone denied — voice commands disabled'
      : 'Tap, speak a command: simulate spoof / reset / show reason';

  return (
    <View style={styles.bar}>
      {/* TEST HARNESS — labeled debug controls */}
      <View style={styles.harnessRow}>
        <Text style={styles.harnessLabel}>TEST HARNESS</Text>
        <HarnessButton label="SIMULATE SPOOF" onPress={onSpoof} active={spoofing} />
        <HarnessButton label="RESET" onPress={onReset} />
        <HarnessButton label="SHOW REASON" onPress={onShowReason} />
      </View>

      <View style={styles.controlRow}>
        <Pressable
          onPress={onToggleMic}
          disabled={micDenied || processing}
          accessibilityRole="button"
          accessibilityLabel={micDenied ? 'Microphone disabled' : recording ? 'Stop recording' : 'Start recording'}
          accessibilityState={{ disabled: micDenied || processing, selected: recording }}
          style={[styles.micBtn, recording && styles.micBtnRecording, micDenied && styles.micBtnDisabled]}
        >
          <Text
            style={[
              styles.micText,
              recording && styles.micTextRecording,
              micDenied && styles.micTextDisabled,
            ]}
          >
            {micLabel}
          </Text>
        </Pressable>

        <TextInput
          style={styles.searchInput}
          placeholder="SEARCH LOG…"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={submitSearch}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={styles.hint} numberOfLines={1}>
        {lastTranscript ? `HEARD: ${lastTranscript}` : micHint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: hairline,
    borderTopColor: colors.chrome,
    backgroundColor: colors.panelSurface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  harnessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  harnessLabel: {
    ...monoNumeric,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.textMuted,
    width: 78,
  },
  harnessBtn: {
    borderWidth: hairline,
    borderColor: colors.caution,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    backgroundColor: colors.panelBg,
  },
  harnessBtnActive: {
    backgroundColor: colors.caution,
  },
  harnessBtnPressed: {
    opacity: 0.7,
  },
  harnessBtnText: {
    ...monoNumericBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.caution,
  },
  harnessBtnTextActive: {
    color: colors.textOnColor,
  },
  controlRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  micBtn: {
    width: 108,
    height: 44,
    borderWidth: hairline,
    borderColor: colors.trusted,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panelBg,
  },
  micBtnRecording: {
    backgroundColor: colors.trusted,
  },
  micBtnDisabled: {
    borderColor: colors.chrome,
  },
  micText: {
    ...monoNumericBold,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.trusted,
  },
  micTextRecording: {
    color: colors.textOnColor,
  },
  micTextDisabled: {
    color: colors.textMuted,
  },
  searchInput: {
    flex: 1,
    height: 44,
    borderWidth: hairline,
    borderColor: colors.chrome,
    backgroundColor: colors.panelBg,
    paddingHorizontal: spacing.md,
    ...monoNumeric,
    fontSize: 12,
    color: colors.textPrimary,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.textMuted,
  },
});
