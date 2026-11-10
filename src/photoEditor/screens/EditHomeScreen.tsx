import React, { useCallback } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card } from '../../components';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { editSession, useEditorStore } from '../services/editSession';
import { PHOTO_EDITOR_ROUTE, PHOTO_EDITOR_TIMING_ROUTE } from '../routes';
import { EditModelsCard } from '../components/EditModelsCard';

/** The Edit tab: open a photo, continue the current edit, or look at timings. */
export const EditHomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const styles = useThemedStyles(createStyles);
  const session = useEditorStore(s => s.session);
  const busy = useEditorStore(s => s.busy);

  const openNew = useCallback(async () => {
    try {
      if (await editSession.pickAndOpen()) navigation.navigate(PHOTO_EDITOR_ROUTE);
    } catch (e: any) {
      Alert.alert('Could not open the photo', e?.message ?? String(e));
    }
  }, [navigation]);

  const confirmOpenNew = useCallback(() => {
    if (!session) { openNew(); return; }
    Alert.alert('Open another photo?', 'The current mask is discarded. Copies you already saved stay in your gallery.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open', onPress: openNew },
    ]);
  }, [session, openNew]);

  const discard = useCallback(() => {
    Alert.alert('Discard this edit?', 'Copies you already saved stay in your gallery.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { editSession.close(); } },
    ]);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="edit-home-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Edit</Text>
        <Text style={styles.description}>
          Edit your photos on this phone. The photo is copied into the app, the original is never changed, and
          nothing is uploaded.
        </Text>
        <Button title={busy === 'opening' ? 'Opening' : 'Open photo'} onPress={confirmOpenNew}
          loading={busy === 'opening'} disabled={busy != null} testID="edit-open-photo" />

        {session && (
          <Card style={styles.card}>
            <Text style={styles.subtitle}>Current edit</Text>
            <Text style={styles.body} numberOfLines={1}>{session.photo.displayName}</Text>
            <Text style={styles.meta}>
              {session.photo.width} x {session.photo.height}, {session.history.length} edits, {session.mask.strokes.length} mask strokes
            </Text>
            <View style={styles.row}>
              <Button title="Continue" onPress={() => navigation.navigate(PHOTO_EDITOR_ROUTE)} size="small"
                testID="edit-continue" />
              <Button title="Discard" variant="ghost" onPress={discard} size="small" testID="edit-discard" />
            </View>
          </Card>
        )}

        <EditModelsCard />

        <Button title="Edit timing log" variant="outline" size="small"
          onPress={() => navigation.navigate(PHOTO_EDITOR_TIMING_ROUTE)} testID="edit-timing-log" />
        <Text style={styles.meta}>
          You can also share a photo from your gallery and pick "Edit with Off Grid".
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: SPACING.lg, gap: SPACING.md },
  title: { ...TYPOGRAPHY.h1, color: colors.text },
  subtitle: { ...TYPOGRAPHY.h3, color: colors.textSecondary },
  description: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  body: { ...TYPOGRAPHY.body, color: colors.text },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  card: { gap: SPACING.xs },
  row: { flexDirection: 'row' as const, gap: SPACING.sm, marginTop: SPACING.sm },
});
