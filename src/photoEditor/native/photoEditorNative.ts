import { NativeEventEmitter, NativeModules } from 'react-native';

/** A photo copied into an edit session. Sizes are upright (after EXIF rotation). */
export interface ImportedPhoto {
  sessionId: string;
  originalPath: string;
  previewPath: string;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
  mimeType: string;
  hasLocation: boolean;
  fileSizeBytes: number;
  displayName: string;
  durationMs: number;
}

export interface SavedPhoto {
  uri: string;
  displayName: string;
  album: string;
  durationMs: number;
}

interface SaveParams {
  /** File holding the pixels to save. */
  resultPath: string;
  /** The session's untouched original; its date and location are carried over. */
  originalPath: string;
  keepMetadata: boolean;
  baseName: string;
}

export interface EditModelInfo {
  id: string;
  name: string;
  license: string;
  sizeBytes: number;
  /** Model input size in pixels (512 or 1024). */
  inputSize: number;
  installed: boolean;
  /** Bytes of an interrupted download that will be resumed. */
  partialBytes: number;
}

export interface ModelProgress { id: string; bytesDone: number; bytesTotal: number }

interface NativeStroke { mode: 'brush' | 'erase'; size: number; points: number[] }

interface RegionEditParams {
  sessionId: string;
  /** Current full-resolution result (the edit builds on it). */
  sourcePath: string;
  /** The untouched original, for orientation and metadata. */
  originalPath: string;
  strokes: NativeStroke[];
  /** File name (no extension) for the new result inside the session folder. */
  outName: string;
}

export interface RegionEditResult {
  resultPath: string;
  previewPath: string;
  loadMs: number;
  /** Which model ran: 512 or 1024. */
  modelSize: number;
  decodeMs: number;
  maskMs: number;
  modelMs: number;
  blendMs: number;
  encodeMs: number;
  cropWidth: number;
  cropHeight: number;
}

interface FillParams {
  sessionId: string;
  sourcePath: string;
  originalPath: string;
  strokes: NativeStroke[];
  outName: string;
  prompt: string;
  negativePrompt: string;
  /** 0..1: how much of the painted area is regenerated. */
  strength: number;
  steps: number;
  guidance: number;
  seed: number;
  variations: number;
  /** Port of the local-dream server that Off Grid runs. */
  port: number;
}

interface FillResult {
  results: { resultPath: string; previewPath: string; seed: number }[];
  /** Model time and average seconds per step for each version (to spot throttling). */
  perVariation: { modelMs: number; msPerStep: number }[];
  modelMs: number;
  otherMs: number;
  cropWidth: number;
  cropHeight: number;
}

export interface EditProgress { step: number; totalSteps: number; variation: number; variations: number }

/** Contract for the native photo editor module (Android: photoeditor/PhotoEditorModule.kt). */
export interface PhotoEditorNative {
  pickPhoto(): Promise<string | null>;
  importPhoto(source: string): Promise<ImportedPhoto>;
  saveAsNew(params: SaveParams): Promise<SavedPhoto>;
  sharePhoto(uri: string): Promise<boolean>;
  takePendingShare(): Promise<string | null>;
  deleteSession(sessionId: string): Promise<boolean>;
  deleteSessionFiles(paths: string[]): Promise<number>;
  getEditModels(): Promise<EditModelInfo[]>;
  downloadEditModel(id: string): Promise<EditModelInfo>;
  cancelModelDownload(id: string): Promise<boolean>;
  deleteEditModel(id: string): Promise<EditModelInfo>;
  /** Remove: fills the painted area with LaMa. Rejects with EDIT_CANCELLED, LOW_MEMORY, MODEL_MISSING. */
  applyRemove(params: RegionEditParams): Promise<RegionEditResult>;
  /** Fill: Stable Diffusion inpainting of the painted area. Rejects with EDIT_CANCELLED, ENGINE_NOT_READY, LOW_MEMORY. */
  applyFill(params: FillParams): Promise<FillResult>;
  /** True when the image model folder has the VAE encoder that Fill needs. */
  checkFillModel(modelPath: string): Promise<boolean>;
  cancelEdit(): Promise<boolean>;
  releaseEditEngines(): Promise<boolean>;
}

const SHARE_RECEIVED_EVENT = 'PhotoEditorShareReceived';
const MODEL_PROGRESS_EVENT = 'PhotoEditorModelProgress';
const EDIT_PROGRESS_EVENT = 'PhotoEditorEditProgress';

const module: PhotoEditorNative | undefined = NativeModules.PhotoEditorModule;

/** Capability flag: the editor exists only where the native module is built (Android). */
export const isPhotoEditorAvailable = module != null;

export function photoEditorNative(): PhotoEditorNative {
  if (!module) throw new Error('The photo editor is not available on this device.');
  return module;
}

export function onShareReceived(listener: () => void): () => void {
  if (!module) return () => {};
  const sub = new NativeEventEmitter(NativeModules.PhotoEditorModule).addListener(SHARE_RECEIVED_EVENT, listener);
  return () => sub.remove();
}

export function onModelProgress(listener: (p: ModelProgress) => void): () => void {
  if (!module) return () => {};
  const sub = new NativeEventEmitter(NativeModules.PhotoEditorModule).addListener(MODEL_PROGRESS_EVENT, listener);
  return () => sub.remove();
}

export function onEditProgress(listener: (p: EditProgress) => void): () => void {
  if (!module) return () => {};
  const sub = new NativeEventEmitter(NativeModules.PhotoEditorModule).addListener(EDIT_PROGRESS_EVENT, listener);
  return () => sub.remove();
}
