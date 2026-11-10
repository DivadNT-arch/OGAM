import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { photoEditorNative, type ImportedPhoto, type SavedPhoto } from '../native/photoEditorNative';
import { addStroke, clearMask, EMPTY_MASK, redo, undo, type MaskState, type MaskStroke } from '../maskHistory';
import { timed } from './timingLog';

export type CanvasTool = 'brush' | 'erase' | 'move';

export interface EditSession {
  photo: ImportedPhoto;
  /** Full-resolution file holding the current result. Phase 1: the untouched original copy. */
  resultPath: string;
  /** Downscaled preview of the current result. */
  resultPreviewPath: string;
  mask: MaskState;
  lastSaved?: SavedPhoto;
  openedAt: string;
}

interface EditorState {
  session: EditSession | null;
  tool: CanvasTool;
  /** Brush diameter in screen points; stays the same size on screen at any zoom. */
  brushSize: number;
  keepMetadata: boolean;
  busy: 'opening' | 'saving' | 'sharing' | null;
}

/**
 * Projection of the edit session. Kept in AsyncStorage so folding, unfolding, rotating or
 * the system closing the app in the background never loses the photo, mask or history.
 * Components read it; every change goes through `editSession` below.
 */
export const useEditorStore = create<EditorState>()(
  persist(
    (): EditorState => ({ session: null, tool: 'brush', brushSize: 40, keepMetadata: true, busy: null }),
    {
      name: 'photo-editor-session',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({ session: s.session, tool: s.tool, brushSize: s.brushSize, keepMetadata: s.keepMetadata }),
    },
  ),
);

const set = useEditorStore.setState;
const get = useEditorStore.getState;

function updateMask(change: (m: MaskState) => MaskState): void {
  const session = get().session;
  if (!session) return;
  set({ session: { ...session, mask: change(session.mask) } });
}

async function requestLocationAccess(): Promise<void> {
  // Without this, Android hands apps photos with the GPS position removed.
  if (Platform.OS !== 'android' || (Platform.Version as number) < 29) return;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION);
  } catch { /* editing still works; the saved copy just has no location */ }
}

async function discardFiles(session: EditSession | null): Promise<void> {
  if (session) await photoEditorNative().deleteSession(session.photo.sessionId).catch(() => false);
}

export const editSession = {
  /** Lets the user pick a photo. Resolves false if they cancelled. */
  async pickAndOpen(): Promise<boolean> {
    await requestLocationAccess();
    const source = await photoEditorNative().pickPhoto();
    if (!source) return false;
    await editSession.open(source);
    return true;
  },

  /** Copies the photo (content URI or file path) into a new session, replacing any current one. */
  async open(source: string): Promise<void> {
    set({ busy: 'opening' });
    try {
      const photo = await timed('Open photo', () => photoEditorNative().importPhoto(source),
        p => `${p.width}x${p.height}, ${(p.fileSizeBytes / 1e6).toFixed(1)} MB${p.hasLocation ? ', has location' : ''}`);
      await discardFiles(get().session);
      set({
        session: {
          photo, resultPath: photo.originalPath, resultPreviewPath: photo.previewPath,
          mask: EMPTY_MASK, openedAt: new Date().toISOString(),
        },
      });
    } finally {
      set({ busy: null });
    }
  },

  /** Opens a photo that arrived through "Edit with Off Grid", if one is waiting. */
  async openPendingShare(): Promise<boolean> {
    const path = await photoEditorNative().takePendingShare();
    if (!path) return false;
    await editSession.open(path);
    return true;
  },

  async close(): Promise<void> {
    const session = get().session;
    set({ session: null });
    await discardFiles(session);
  },

  addStroke(stroke: MaskStroke): void { updateMask(m => addStroke(m, stroke)); },
  undo(): void { updateMask(undo); },
  redo(): void { updateMask(redo); },
  clearMask(): void { updateMask(clearMask); },
  setTool(tool: CanvasTool): void { set({ tool }); },
  setBrushSize(brushSize: number): void { set({ brushSize }); },
  setKeepMetadata(keepMetadata: boolean): void { set({ keepMetadata }); },

  /** Saves the current result as a new photo. The original is never written to. */
  async saveAsNew(): Promise<SavedPhoto> {
    const session = get().session;
    if (!session) throw new Error('No photo is open.');
    set({ busy: 'saving' });
    try {
      const saved = await timed('Save as new', () => photoEditorNative().saveAsNew({
        resultPath: session.resultPath,
        originalPath: session.photo.originalPath,
        keepMetadata: get().keepMetadata,
        baseName: session.photo.displayName,
      }), s => s.displayName);
      const current = get().session;
      if (current) set({ session: { ...current, lastSaved: saved } });
      return saved;
    } finally {
      set({ busy: null });
    }
  },

  /** Saves a copy (if not saved since the last change) and opens the share sheet for it. */
  async share(): Promise<void> {
    const session = get().session;
    if (!session) return;
    const saved = session.lastSaved ?? await editSession.saveAsNew();
    set({ busy: 'sharing' });
    try {
      await photoEditorNative().sharePhoto(saved.uri);
    } finally {
      set({ busy: null });
    }
  },
};
