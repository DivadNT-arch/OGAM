import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { photoEditorNative, type ImportedPhoto, type RegionEditResult, type SavedPhoto } from '../native/photoEditorNative';
import { addStroke, clearMask, EMPTY_MASK, redo, undo, type MaskState, type MaskStroke } from '../maskHistory';
import { recordTiming, timed } from './timingLog';
import { activeModelService } from '../../services/activeModelService';

export type CanvasTool = 'brush' | 'erase' | 'move';

/** One applied edit. Its files hold the photo as it was after this edit. */
export interface EditStep {
  id: string;
  tool: 'remove';
  resultPath: string;
  previewPath: string;
  at: string;
}

export interface EditSession {
  photo: ImportedPhoto;
  /** Full-resolution file holding the current result (the original copy until the first edit). */
  resultPath: string;
  /** Downscaled preview of the current result. */
  resultPreviewPath: string;
  mask: MaskState;
  /** Applied edits, oldest first. The last one is the current result. */
  history: EditStep[];
  /** Edits taken back with Undo edit, newest last. */
  redoSteps: EditStep[];
  lastSaved?: SavedPhoto;
  openedAt: string;
}

interface EditorState {
  session: EditSession | null;
  tool: CanvasTool;
  /** Brush diameter in screen points; stays the same size on screen at any zoom. */
  brushSize: number;
  keepMetadata: boolean;
  busy: 'opening' | 'saving' | 'sharing' | 'removing' | null;
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
      // Sessions saved before edit history existed (phase 1 builds) get empty history.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<EditorState>;
        const session = p.session
          ? { ...p.session, history: p.session.history ?? [], redoSteps: p.session.redoSteps ?? [] }
          : null;
        return { ...current, ...p, session, busy: null };
      },
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
          mask: EMPTY_MASK, history: [], redoSteps: [], openedAt: new Date().toISOString(),
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

  /**
   * Remove: fills the painted area with LaMa and makes the result the new current photo.
   * Resolves false if the user cancelled.
   */
  async remove(): Promise<boolean> {
    const session = get().session;
    if (!session) throw new Error('No photo is open.');
    const params = {
      sessionId: session.photo.sessionId,
      sourcePath: session.resultPath,
      originalPath: session.photo.originalPath,
      strokes: session.mask.strokes.map(({ mode, size, points }) => ({ mode, size, points })),
      outName: `result_${Date.now()}`,
    };
    set({ busy: 'removing' });
    const started = Date.now();
    try {
      let result: RegionEditResult;
      try {
        result = await photoEditorNative().applyRemove(params);
      } catch (e: any) {
        if (e?.code !== 'LOW_MEMORY') throw e;
        // Free the chat and image models (they reload on next use), then try once more.
        await activeModelService.unloadAllModels(true).catch(() => undefined);
        result = await photoEditorNative().applyRemove(params);
      }
      recordTiming({
        operation: 'Remove',
        durationMs: Date.now() - started,
        detail: [
          `crop ${result.cropWidth}x${result.cropHeight}`,
          `LaMa ${result.modelSize} ${result.modelMs} ms`,
          result.loadMs ? `model load ${result.loadMs} ms` : null,
          `decode ${result.decodeMs} ms`, `blend ${result.blendMs} ms`, `encode ${result.encodeMs} ms`,
        ].filter(Boolean).join(', '),
      });
      editSession.pushStep({ tool: 'remove', resultPath: result.resultPath, previewPath: result.previewPath });
      return true;
    } catch (e: any) {
      const cancelled = e?.code === 'EDIT_CANCELLED';
      recordTiming({ operation: 'Remove', durationMs: Date.now() - started, detail: cancelled ? 'cancelled' : e?.message, failed: !cancelled });
      if (cancelled) return false;
      throw e;
    } finally {
      set({ busy: null });
    }
  },

  async cancelEdit(): Promise<void> {
    await photoEditorNative().cancelEdit();
  },

  /** Makes a finished edit the current result, clears the mask and drops any redo steps. */
  pushStep(step: Omit<EditStep, 'id' | 'at'>): void {
    const session = get().session;
    if (!session) return;
    const dropped = session.redoSteps.flatMap(s => [s.resultPath, s.previewPath]);
    if (dropped.length) photoEditorNative().deleteSessionFiles(dropped).catch(() => 0);
    const full: EditStep = { ...step, id: `${Date.now()}`, at: new Date().toISOString() };
    set({
      session: {
        ...session, history: [...session.history, full], redoSteps: [],
        resultPath: full.resultPath, resultPreviewPath: full.previewPath, mask: EMPTY_MASK, lastSaved: undefined,
      },
    });
  },

  /** Takes back the last applied edit (the mask is not restored). */
  undoEdit(): void {
    const session = get().session;
    const last = session?.history[session.history.length - 1];
    if (!session || !last) return;
    const history = session.history.slice(0, -1);
    const prev = history[history.length - 1];
    set({
      session: {
        ...session, history, redoSteps: [...session.redoSteps, last], lastSaved: undefined,
        resultPath: prev?.resultPath ?? session.photo.originalPath,
        resultPreviewPath: prev?.previewPath ?? session.photo.previewPath,
      },
    });
  },

  redoEdit(): void {
    const session = get().session;
    const next = session?.redoSteps[session.redoSteps.length - 1];
    if (!session || !next) return;
    set({
      session: {
        ...session, history: [...session.history, next], redoSteps: session.redoSteps.slice(0, -1),
        resultPath: next.resultPath, resultPreviewPath: next.previewPath, lastSaved: undefined,
      },
    });
  },

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
