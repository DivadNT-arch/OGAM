import React, { useCallback, useState } from 'react';
import { Alert, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { MaskCanvas } from '../components/MaskCanvas';
import { EditorControls } from '../components/EditorControls';
import { editSession, useEditorStore } from '../services/editSession';

/** Inner (unfolded) screen and tablets get the side panel; the cover screen gets a bottom bar. */
const WIDE_LAYOUT_MIN_WIDTH = 600;

export const PhotoEditorScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const session = useEditorStore(s => s.session);
  const tool = useEditorStore(s => s.tool);
  const brushSize = useEditorStore(s => s.brushSize);
  const keepMetadata = useEditorStore(s => s.keepMetadata);
  const busy = useEditorStore(s => s.busy);
  const [comparing, setComparing] = useState(false);

  const save = useCallback(async () => {
    try {
      const saved = await editSession.saveAsNew();
      Alert.alert('Saved', `${saved.displayName}\nin ${saved.album}. The original photo was not changed.`);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? String(e));
    }
  }, []);

  const share = useCallback(async () => {
    try { await editSession.share(); } catch (e: any) { Alert.alert('Could not share', e?.message ?? String(e)); }
  }, []);

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.empty}>
          <Text style={styles.body}>No photo is open.</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.link}>Back</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const { photo, mask } = session;
  const wide = width >= WIDE_LAYOUT_MIN_WIDTH;
  // Phase 1 has no edits yet, so "before" shows the same picture; the mask is hidden.
  const imageUri = comparing ? photo.previewPath : session.resultPreviewPath;

  const controls = (
    <EditorControls
      layout={wide ? 'side' : 'bottom'}
      tool={tool} brushSize={brushSize}
      canUndo={mask.undo.length > 0} canRedo={mask.redo.length > 0} canClear={mask.strokes.length > 0}
      keepMetadata={keepMetadata} hasLocation={photo.hasLocation} busy={busy}
      onTool={editSession.setTool} onBrushSize={editSession.setBrushSize}
      onUndo={editSession.undo} onRedo={editSession.redo} onClear={editSession.clearMask}
      onCompare={setComparing} onKeepMetadata={editSession.setKeepMetadata}
      onSave={save} onShare={share}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="photo-editor-screen">
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} accessibilityLabel="Back">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>{photo.displayName}</Text>
          <Text style={styles.meta}>
            {photo.width} x {photo.height} ({((photo.width * photo.height) / 1e6).toFixed(1)} MP)
            {comparing ? '  BEFORE' : ''}
          </Text>
        </View>
      </View>
      <View style={wide ? styles.rowBody : styles.columnBody}>
        <View style={styles.flex}>
          <MaskCanvas
            imageUri={imageUri}
            imageSize={{ width: photo.width, height: photo.height }}
            strokes={mask.strokes} tool={tool} brushSize={brushSize}
            hideMask={comparing} onStroke={editSession.addStroke}
          />
        </View>
        {controls}
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { padding: SPACING.xs, marginRight: SPACING.sm },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  body: { ...TYPOGRAPHY.body, color: colors.text },
  link: { ...TYPOGRAPHY.body, color: colors.primary, marginTop: SPACING.md },
  rowBody: { flex: 1, flexDirection: 'row' as const },
  columnBody: { flex: 1, flexDirection: 'column' as const },
  empty: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
});
