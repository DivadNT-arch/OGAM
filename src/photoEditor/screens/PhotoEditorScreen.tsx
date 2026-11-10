import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { MaskCanvas } from '../components/MaskCanvas';
import { EditorControls } from '../components/EditorControls';
import { editSession, useEditorStore } from '../services/editSession';
import { editModels, useEditModels } from '../services/editModels';
import { Button } from '../../components';

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
  const downloading = useEditModels(s => s.downloading.lama ?? s.downloading.lama1024);
  useEffect(() => { editModels.refresh().catch(() => undefined); }, []);

  const remove = useCallback(async () => {
    const current = useEditorStore.getState().session;
    if (!current?.mask.strokes.some(st => st.mode === 'brush')) {
      Alert.alert('Remove', 'Paint over what you want to remove first, then tap Remove.');
      return;
    }
    if (!editModels.isInstalled('lama') && !editModels.isInstalled('lama1024')) {
      Alert.alert('Download the Remove models?',
        'Remove runs LaMa on this phone. The 512 model (208 MB) is fast for small areas; the 1024 model (208 MB) keeps '
        + 'large areas sharper. They download once and then work offline.', [
          { text: 'Not now', style: 'cancel' },
          { text: '512 only', onPress: () => { editModels.download('lama'); } },
          { text: 'Both', onPress: () => { editModels.download('lama').then(() => editModels.download('lama1024')); } },
        ]);
      return;
    }
    try {
      await editSession.remove();
    } catch (e: any) {
      Alert.alert('Remove failed', e?.message ?? String(e));
    }
  }, []);

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
  // Press-and-hold shows the original photo, without the mask.
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
      onSave={save} onShare={share} onRemove={remove}
      canUndoEdit={session.history.length > 0} canRedoEdit={session.redoSteps.length > 0}
      editCount={session.history.length} onUndoEdit={editSession.undoEdit} onRedoEdit={editSession.redoEdit}
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
          {busy === 'removing' && (
            <View style={styles.overlay} testID="edit-progress">
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.body}>Removing</Text>
              <Text style={styles.meta}>Runs on this phone. Small areas take seconds, large ones up to a minute.</Text>
              <Button title="Cancel" variant="outline" size="small" onPress={() => { editSession.cancelEdit(); }}
                testID="edit-cancel" />
            </View>
          )}
          {downloading !== undefined && (
            <View style={styles.banner}>
              <Text style={styles.meta}>Downloading the Remove model: {Math.round(downloading * 100)}%</Text>
            </View>
          )}
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
  overlay: {
    position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: SPACING.sm, backgroundColor: colors.overlay,
  },
  banner: {
    position: 'absolute' as const, left: SPACING.md, right: SPACING.md, top: SPACING.md, padding: SPACING.sm,
    borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  empty: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
});
