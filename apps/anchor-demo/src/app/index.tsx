import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePermissions } from '@/hooks/usePermissions';
import { startupLog } from '@/lib/startupLog';
import { colors, fonts, hairline, monoNumericBold, spacing } from '@/theme';


function PermissionRow({ plate, line }: { plate: string; line: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.plate}>
        <Text style={styles.plateText}>{plate}</Text>
      </View>
      <Text style={styles.rowLine}>{line}</Text>
    </View>
  );
}

export default function PrimerScreen() {
  const router = useRouter();
  const { decisions, loaded, requestAll } = usePermissions();
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    startupLog('primer screen mounted');
  }, []);

  useEffect(() => {
    if (loaded) {
      startupLog(
        `primer decisions loaded: location=${decisions.location} mic=${decisions.mic} completed=${decisions.primerCompleted}`,
      );
    }
  }, [loaded, decisions]);

  useEffect(() => {
    if (loaded && decisions.primerCompleted) {
      startupLog('primer complete — routing to dashboard');
      router.replace('/dashboard');
    }
  }, [loaded, decisions.primerCompleted, router]);

  const onContinue = async () => {
    if (requesting) {
      return;
    }
    setRequesting(true);
    await requestAll();
    router.replace('/dashboard');
  };

  // While decisions load (or after completing, while the replace navigates),
  // render the shell instead of null — a production blank frame must never be
  // indistinguishable from a crash.
  if (!loaded || decisions.primerCompleted) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Image source={require('../../assets/images/splash-icon.png')} style={styles.glyph} />
          <Text style={styles.brand}>ANCHOR</Text>
          <Text style={styles.subline}>GNSS INTEGRITY MONITOR</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Image source={require('../../assets/images/splash-icon.png')} style={styles.glyph} />
        <Text style={styles.brand}>ANCHOR</Text>
        <Text style={styles.subline}>GNSS INTEGRITY MONITOR</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.rows}>
        <PermissionRow
          plate="GPS"
          line="Location — reads GPS fixes to check them against physics"
        />
        <View style={styles.rowDivider} />
        <PermissionRow
          plate="MIC"
          line="Microphone — hears voice commands like 'simulate spoof'"
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.note}>
          You can change these later in system settings. The instrument needs location to function;
          voice commands are optional.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.continueBtn, pressed && styles.continueBtnPressed]}
          onPress={onContinue}
          disabled={requesting}
        >
          <Text style={styles.continueText}>{requesting ? 'WAITING…' : 'CONTINUE'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.panelBg,
    paddingHorizontal: spacing.xl,
    paddingTop: 72,
    paddingBottom: spacing.xl,
  },
  header: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  glyph: {
    width: 120,
    height: 120,
  },
  brand: {
    ...monoNumericBold,
    fontSize: 28,
    letterSpacing: 8,
    color: colors.textPrimary,
  },
  subline: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 3,
    color: colors.textMuted,
  },
  divider: {
    height: hairline,
    backgroundColor: colors.chrome,
    marginVertical: spacing.xl,
  },
  rows: {
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  plate: {
    width: 56,
    height: 40,
    borderWidth: hairline,
    borderColor: colors.trusted,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panelSurface,
  },
  plateText: {
    ...monoNumericBold,
    fontSize: 12,
    color: colors.trusted,
  },
  rowLine: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  rowDivider: {
    height: hairline,
    backgroundColor: colors.chrome,
  },
  footer: {
    marginTop: 'auto',
    gap: spacing.lg,
  },
  note: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  continueBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.trusted,
    borderWidth: hairline,
    borderColor: colors.trusted,
  },
  continueBtnPressed: {
    backgroundColor: colors.panelBg,
  },
  continueText: {
    ...monoNumericBold,
    fontSize: 14,
    letterSpacing: 4,
    color: colors.textOnColor,
  },
});
