/**
 * EventLog — flight-recorder printout of pipeline transitions. Monospace rows,
 * fixed-width timestamp column, newest first.
 */
import { colors, colorForIntegrityState, fonts, hairline, monoNumeric, spacing } from '@/theme';
import type { EventLogEntry } from '@/hooks/useAnchorPipeline';
import { useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

function formatClock(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function EventRow({ entry }: { entry: EventLogEntry }) {
  const stateColor = colorForIntegrityState(entry.state);
  return (
    <View style={styles.row}>
      <Text style={styles.timestamp}>{formatClock(entry.timestamp)}</Text>
      <Text style={[styles.state, { color: stateColor }]}>{entry.state}</Text>
      <View style={styles.texts}>
        <Text style={styles.reason} numberOfLines={1}>
          {entry.reason}
        </Text>
        {entry.explanation ? (
          <Text style={styles.explanation} numberOfLines={2}>
            {entry.explanation}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function EventLog({ events }: { events: EventLogEntry[] }) {
  const renderItem = useCallback(
    ({ item }: { item: EventLogEntry }) => <EventRow entry={item} />,
    [],
  );

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.headerText}>EVENT LOG</Text>
        <Text style={styles.headerCount}>{events.length.toString().padStart(3, '0')}</Text>
      </View>
      <FlatList
        data={events}
        keyExtractor={(e) => e.id.toString()}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        initialNumToRender={12}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 120,
    borderTopWidth: hairline,
    borderTopColor: colors.chrome,
    backgroundColor: colors.panelBg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: hairline,
    borderBottomColor: colors.chrome,
    backgroundColor: colors.panelSurface,
  },
  headerText: {
    ...monoNumeric,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.textMuted,
  },
  headerCount: {
    ...monoNumeric,
    fontSize: 10,
    color: colors.textMuted,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: 3,
    borderBottomWidth: hairline,
    borderBottomColor: colors.panelSurface,
  },
  timestamp: {
    ...monoNumeric,
    fontSize: 11,
    color: colors.textMuted,
    width: 62,
  },
  state: {
    ...monoNumeric,
    fontSize: 11,
    width: 84,
  },
  texts: {
    flex: 1,
  },
  reason: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textPrimary,
  },
  explanation: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
    marginTop: 1,
  },
});
