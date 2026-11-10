/**
 * Photo editor, phase 1: open a photo, draw a mask stroke, undo/redo it, and save a copy.
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
  addListener: () => {},
  removeListeners: () => {},
};

const { render, fireEvent, waitFor, act } = require('@testing-library/react-native');
const { EditHomeScreen } = require('../../../src/photoEditor');
const { PhotoEditorScreen } = require('../../../src/photoEditor/screens/PhotoEditorScreen');
const { useTimingLog } = require('../../../src/photoEditor/services/timingLog');

describe('photo editor phase 1', () => {
  it('opens a photo, masks it with undo/redo, and saves a new copy without touching the original', async () => {
    const alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const home = render(<EditHomeScreen />);
    fireEvent.press(home.getByTestId('edit-open-photo'));
    await waitFor(() => expect(home.getByText('PXL_beach')).toBeTruthy());
    expect(home.getByText('8000 x 6000, 0 mask strokes')).toBeTruthy();
    expect(useTimingLog.getState().entries[0].operation).toBe('Open photo');
    home.unmount();

    const editor = render(<PhotoEditorScreen />);
    expect(editor.getByText('8000 x 6000 (48.0 MP)')).toBeTruthy();
    fireEvent(editor.getByTestId('photo-editor-canvas'), 'layout', { nativeEvent: { layout: { width: 400, height: 300 } } });

    // Draw one stroke with a finger: down, move, up.
    const draw = drawGestures[drawGestures.length - 1];
    act(() => {
      draw.onTouchesDown({ numberOfTouches: 1 });
      draw.onBegin({ x: 100, y: 100 });
      draw.onUpdate({ x: 160, y: 120 });
      draw.onFinalize();
    });

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
});
