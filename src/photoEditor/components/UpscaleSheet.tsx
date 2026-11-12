import React, { useState } from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { Button } from '../../components';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';

/** Largest result the editor makes, in megapixels (matches the native limit). */
const MAX_MP = 64;
const DETAILS = [
  { label: 'Natural', value: 0.45 },
  { label: 'Balanced', value: 0.7 },
  { label: 'Sharp', value: 1 },
];

interface UpscaleSheetProps {
  visible: boolean;
  width: number;
  height: number;
  /** Measured milliseconds per input megapixel on this phone. */
  msPerMp: number;
  onClose: () => void;
  onRun: (opts: { factor: 2 | 4; detail: number }) => void;
}

const mp = (w: number, h: number) => (w * h) / 1e6;

/** Upscale settings: 2x or 4x (each showing the result size) and how much AI detail to add. */
export const UpscaleSheet: React.FC<UpscaleSheetProps> = ({ visible, width, height, msPerMp, onClose, onRun }) => {
  const styles = useThemedStyles(createStyles);
  const fits = (f: number) => mp(width * f, height * f) <= MAX_MP;
  const [factor, setFactor] = useState<2 | 4>(fits(4) ? 4 : 2);
  const [detail, setDetail] = useState(0.7);
  const chosen = fits(factor) ? factor : 2;
  const seconds = (mp(width, height) * msPerMp) / 1000 + 5;
  const estimate = seconds < 90 ? `about ${Math.round(seconds)} seconds` : `about ${Math.round(seconds / 60)} minutes`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="upscale-sheet">
          <Text style={styles.title}>Upscale</Text>
          <Text style={styles.meta}>Now {width} x {height} ({mp(width, height).toFixed(1)} MP). Runs on this phone.</Text>

          <Text style={styles.label}>Size</Text>
          <View style={styles.row}>
            {([2, 4] as const).map(f => (
              <TouchableOpacity key={f} disabled={!fits(f)} onPress={() => setFactor(f)} testID={`upscale-${f}x`}
                style={[styles.choice, chosen === f && styles.choiceActive, !fits(f) && styles.disabled]}>
                <Text style={[styles.body, chosen === f && styles.choiceTextActive]}>{f}x</Text>
                <Text style={styles.meta}>{width * f} x {height * f}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!fits(2) ? <Text style={styles.meta}>This photo is already too large to upscale (limit {MAX_MP} MP).</Text> : null}

          <Text style={styles.label}>Detail</Text>
          <View style={styles.row}>
            {DETAILS.map(d => (
              <TouchableOpacity key={d.label} onPress={() => setDetail(d.value)} testID={`upscale-detail-${d.label}`}
                style={[styles.choice, detail === d.value && styles.choiceActive]}>
                <Text style={[styles.body, detail === d.value && styles.choiceTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.meta}>Sharp adds the most invented texture; Natural stays closer to a plain enlargement.</Text>
          <Text style={styles.meta} testID="upscale-estimate">Takes {estimate} on this phone.</Text>

          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" onPress={onClose} testID="upscale-cancel" />
            <Button title={`Upscale ${chosen}x`} disabled={!fits(2)} testID="upscale-run"
              onPress={() => onRun({ factor: chosen, detail })} />
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
  row: { flexDirection: 'row' as const, gap: SPACING.sm },
  choice: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: SPACING.sm, alignItems: 'center' as const },
  choiceActive: { borderColor: colors.primary },
  choiceTextActive: { color: colors.primary },
  disabled: { opacity: 0.35 },
  actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: SPACING.sm, marginTop: SPACING.md },
});
