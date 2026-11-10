/**
 * Photo editor (fork feature). Everything lives in this folder; the app wires it in with
 * one Edit tab and one share receiver in AppNavigator. Screens register through the
 * existing screen registry, so the root navigator needs no edits for them.
 */
import { registerScreen } from '../navigation/screenRegistry';
import { isPhotoEditorAvailable } from './native/photoEditorNative';
import { PhotoEditorScreen } from './screens/PhotoEditorScreen';
import { EditTimingScreen } from './screens/EditTimingScreen';
import { PHOTO_EDITOR_ROUTE, PHOTO_EDITOR_TIMING_ROUTE } from './routes';

export { EditHomeScreen } from './screens/EditHomeScreen';
export { PhotoEditorShareReceiver } from './ShareReceiver';
export { isPhotoEditorAvailable };

if (isPhotoEditorAvailable) {
  registerScreen({ name: PHOTO_EDITOR_ROUTE, component: PhotoEditorScreen });
  registerScreen({ name: PHOTO_EDITOR_TIMING_ROUTE, component: EditTimingScreen });
}
