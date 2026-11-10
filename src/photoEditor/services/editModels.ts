import { create } from 'zustand';
import { onModelProgress, photoEditorNative, type EditModelInfo } from '../native/photoEditorNative';
import { timed } from './timingLog';

interface EditModelsState {
  models: EditModelInfo[];
  /** Download progress 0..1 per model id while downloading. */
  downloading: Record<string, number>;
  error: string | null;
}

/** Projection of the editing models on disk. Change it through `editModels` below. */
export const useEditModels = create<EditModelsState>()(() => ({ models: [], downloading: {}, error: null }));

const set = useEditModels.setState;

function replace(info: EditModelInfo): void {
  set(s => ({ models: s.models.map(m => (m.id === info.id ? info : m)) }));
}

let progressSubscribed = false;
function subscribeProgress(): void {
  if (progressSubscribed) return;
  progressSubscribed = true;
  onModelProgress(p => {
    if (p.bytesTotal <= 0) return;
    set(s => (s.downloading[p.id] === undefined ? s : { downloading: { ...s.downloading, [p.id]: p.bytesDone / p.bytesTotal } }));
  });
}

export const editModels = {
  async refresh(): Promise<void> {
    subscribeProgress();
    set({ models: await photoEditorNative().getEditModels() });
  },

  async download(id: string): Promise<void> {
    subscribeProgress();
    set(s => ({ downloading: { ...s.downloading, [id]: 0 }, error: null }));
    try {
      const info = await timed(`Download model ${id}`, () => photoEditorNative().downloadEditModel(id));
      replace(info);
    } catch (e: any) {
      if (e?.code !== 'DOWNLOAD_CANCELLED') set({ error: e?.message ?? String(e) });
      await editModels.refresh();
    } finally {
      set(s => {
        const { [id]: _done, ...rest } = s.downloading;
        return { downloading: rest };
      });
    }
  },

  async cancelDownload(id: string): Promise<void> {
    await photoEditorNative().cancelModelDownload(id);
  },

  async remove(id: string): Promise<void> {
    replace(await photoEditorNative().deleteEditModel(id));
  },

  isInstalled(id: string): boolean {
    return useEditModels.getState().models.some(m => m.id === id && m.installed);
  },
};
