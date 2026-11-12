/**
 * Photo editor, phase 3: Fill. The user paints an area, describes what should be there, and
 * the editor loads Off Grid's own image model and sends the inpainting request.
 * Device boundary only: the harness fakes the diffusion native module and the file system;
 * PhotoEditorModule (native) is faked with honest data. Off Grid's real model service runs.
 */
import React from 'react';
import { Alert } from 'react-native';
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

type Handlers = Record<string, (e?: any) => void>;
const drawGestures: Handlers[] = [];

jest.mock('react-native-gesture-handler', () => {
  const builder = (kind: string) => () => {
    const handlers: Handlers = {};
    let runsOnJs = false;
    const gesture: any = new Proxy({}, {
      get: (_t, prop: string) => (arg: any) => {
        if (prop === 'runOnJS') runsOnJs = arg;
        if (prop.startsWith('on')) handlers[prop] = arg;
        if (kind === 'Pan' && runsOnJs && prop === 'onFinalize') drawGestures.push(handlers);
        return gesture;
      },
    });
    return gesture;
  };
  return {
    GestureHandlerRootView: 'View',
    GestureDetector: ({ children }: any) => children,
    Gesture: { Pan: builder('Pan'), Pinch: builder('Pinch'), Tap: builder('Tap'), Simultaneous: () => ({}), Race: () => ({}), Exclusive: () => ({}) },
  };
});
jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');
jest.mock('react-native-svg', () => {
  const { View } = require('react-native');
  const C = ({ children }: any) => <View>{children}</View>;
  return { __esModule: true, default: C, Defs: C, Mask: C, Path: C, Rect: C };
});

const photo = {
  sessionId: 's1', originalPath: '/data/photo_editor/sessions/s1/original.jpg',
  previewPath: '/data/photo_editor/sessions/s1/preview.jpg', width: 4000, height: 3000,
  previewWidth: 2048, previewHeight: 1536, mimeType: 'image/jpeg', hasLocation: false,
  fileSizeBytes: 6_000_000, displayName: 'garden', durationMs: 300,
};

function setup(opts: { vae: boolean }) {
  const boundary = installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 10 * GB } });
  const RN = require('react-native');
  // A complete CPU/GPU (MNN) model on disk, as Off Grid's integrity check expects.
  const dir = '/docs/image_models/sd';
  for (const f of ['pos_emb.bin', 'token_emb.bin', 'tokenizer.json', 'unet.mnn', 'unet.mnn.weight',
    'clip_v2.mnn', 'clip_v2.mnn.weight', 'vae_decoder.mnn', 'vae_decoder.mnn.weight']) boundary.fs!.seedFile(`${dir}/${f}`, 4096);
  RN.NativeModules.LocalDreamModule.getServerPort = jest.fn().mockResolvedValue(18081);
  const fillCalls: any[] = [];
  RN.NativeModules.PhotoEditorModule = {
    pickPhoto: async () => 'content://media/external/images/media/7',
    importPhoto: async () => photo,
    takePendingShare: async () => null,
    deleteSession: async () => true,
    deleteSessionFiles: async () => 0,
    getEditModels: async () => [],
    checkFillModel: async () => opts.vae,
    applyFill: async (p: any) => {
      fillCalls.push(p);
      return {
        results: Array.from({ length: p.variations }, (_, i) => ({
          resultPath: `/data/photo_editor/sessions/s1/${p.outName}_v${i}.jpg`,
          previewPath: `/data/photo_editor/sessions/s1/${p.outName}_v${i}_preview.jpg`, seed: p.seed + i,
        })),
        perVariation: Array.from({ length: p.variations }, () => ({ modelMs: 95000, msPerStep: 4700 })),
        modelMs: 95000, otherMs: 900, cropWidth: 900, cropHeight: 900,
      };
    },
    cancelEdit: async () => true,
    addListener: () => {}, removeListeners: () => {},
  };
  const { render, fireEvent, waitFor, act } = requireRTL();
  const { useAppStore } = require('../../../src/stores');
  const { editSession } = require('../../../src/photoEditor/services/editSession');
  const { PhotoEditorScreen } = require('../../../src/photoEditor/screens/PhotoEditorScreen');
  const { useTimingLog } = require('../../../src/photoEditor/services/timingLog');
  const model = createONNXImageModel({ id: 'sd', name: 'AnythingV5', modelPath: dir, backend: 'mnn' });
  useAppStore.setState({ downloadedImageModels: [model], activeImageModelId: 'sd' });
  return { boundary, fillCalls, render, fireEvent, waitFor, act, editSession, PhotoEditorScreen, useTimingLog };
}

