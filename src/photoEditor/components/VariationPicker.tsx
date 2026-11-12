import React from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Button } from '../../components';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';

interface VariationPickerProps {
  previews: string[];
  onChoose: (index: number) => void;
  onDiscard: () => void;
}

/** Shows the Fill versions side by side; tapping one keeps it. */
export const VariationPicker: React.FC<VariationPickerProps> = ({ previews, onChoose, onDiscard }) => {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.overlay} testID="variation-picker">
      <Text style={styles.title}>Pick a version</Text>
      <ScrollView horizontal contentContainerStyle={styles.row}>
        {previews.map((p, i) => (
          <TouchableOpacity key={p} onPress={() => onChoose(i)} testID={`variation-${i}`} style={styles.item}>
            <Image source={{ uri: `file://${p}` }} style={styles.image} resizeMode="contain" />
            <Text style={styles.meta}>Version {i + 1}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Button title="Keep none" variant="ghost" onPress={onDiscard} testID="variation-discard" />
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  overlay: {
    position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.background,
    alignItems: 'center' as const, justifyContent: 'center' as const, gap: SPACING.md, padding: SPACING.md,
  },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  row: { gap: SPACING.md, alignItems: 'center' as const },
  item: { alignItems: 'center' as const, gap: SPACING.xs },
  image: { width: 260, height: 260, borderRadius: 8, backgroundColor: colors.surface },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
});
