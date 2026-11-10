import React, { useEffect } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card } from '../../components';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { editModels, useEditModels } from '../services/editModels';

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** Lists the editing models with size, licence, download progress, and delete. */
export const EditModelsCard: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { models, downloading, error } = useEditModels();
  useEffect(() => { editModels.refresh().catch(() => undefined); }, []);
  const used = models.filter(m => m.installed).reduce((n, m) => n + m.sizeBytes, 0);

  return (
    <Card style={styles.card} testID="edit-models-card">
      <Text style={styles.subtitle}>Editing models</Text>
      <Text style={styles.meta}>Downloaded once, then used offline. {mb(used)} in use.</Text>
      {models.map(m => {
        const progress = downloading[m.id];
        const status = progress !== undefined ? `Downloading ${Math.round(progress * 100)}%`
          : m.installed ? 'Downloaded' : m.partialBytes > 0 ? `Paused at ${mb(m.partialBytes)}` : 'Not downloaded';
        return (
          <View key={m.id} style={styles.model}>
            <Text style={styles.body}>{m.name}</Text>
            <Text style={styles.meta}>{mb(m.sizeBytes)}, {m.license}. {status}</Text>
            <View style={styles.row}>
              {progress !== undefined ? (
                <Button title="Cancel" size="small" variant="ghost" onPress={() => editModels.cancelDownload(m.id)}
                  testID={`model-cancel-${m.id}`} />
              ) : m.installed ? (
                <Button title="Delete" size="small" variant="ghost" testID={`model-delete-${m.id}`}
                  onPress={() => Alert.alert(`Delete ${m.name}?`, `Frees ${mb(m.sizeBytes)}. You can download it again later.`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => { editModels.remove(m.id); } },
                  ])} />
              ) : (
                <Button title={m.partialBytes > 0 ? 'Resume download' : `Download ${mb(m.sizeBytes)}`} size="small"
                  onPress={() => { editModels.download(m.id); }} testID={`model-download-${m.id}`} />
              )}
            </View>
          </View>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
};

const createStyles = (colors: ThemeColors) => ({
  card: { gap: SPACING.xs },
  subtitle: { ...TYPOGRAPHY.h3, color: colors.textSecondary },
  body: { ...TYPOGRAPHY.body, color: colors.text },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  error: { ...TYPOGRAPHY.meta, color: colors.error },
  model: { marginTop: SPACING.sm, gap: 2 },
  row: { flexDirection: 'row' as const, marginTop: SPACING.xs },
});
