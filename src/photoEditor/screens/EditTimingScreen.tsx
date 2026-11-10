import React from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useTimingLog } from '../services/timingLog';

const formatMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Local list of how long each editor operation took. Nothing leaves the phone. */
export const EditTimingScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const entries = useTimingLog(s => s.entries);
  const clear = useTimingLog(s => s.clear);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="edit-timing-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Back">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Edit timing</Text>
        <TouchableOpacity onPress={clear} disabled={entries.length === 0} testID="timing-clear">
          <Text style={[styles.action, entries.length === 0 && styles.disabled]}>Clear</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={entries}
        keyExtractor={e => e.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.meta}>No timings yet. Open or save a photo to record one.</Text>}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <View style={styles.itemRow}>
              <Text style={[styles.body, item.failed && styles.failed]}>{item.operation}{item.failed ? ' (failed)' : ''}</Text>
              <Text style={styles.body}>{formatMs(item.durationMs)}</Text>
            </View>
            {item.detail ? <Text style={styles.meta}>{item.detail}</Text> : null}
            <Text style={styles.meta}>{new Date(item.at).toLocaleString()}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const, padding: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { marginRight: SPACING.sm },
  title: { ...TYPOGRAPHY.h2, color: colors.text, flex: 1 },
  action: { ...TYPOGRAPHY.body, color: colors.primary },
  disabled: { opacity: 0.35 },
  list: { padding: SPACING.md, gap: SPACING.sm },
  item: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: SPACING.sm },
  itemRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  body: { ...TYPOGRAPHY.body, color: colors.text },
  failed: { color: colors.error },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
});
