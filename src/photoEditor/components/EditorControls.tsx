import React from 'react';
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import Icon from 'react-native-vector-icons/Feather';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import type { CanvasTool } from '../services/editSession';

/** The six AI tools from the plan. Each arrives in its own phase. */
const AI_TOOLS = [
  { key: 'remove', label: 'Remove', icon: 'slash', phase: 2 },
  { key: 'fill', label: 'Fill', icon: 'edit', phase: 3 },
  { key: 'upscale', label: 'Upscale', icon: 'maximize', phase: 4 },
  { key: 'background', label: 'Background', icon: 'layers', phase: 5 },
  { key: 'restyle', label: 'Restyle', icon: 'aperture', phase: 6 },
  { key: 'retouch', label: 'Retouch', icon: 'user', phase: 7 },
] as const;

const BRUSH_MIN = 8;
const BRUSH_MAX = 160;

interface EditorControlsProps {
  layout: 'side' | 'bottom';
  tool: CanvasTool;
  brushSize: number;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  keepMetadata: boolean;
  hasLocation: boolean;
  busy: string | null;
  onTool: (t: CanvasTool) => void;
  onBrushSize: (n: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onCompare: (showing: boolean) => void;
  onKeepMetadata: (v: boolean) => void;
  onSave: () => void;
  onShare: () => void;
}

const IconButton: React.FC<{
  label: string; icon: React.ReactNode; onPress?: () => void; active?: boolean; disabled?: boolean;
  onPressIn?: () => void; onPressOut?: () => void; testID?: string;
}> = ({ label, icon, onPress, active, disabled, onPressIn, onPressOut, testID }) => {
  const styles = useThemedStyles(createStyles);
  return (
    <TouchableOpacity
      style={[styles.iconButton, active && styles.iconButtonActive, disabled && styles.disabled]}
      onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled}
      accessibilityLabel={label} accessibilityState={{ selected: !!active, disabled: !!disabled }} testID={testID}
    >
      {icon}
      <Text style={[styles.iconLabel, active && styles.iconLabelActive]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
};

export const EditorControls: React.FC<EditorControlsProps> = p => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const side = p.layout === 'side';
  const tint = (on?: boolean) => (on ? colors.primary : colors.text);
  const working = p.busy != null;

  const maskTools = (
    <View style={styles.row}>
      <IconButton label="Brush" active={p.tool === 'brush'} onPress={() => p.onTool('brush')} testID="tool-brush"
        icon={<MaterialIcon name="brush" size={20} color={tint(p.tool === 'brush')} />} />
      <IconButton label="Erase" active={p.tool === 'erase'} onPress={() => p.onTool('erase')} testID="tool-erase"
        icon={<MaterialIcon name="auto-fix-off" size={20} color={tint(p.tool === 'erase')} />} />
      <IconButton label="Move" active={p.tool === 'move'} onPress={() => p.onTool('move')} testID="tool-move"
        icon={<Icon name="move" size={20} color={tint(p.tool === 'move')} />} />
      <IconButton label="Undo" disabled={!p.canUndo} onPress={p.onUndo} testID="mask-undo"
        icon={<Icon name="corner-up-left" size={20} color={colors.text} />} />
      <IconButton label="Redo" disabled={!p.canRedo} onPress={p.onRedo} testID="mask-redo"
        icon={<Icon name="corner-up-right" size={20} color={colors.text} />} />
      <IconButton label="Clear" disabled={!p.canClear} onPress={p.onClear} testID="mask-clear"
        icon={<Icon name="trash-2" size={20} color={colors.text} />} />
    </View>
  );

  const brush = (
    <View style={styles.sliderRow}>
      <Text style={styles.meta}>Size</Text>
      <Slider
        style={styles.slider} minimumValue={BRUSH_MIN} maximumValue={BRUSH_MAX} step={1}
        value={p.brushSize} onSlidingComplete={p.onBrushSize}
        minimumTrackTintColor={colors.primary} maximumTrackTintColor={colors.border} thumbTintColor={colors.primary}
        testID="brush-size"
      />
      <Text style={styles.meta}>{Math.round(p.brushSize)}</Text>
    </View>
  );

  const aiTools = (
    <View style={styles.row}>
      {AI_TOOLS.map(t => (
        <IconButton key={t.key} label={t.label} testID={`ai-tool-${t.key}`}
          icon={<Icon name={t.icon} size={20} color={colors.textMuted} />}
          onPress={() => Alert.alert(t.label, `${t.label} arrives in phase ${t.phase}. For now you can draw and save the mask area.`)} />
      ))}
    </View>
  );

  const output = (
    <>
      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <Text style={styles.body}>Keep date and location</Text>
          <Text style={styles.meta}>
            {p.hasLocation ? 'This photo has a location.' : 'No location found in this photo.'}
          </Text>
        </View>
        <Switch value={p.keepMetadata} onValueChange={p.onKeepMetadata} testID="keep-metadata"
          trackColor={{ false: colors.surfaceLight, true: colors.primary }} thumbColor={colors.surface} />
      </View>
      <View style={styles.row}>
        <IconButton label="Hold: before" onPressIn={() => p.onCompare(true)} onPressOut={() => p.onCompare(false)}
          testID="compare-hold" icon={<Icon name="eye" size={20} color={colors.text} />} />
        <IconButton label={p.busy === 'saving' ? 'Saving' : 'Save copy'} disabled={working} onPress={p.onSave}
          testID="save-copy" icon={<Icon name="download" size={20} color={colors.primary} />} />
        <IconButton label="Share" disabled={working} onPress={p.onShare} testID="share-copy"
          icon={<Icon name="share-2" size={20} color={colors.text} />} />
      </View>
    </>
  );

  if (side) {
    return (
      <ScrollView style={styles.side} contentContainerStyle={styles.sideContent} testID="editor-side-panel">
        <Text style={styles.section}>MASK</Text>
        {maskTools}
        {brush}
        <Text style={styles.section}>TOOLS</Text>
        {aiTools}
        <Text style={styles.section}>OUTPUT</Text>
        {output}
      </ScrollView>
    );
  }
  return (
    <View style={styles.bottom} testID="editor-bottom-bar">
      {maskTools}
      {brush}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>{aiTools}</ScrollView>
      {output}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  flex: { flex: 1 },
  side: { width: 320, borderLeftWidth: 1, borderLeftColor: colors.border, backgroundColor: colors.surface },
  sideContent: { padding: SPACING.md, gap: SPACING.sm },
  bottom: {
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
    paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, gap: SPACING.xs,
  },
  section: { ...TYPOGRAPHY.label, color: colors.textMuted, marginTop: SPACING.sm },
  row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.xs },
  iconButton: {
    minWidth: 48, paddingVertical: SPACING.xs, paddingHorizontal: SPACING.xs,
    alignItems: 'center' as const, borderRadius: 8, borderWidth: 1, borderColor: 'transparent',
  },
  iconButtonActive: { borderColor: colors.primary },
  iconLabel: { ...TYPOGRAPHY.labelSmall, color: colors.textSecondary, marginTop: 2 },
  iconLabelActive: { color: colors.primary },
  disabled: { opacity: 0.35 },
  sliderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  slider: { flex: 1, height: 32 },
  switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  body: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
});
