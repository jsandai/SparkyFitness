import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Toast from 'react-native-toast-message';
import { addLog } from './LogService';
import { fireSuccessHaptic } from './haptics';
import { getSoundsEnabled } from './sounds';

const CHANNEL_ID = 'workout-timer';
const CHANNEL_ID_SILENT = 'workout-timer-silent';

let initialized = false;
let hasShownDeniedToast = false;

export async function initNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: getSoundsEnabled(),
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      // Android channels are immutable after creation, so we register two:
      // one with the default channel sound, one silenced. scheduleRestNotification
      // picks the right channelId at scheduling time based on the user toggle.
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Workout timer',
        importance: Notifications.AndroidImportance.HIGH,
        enableVibrate: true,
      });
      await Notifications.setNotificationChannelAsync(CHANNEL_ID_SILENT, {
        name: 'Workout timer (silent)',
        importance: Notifications.AndroidImportance.HIGH,
        enableVibrate: true,
        sound: null,
      });
    }
  } catch (err) {
    addLog(`initNotifications failed: ${(err as Error).message}`, 'ERROR');
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted') return true;
    if (current.status === 'denied') return false;

    const requested = await Notifications.requestPermissionsAsync();
    if (requested.status === 'granted') return true;

    if (!hasShownDeniedToast) {
      hasShownDeniedToast = true;
      Toast.show({
        type: 'info',
        text1: 'Notifications off',
        text2: 'Timer will still alert in the app.',
      });
    }
    return false;
  } catch (err) {
    addLog(`ensureNotificationPermission failed: ${(err as Error).message}`, 'ERROR');
    return false;
  }
}

export async function scheduleRestNotification(
  exerciseName: string,
  seconds: number,
): Promise<string | null> {
  const granted = await ensureNotificationPermission();
  if (!granted) return null;

  const soundOn = getSoundsEnabled();
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest complete',
        body: exerciseName,
        sound: soundOn,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        channelId: soundOn ? CHANNEL_ID : CHANNEL_ID_SILENT,
      },
    });
    return id;
  } catch (err) {
    addLog(`scheduleRestNotification failed: ${(err as Error).message}`, 'ERROR');
    return null;
  }
}

export async function cancelScheduledNotification(id: string | null): Promise<void> {
  if (id == null) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (err) {
    addLog(`cancelScheduledNotification failed: ${(err as Error).message}`, 'ERROR');
  }
}

export function fireRestCompleteHaptic(): void {
  fireSuccessHaptic();
}

/** Test-only helper — resets module-level state. */
export function __resetNotificationStateForTests(): void {
  initialized = false;
  hasShownDeniedToast = false;
}
