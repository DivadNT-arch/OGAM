import React, { useState } from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Button } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';

export interface FillOptions { prompt: string; negativePrompt: string; strength: number; variations: number; steps: number }

/** Speed presets: Stable Diffusion steps. Fewer steps are faster but less detailed. */
const SPEEDS = [
  { label: 'Quick', steps: 8 },
  { label: 'Balanced', steps: 12 },
  { label: 'Best', steps: 20 },
];

interface FillSheetProps {
  visible: boolean;
  /** Measured milliseconds per step on this phone, for the time estimate. */
  msPerStep: number;
  onClose: () => void;
  onRun: (opts: FillOptions) => void;
}

const DEFAULT_NEGATIVE = 'blurry, low quality, distorted, text, watermark';

/** Fill settings: what to put in the painted area, how strongly, and how many versions. */
export const FillSheet: React.FC<FillSheetProps> = ({ visible, msPerStep, onClose, onRun }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE);
  const [strength, setStrength] = useState(0.9);
  const [variations, setVariations] = useState(1);
  const [steps, setSteps] = useState(12);
  // Img2img runs only the strength share of the steps, plus about 15 s to prepare each version.
  const seconds = variations * (Math.ceil(steps * strength) * msPerStep / 1000 + 15);
  const estimate = seconds < 90 ? `about ${Math.round(seconds)} seconds` : `about ${Math.round(seconds / 60)} minutes`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="fill-sheet">
          <Text style={styles.title}>Fill</Text>
          <Text style={styles.meta}>Describe what should be in the painted area. Runs on this phone.</Text>
          <Text style={styles.meta}>
            Tips: describe the thing and the style of the photo (e.g. "framed print of Starry Night, flat, front view,
            photo"). For pictures, screens and windows, select with Box so the edges are straight.
          </Text>

          <Text style={styles.label}>What should be there</Text>
          <TextInput
            style={styles.input} value={prompt} onChangeText={setPrompt} multiline
            placeholder="e.g. a potted plant, wooden floor, blue sky" placeholderTextColor={colors.textMuted}
            testID="fill-prompt"
          />
          <Text style={styles.label}>Avoid</Text>
          <TextInput
            style={styles.input} value={negativePrompt} onChangeText={setNegativePrompt}
            placeholderTextColor={colors.textMuted} testID="fill-negative"
          />

          <View style={styles.row}>
            <Text style={styles.label}>Strength</Text>
            <Text style={styles.meta}>{Math.round(strength * 100)}%</Text>
          </View>
          <Slider
            minimumValue={0.3} maximumValue={1} step={0.05} value={strength} onValueChange={setStrength}
            minimumTrackTintColor={colors.primary} maximumTrackTintColor={colors.border} thumbTintColor={colors.primary}
            testID="fill-strength"
          />
          <Text style={styles.meta}>Lower keeps more of what is there now; higher replaces it completely.</Text>

          <Text style={styles.label}>Speed</Text>
          <View style={styles.row}>
            {SPEEDS.map(sp => (
              <TouchableOpacity key={sp.steps} onPress={() => setSteps(sp.steps)} testID={`fill-speed-${sp.steps}`}
                style={[styles.choice, steps === sp.steps && styles.choiceActive]}>
                <Text style={[styles.body, steps === sp.steps && styles.choiceTextActive]}>{sp.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Versions</Text>
          <View style={styles.row}>
            {[1, 3].map(n => (
              <TouchableOpacity key={n} onPress={() => setVariations(n)} testID={`fill-variations-${n}`}
                style={[styles.choice, variations === n && styles.choiceActive]}>
                <Text style={[styles.body, variations === n && styles.choiceTextActive]}>{n === 1 ? '1' : '3, pick one'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.meta} testID="fill-estimate">Takes {estimate} on this phone.</Text>

          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" onPress={onClose} testID="fill-cancel" />
            <Button title="Fill" disabled={!prompt.trim()} testID="fill-run"
              onPress={() => onRun({ prompt: prompt.trim(), negativePrompt: negativePrompt.trim(), strength, variations, steps })} />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: ThemeColors) => ({
  backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface, padding: SPACING.lg, gap: SPACING.xs,
    borderTopLeftRadius: 16, borderTopRightRadius: 16, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const,
  },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  label: { ...TYPOGRAPHY.h3, color: colors.textSecondary, marginTop: SPACING.sm },
  body: { ...TYPOGRAPHY.body, color: colors.text },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  input: {
    ...TYPOGRAPHY.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, minHeight: 40,
  },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: SPACING.sm },
  choice: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: SPACING.sm, alignItems: 'center' as const },
  choiceActive: { borderColor: colors.primary },
  choiceTextActive: { color: colors.primary },
  actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: SPACING.sm, marginTop: SPACING.md },
});
