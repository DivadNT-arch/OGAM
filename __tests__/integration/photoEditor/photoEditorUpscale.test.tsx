/**
 * Photo editor, phase 4: Upscale. The whole photo is enlarged 2x with Real-ESRGAN; sizes that
 * would pass the 64 MP limit are not offered. Fakes only the native module and gesture library.
 * Fakes only the device boundary: the PhotoEditorModule native module and the gesture library.
 * The screens, session service, mask history and geometry all run for real.
 */
import React from 'react';
import { Alert, NativeModules } from 'react-native';

jest.mock('react-native-gesture-handler', () => {
  // Gestures are not exercised here; every builder method just chains.
  const builder = (_kind: string) => () => {
    const gesture: any = new Proxy({}, { get: () => () => gesture });
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
  sessionId: 's2', originalPath: '/data/photo_editor/sessions/s2/original.jpg',
  previewPath: '/data/photo_editor/sessions/s2/preview.jpg', width: 4000, height: 3000,
  previewWidth: 2048, previewHeight: 1536, mimeType: 'image/jpeg', hasLocation: true,
  fileSizeBytes: 3_200_000, displayName: 'labrador', durationMs: 200,
};
let esrganInstalled = false;
const esrganInfo = () => ({ id: 'esrgan', name: 'Real-ESRGAN (Upscale)', license: 'BSD-3-Clause', sizeBytes: 4866396, inputSize: 0, installed: esrganInstalled, partialBytes: 0 });
const upscaleCalls: any[] = [];
NativeModules.PhotoEditorModule = {
  pickPhoto: async () => 'content://media/external/images/media/9',
  importPhoto: async () => photo,
  takePendingShare: async () => null,
  deleteSession: async () => true,
  deleteSessionFiles: async () => 0,
  getEditModels: async () => [esrganInfo()],
  downloadEditModel: async () => { esrganInstalled = true; return esrganInfo(); },
  applyUpscale: async (p: any) => {
    upscaleCalls.push(p);
    return {
      resultPath: `/data/photo_editor/sessions/s2/${p.outName}.jpg`, previewPath: `/data/photo_editor/sessions/s2/${p.outName}_preview.jpg`,
      width: 4000 * p.factor, height: 3000 * p.factor, decodeMs: 150, modelMs: 360000, encodeMs: 2500, tiles: 88,
    };
  },
  cancelEdit: async () => true,
  addListener: () => {}, removeListeners: () => {},
};

const { render, fireEvent, waitFor, act } = require('@testing-library/react-native');
const { editSession } = require('../../../src/photoEditor/services/editSession');
const { PhotoEditorScreen } = require('../../../src/photoEditor/screens/PhotoEditorScreen');
const { useTimingLog } = require('../../../src/photoEditor/services/timingLog');

describe('photo editor: Upscale', () => {
  it('downloads the model once, offers only sizes within 64 MP, and makes the upscaled photo the new result', async () => {
    const alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await editSession.open('content://media/external/images/media/9');
    const editor = render(<PhotoEditorScreen />);

    fireEvent.press(editor.getByTestId('ai-tool-upscale'));
    const [title, , buttons] = alerts.mock.calls[alerts.mock.calls.length - 1] as any;
    expect(title).toBe('Download the Upscale model?');
    await act(async () => { await buttons.find((b: any) => b.text === 'Download').onPress(); });

    // 12 MP photo: 2x gives 48 MP (allowed), 4x would give 192 MP (not offered).
    expect(editor.getByTestId('upscale-sheet')).toBeTruthy();
    expect(editor.getByText('8000 x 6000')).toBeTruthy();
    expect(editor.getByTestId('upscale-4x').props.accessibilityState?.disabled ?? editor.getByTestId('upscale-4x').props.disabled).toBeTruthy();
    fireEvent.press(editor.getByTestId('upscale-detail-Natural'));
    fireEvent.press(editor.getByTestId('upscale-run'));

    await waitFor(() => expect(editor.getByText('1 edit')).toBeTruthy());
    expect(upscaleCalls[0]).toEqual(expect.objectContaining({ factor: 2, detail: 0.45, sourcePath: photo.originalPath }));
    expect(editor.getByText('8000 x 6000 (48.0 MP)')).toBeTruthy();
    const entry = useTimingLog.getState().entries[0];
    expect(entry.operation).toBe('Upscale 2x');
    expect(entry.detail).toContain('4000x3000 to 8000x6000; 88 tiles, model 360 s (30 s/MP)');

    // Undo edit brings back the original size.
    fireEvent.press(editor.getByTestId('edit-undo'));
    expect(editor.getByText('4000 x 3000 (12.0 MP)')).toBeTruthy();
  });
});
