import { NativeModules } from 'react-native';
import { useAppStore } from '../../stores';
import { activeModelService } from '../../services/activeModelService';
import { photoEditorNative } from '../native/photoEditorNative';

/** Why Fill can't run yet, in words the editor shows as-is. */
class FillEngineError extends Error {
  constructor(public readonly reason: 'no-model' | 'no-vae-encoder', message: string) { super(message); }
}

/**
 * Gets Off Grid's Stable Diffusion engine (local-dream) ready for Fill: picks the downloaded
 * CPU/GPU image model, checks it can do inpainting, loads it through Off Grid's own model
 * service, and returns the local server's port.
 */
export async function prepareFillEngine(): Promise<{ port: number; modelName: string }> {
  const { downloadedImageModels, activeImageModelId } = useAppStore.getState();
  const usable = downloadedImageModels.filter(m => m.backend === 'mnn');
  const model = usable.find(m => m.id === activeImageModelId) ?? usable[0];
  if (!model) {
    throw new FillEngineError('no-model',
      'Fill uses an image model. Download one in Models, Image (any model marked GPU), then try again.');
  }
  if (!(await photoEditorNative().checkFillModel(model.modelPath))) {
    throw new FillEngineError('no-vae-encoder',
      `${model.name} can't edit photos (it has no VAE encoder). Download another image model in Models, Image.`);
  }
  await activeModelService.loadImageModel(model.id);
  const port: number = await NativeModules.LocalDreamModule.getServerPort();
  return { port, modelName: model.name };
}
