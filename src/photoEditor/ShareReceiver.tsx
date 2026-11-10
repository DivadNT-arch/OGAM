import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { onShareReceived } from './native/photoEditorNative';
import { editSession } from './services/editSession';
import { PHOTO_EDITOR_ROUTE } from './routes';

/**
 * Opens photos sent through "Edit with Off Grid". Checks on mount (cold start), when the
 * app returns to the foreground, and when the native side says a photo just arrived.
 */
export const PhotoEditorShareReceiver: React.FC = () => {
  const navigation = useNavigation<any>();
  useEffect(() => {
    let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        if (await editSession.openPendingShare()) navigation.navigate(PHOTO_EDITOR_ROUTE);
      } catch (e: any) {
        Alert.alert('Could not open the photo', e?.message ?? String(e));
      } finally {
        running = false;
      }
    };
    check();
    const offShare = onShareReceived(check);
    const appState = AppState.addEventListener('change', s => { if (s === 'active') check(); });
    return () => { offShare(); appState.remove(); };
  }, [navigation]);
  return null;
};
