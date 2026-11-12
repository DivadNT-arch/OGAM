/**
 * Photo editor: open a photo, paint a mask with undo/redo, save a copy (phase 1), and Remove
 * the painted area with the downloaded model, with undo/redo of the edit (phase 2).
 * Fakes only the device boundary: the PhotoEditorModule native module and the gesture library.
 * The screens, session service, mask history and geometry all run for real.
 */
import React from 'react';
import { Alert, NativeModules } from 'react-native';

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
    Gesture: {
      Pan: builder('Pan'), Pinch: builder('Pinch'), Tap: builder('Tap'),
      Simultaneous: () => ({}), Race: () => ({}), Exclusive: () => ({}),
    },
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
  previewPath: '/data/photo_editor/sessions/s1/preview.jpg', width: 8000, height: 6000,
  previewWidth: 2048, previewHeight: 1536, mimeType: 'image/jpeg', hasLocation: true,
  fileSizeBytes: 21_000_000, displayName: 'PXL_beach', durationMs: 900,
};
const saveCalls: any[] = [];
const removeCalls: any[] = [];
const installed: Record<string, boolean> = { lama: false, lama1024: false };
const modelInfo = (id: string) => ({ id, name: id, license: 'Apache-2.0', sizeBytes: 208044816, inputSize: id === 'lama' ? 512 : 1024, installed: installed[id], partialBytes: 0 });
NativeModules.PhotoEditorModule = {
  pickPhoto: async () => 'content://media/external/images/media/12',
  importPhoto: async () => photo,
  saveAsNew: async (params: any) => {
    saveCalls.push(params);
    return { uri: 'content://media/external/images/media/99', displayName: 'PXL_beach_edit_1.jpg', album: 'Pictures/Off Grid Edits', durationMs: 40 };
  },
  sharePhoto: async () => true,
  takePendingShare: async () => null,
  deleteSession: async () => true,
  deleteSessionFiles: async () => 0,
  getEditModels: async () => [modelInfo('lama'), modelInfo('lama1024')],
  downloadEditModel: async (id: string) => { installed[id] = true; return modelInfo(id); },
  cancelModelDownload: async () => true,
  deleteEditModel: async (id: string) => { installed[id] = false; return modelInfo(id); },
  applyRemove: async (params: any) => {
    removeCalls.push(params);
    return {
      resultPath: `/data/photo_editor/sessions/s1/${params.outName}.jpg`, previewPath: `/data/photo_editor/sessions/s1/${params.outName}_preview.jpg`,
      loadMs: 1200, modelSize: 1024, decodeMs: 900, maskMs: 5, modelMs: 3100, blendMs: 40, encodeMs: 1500, cropWidth: 1100, cropHeight: 1100,
    };
  },
  cancelEdit: async () => true,
  releaseEditEngines: async () => true,
  addListener: () => {},
  removeListeners: () => {},
};

const { render, fireEvent, waitFor, act } = require('@testing-library/react-native');
const { EditHomeScreen } = require('../../../src/photoEditor');
const { PhotoEditorScreen } = require('../../../src/photoEditor/screens/PhotoEditorScreen');
const { useTimingLog } = require('../../../src/photoEditor/services/timingLog');

function drawStroke() {
  const draw = drawGestures[drawGestures.length - 1];
  act(() => {
    draw.onTouchesDown({ numberOfTouches: 1 });
    draw.onBegin({ x: 100, y: 100 });
    draw.onUpdate({ x: 160, y: 120 });
    draw.onFinalize();
  });
}

