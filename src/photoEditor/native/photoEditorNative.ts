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

/** Contract for the native photo editor module (Android: photoeditor/PhotoEditorModule.kt). */
export interface PhotoEditorNative {
  pickPhoto(): Promise<string | null>;
  importPhoto(source: string): Promise<ImportedPhoto>;
  saveAsNew(params: SaveParams): Promise<SavedPhoto>;
  sharePhoto(uri: string): Promise<boolean>;
  takePendingShare(): Promise<string | null>;
  deleteSession(sessionId: string): Promise<boolean>;
}

const SHARE_RECEIVED_EVENT = 'PhotoEditorShareReceived';

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