function paint(act: any) {
  const draw = drawGestures[drawGestures.length - 1];
  act(() => {
    draw.onTouchesDown({ numberOfTouches: 1 });
    draw.onBegin({ x: 120, y: 90 });
    draw.onUpdate({ x: 180, y: 110 });
    draw.onFinalize();
  });
}

describe('photo editor: Fill', () => {
  it('fills the painted area from a prompt with the downloaded image model, and lets the user pick a version', async () => {
    const t = setup({ vae: true });
    const alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await t.editSession.open('content://media/external/images/media/7');
    const view = t.render(<t.PhotoEditorScreen />);
    t.fireEvent(view.getByTestId('photo-editor-canvas'), 'layout', { nativeEvent: { layout: { width: 400, height: 300 } } });

    // Fill with nothing painted asks for paint first.
    t.fireEvent.press(view.getByTestId('ai-tool-fill'));
    expect(alerts).toHaveBeenLastCalledWith('Fill', expect.stringContaining('Paint over'));

    paint(t.act);
    t.fireEvent.press(view.getByTestId('ai-tool-fill'));
    t.fireEvent.changeText(view.getByTestId('fill-prompt'), 'a terracotta pot with a fern');
    t.fireEvent.press(view.getByTestId('fill-variations-3'));
    t.fireEvent.press(view.getByTestId('fill-speed-8'));
    // 3 versions x (8 steps x 90% -> 8 steps x 16 s + 15 s) = 429 s.
    expect(view.getByTestId('fill-estimate').props.children).toEqual(['Takes ', 'about 7 minutes', ' on this phone.']);
    t.fireEvent.press(view.getByTestId('fill-run'));

    await t.waitFor(() => expect(view.getByTestId('variation-picker')).toBeTruthy());
    // Off Grid's real model service loaded the image model on the diffusion engine.
    expect(t.boundary.diffusion.module.loadModel).toHaveBeenCalledWith(expect.objectContaining({ modelPath: '/docs/image_models/sd' }));
    expect(t.fillCalls[0]).toEqual(expect.objectContaining({
      prompt: 'a terracotta pot with a fern', variations: 3, steps: 8, port: 18081, sourcePath: photo.originalPath,
    }));
    expect(t.fillCalls[0].strength).toBeCloseTo(0.9);
    expect(t.useTimingLog.getState().entries[0].operation).toBe('Fill x3');
    expect(t.useTimingLog.getState().entries[0].detail).toContain('v2 95 s (4.7 s/step)');

    t.fireEvent.press(view.getByTestId('variation-1'));
    expect(view.queryByTestId('variation-picker')).toBeNull();
    expect(view.getByText('1 edit')).toBeTruthy();
  });

  it('explains when the image model cannot edit photos (no VAE encoder)', async () => {
    const t = setup({ vae: false });
    const alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await t.editSession.open('content://media/external/images/media/7');
    const view = t.render(<t.PhotoEditorScreen />);
    t.fireEvent(view.getByTestId('photo-editor-canvas'), 'layout', { nativeEvent: { layout: { width: 400, height: 300 } } });
    paint(t.act);
    t.fireEvent.press(view.getByTestId('ai-tool-fill'));
    t.fireEvent.changeText(view.getByTestId('fill-prompt'), 'grass');
    t.fireEvent.press(view.getByTestId('fill-run'));
    await t.waitFor(() => expect(alerts).toHaveBeenLastCalledWith('Fill failed', expect.stringContaining('no VAE encoder')));
    expect(t.fillCalls).toHaveLength(0);
  });
});