describe('photo editor', () => {
  it('opens a photo, masks it with undo/redo, and saves a new copy without touching the original', async () => {
    const alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const home = render(<EditHomeScreen />);
    fireEvent.press(home.getByTestId('edit-open-photo'));
    await waitFor(() => expect(home.getByText('PXL_beach')).toBeTruthy());
    expect(home.getByText('8000 x 6000, 0 edits, 0 mask strokes')).toBeTruthy();
    expect(useTimingLog.getState().entries[0].operation).toBe('Open photo');
    home.unmount();

    const editor = render(<PhotoEditorScreen />);
    expect(editor.getByText('8000 x 6000 (48.0 MP)')).toBeTruthy();
    fireEvent(editor.getByTestId('photo-editor-canvas'), 'layout', { nativeEvent: { layout: { width: 400, height: 300 } } });

    drawStroke(); // one finger: down, move, up

    const undo = editor.getByTestId('mask-undo');
    const redo = editor.getByTestId('mask-redo');
    expect(undo.props.accessibilityState.disabled).toBe(false);
    fireEvent.press(undo);
    expect(editor.getByTestId('mask-undo').props.accessibilityState.disabled).toBe(true);
    expect(redo.props.accessibilityState.disabled).toBe(false);
    fireEvent.press(editor.getByTestId('mask-redo'));
    expect(editor.getByTestId('mask-undo').props.accessibilityState.disabled).toBe(false);

    fireEvent.press(editor.getByTestId('save-copy'));
    await waitFor(() => expect(alerts).toHaveBeenCalledWith('Saved', expect.stringContaining('original photo was not changed')));
    expect(saveCalls[0]).toEqual({
      resultPath: photo.originalPath, originalPath: photo.originalPath, keepMetadata: true, baseName: 'PXL_beach',
    });
  });

  it('removes the painted area after a one-time model download, and the edit can be undone and redone', async () => {
    const alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const editor = render(<PhotoEditorScreen />);
    fireEvent(editor.getByTestId('photo-editor-canvas'), 'layout', { nativeEvent: { layout: { width: 400, height: 300 } } });

    // Remove with nothing painted asks for paint first.
    fireEvent.press(editor.getByTestId('mask-clear'));
    fireEvent.press(editor.getByTestId('ai-tool-remove'));
    expect(alerts).toHaveBeenLastCalledWith('Remove', expect.stringContaining('Paint over'));

    drawStroke();
    // Not downloaded yet: the editor offers the 208 MB download; accept it.
    fireEvent.press(editor.getByTestId('ai-tool-remove'));
    const [title, , buttons] = alerts.mock.calls[alerts.mock.calls.length - 1] as any;
    expect(title).toBe('Download the Remove models?');
    await act(async () => { await buttons.find((b: any) => b.text === 'Both').onPress(); });
    expect(installed).toEqual({ lama: true, lama1024: true });

    fireEvent.press(editor.getByTestId('ai-tool-remove'));
    await waitFor(() => expect(editor.getByText('1 edit')).toBeTruthy());
    expect(removeCalls[0].sourcePath).toBe(photo.originalPath);
    expect(removeCalls[0].strokes[0]).toEqual(expect.objectContaining({ mode: 'brush', points: expect.any(Array) }));
    // The mask is cleared after the edit and the timing log has the model time.
    expect(editor.getByTestId('mask-undo').props.accessibilityState.disabled).toBe(true);
    expect(useTimingLog.getState().entries[0]).toEqual(expect.objectContaining({ operation: 'Remove', failed: false }));
    expect(useTimingLog.getState().entries[0].detail).toContain('LaMa 1024 3100 ms');

    fireEvent.press(editor.getByTestId('edit-undo'));
    expect(editor.getByText('0 edits')).toBeTruthy();
    fireEvent.press(editor.getByTestId('edit-redo'));
    expect(editor.getByText('1 edit')).toBeTruthy();

    // Box tool: drag out a rectangle; it is sent as a filled box with sorted corners.
    fireEvent.press(editor.getByTestId('tool-box'));
    const box = drawGestures[drawGestures.length - 1];
    act(() => {
      box.onTouchesDown({ numberOfTouches: 1 });
      box.onBegin({ x: 300, y: 250 });
      box.onUpdate({ x: 200, y: 150 });
      box.onFinalize();
    });
    fireEvent.press(editor.getByTestId('ai-tool-remove'));
    await waitFor(() => expect(removeCalls).toHaveLength(2));
    const sent = removeCalls[1].strokes[0];
    expect(sent.shape).toBe('rect');
    expect(sent.points[0]).toBeLessThan(sent.points[2]);
    expect(sent.points[1]).toBeLessThan(sent.points[3]);
    fireEvent.press(editor.getByTestId('tool-brush'));

    // A further Remove builds on the previous result.
    drawStroke();
    fireEvent.press(editor.getByTestId('ai-tool-remove'));
    await waitFor(() => expect(editor.getByText('3 edits')).toBeTruthy());
    expect(removeCalls[2].sourcePath).toMatch(/result_\d+\.jpg$/);
  });
});
