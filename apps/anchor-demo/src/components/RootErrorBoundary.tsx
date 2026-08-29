/**
 * RootErrorBoundary — production crash screen. In a release build an uncaught
 * render exception blanks the whole app; this boundary catches it, renders the
 * error + component stack on-screen (avionics DENIED styling), and logs it so
 * logcat shows the cause instead of a silent blank.
 */
import { consoleLog } from '@/lib/startupLog';
import { colors, fonts, hairline, monoNumeric, monoNumericBold, spacing } from '@/theme';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    consoleLog('ERROR', `RootErrorBoundary caught: ${error.message}`);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <View style={styles.screen}>
        <Text style={styles.flag}>INTEGRITY FAULT</Text>
        <Text style={styles.line}>
          The instrument crashed. Details below — report them to the build log.
        </Text>
        <ScrollView style={styles.detailWrap}>
          <Text style={styles.detail}>{error.name}: {error.message}</Text>
          {componentStack ? <Text style={styles.detail}>{componentStack}</Text> : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.panelBg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  flag: {
    ...monoNumericBold,
    fontSize: 18,
    letterSpacing: 3,
    color: colors.denied,
  },
  line: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  detailWrap: {
    borderWidth: hairline,
    borderColor: colors.denied,
    padding: spacing.md,
  },
  detail: {
    ...monoNumeric,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
});
