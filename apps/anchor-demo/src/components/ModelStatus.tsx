/**
 * ModelStatus — real on-device AI model download/load readout.
 * Subscribes to the ExecuTorch resource-fetcher progress (fraction 0..1 per
 * task) via the SDK's subscribeModelDownloads. Every percentage shown is the
 * fetcher's own measurement — nothing is simulated.
 */
import { getModelDownloadStates, subscribeModelDownloads } from 'anchor-sdk';
import type { ModelTask } from 'anchor-sdk';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, monoNumeric, spacing } from '@/theme';

interface TaskView {
  task: ModelTask;
  label: string;
  progress: number;
  ready: boolean;
}

const TASK_LABELS: Record<ModelTask, string> = {
  llm: 'ADVISOR',
  speechToText: 'VOICE',
  textEmbeddings: 'SEARCH',
};

function snapshotToViews(states: Record<ModelTask, { progress: number; ready: boolean }>): TaskView[] {
  return (Object.keys(TASK_LABELS) as ModelTask[]).map((task) => ({
    task,
    label: TASK_LABELS[task],
    progress: states[task]?.progress ?? 0,
    ready: states[task]?.ready ?? false,
  }));
}

export function ModelStatus() {
  const [views, setViews] = useState<TaskView[]>(() => snapshotToViews(getModelDownloadStates()));

  useEffect(
    () =>
      subscribeModelDownloads((states) => {
        setViews(snapshotToViews(states));
      }),
    [],
  );

  const allReady = views.every((view) => view.ready);
  if (allReady) return null;

  return (
    <View style={styles.bar}>
      {views.map((view) => (
        <View key={view.task} style={styles.cell}>
          <Text style={styles.label}>{view.label}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(view.progress * 100)}%` }]} />
          </View>
          <Text style={styles.value}>
            {view.ready ? 'READY' : `${Math.round(view.progress * 100)}%`}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.chrome,
    backgroundColor: colors.panelBg,
  },
  cell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...monoNumeric,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
    width: 52,
  },
  track: {
    flex: 1,
    height: 3,
    backgroundColor: colors.panelSurface,
  },
  fill: {
    height: 3,
    backgroundColor: colors.chrome,
  },
  value: {
    ...monoNumeric,
    fontSize: 10,
    color: colors.textMuted,
    width: 34,
    textAlign: 'right',
    fontFamily: fonts.mono,
  },
});
