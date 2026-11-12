import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import type { EditProgress } from '../native/photoEditorNative';
import { editSession } from '../services/editSession';

const TITLES: Record<string, string> = {
  removing: 'Removing', preparing: 'Loading the image model', filling: 'Filling', upscaling: 'Upscaling',
};
const HINTS: Record<string, string> = {
  removing: 'Runs on this phone. Small areas take seconds, large ones up to a minute.',
  preparing: 'Runs on this phone. A fill takes a few minutes.',
  filling: 'Runs on this phone. A fill takes a few minutes.',
  upscaling: 'Runs on this phone. Large photos take a few minutes.',
};

function stepText(busy: string, p: EditProgress): string {
  if (busy === 'upscaling') return `tile ${p.step} of ${p.totalSteps}`;
  const version = p.variations > 1 ? `Version ${p.variation} of ${p.variations}, ` : '';
  return `${version}step ${p.step} of ${p.totalSteps}`;
}

/** Covers the canvas while an edit runs: what is happening, live progress, and Cancel. */
export const EditProgressOverlay: React.FC<{ busy: string | null; progress: EditProgress | null }> = ({ busy, progress }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (!busy || !TITLES[busy]) return null;
  return (
    <View style={styles.overlay} testID="edit-progress">
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.body}>{TITLES[busy]}</Text>
      <Text style={styles.meta} testID={progress ? 'edit-progress-steps' : undefined}>
        {progress && busy !== 'preparing' ? stepText(busy, progress) : HINTS[busy]}
      </Text>
      <Button title="Cancel" variant="outline" size="small" onPress={() => { editSession.cancelEdit(); }} testID="edit-cancel" />
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  overlay: {
    position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: SPACING.sm, backgroundColor: colors.overlay,
  },
  body: { ...TYPOGRAPHY.body, color: colors.text },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
});
