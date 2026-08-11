import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import {
  isNativeRestTimerAvailable,
  startNativeRestTimer,
  stopNativeRestTimer,
} from '../../modules/rest-timer-notification';

/**
 * Rest timer notifications.
 *
 * Two notifications are involved:
 *  - "Rest complete": scheduled to fire at the timer's end time. This is what
 *    must survive backgrounding, so it uses an absolute DATE trigger on the
 *    high-importance channel.
 *  - An optional ongoing "ends at HH:MM" notification shown while the app is
 *    backgrounded. It uses a fixed identifier so repeated calls replace it in
 *    place instead of stacking (posting a new notification every second gets
 *    the app throttled by Android, which delays everything else it posts).
 */

const CHANNEL_ID = 'rest-timer';
const ONGOING_NOTIFICATION_ID = 'rest-timer-ongoing';

let handlerSet = false;
let scheduledEndId: string | null = null;

function ensureHandler(): void {
  if (handlerSet) return;
  try {
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Rest timer',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 120, 250],
        lightColor: '#FF6B35',
      }).catch(() => {
        // Ignore channel setup failures.
      });
    }
    Notifications.setNotificationHandler({
      handleNotification: async () => {
        // Suppress the tray alert only while the app is visibly active — the
        // in-app timer UI already covers that case.
        const isForeground = AppState.currentState === 'active';
        return {
          shouldShowBanner: !isForeground,
          shouldShowList: !isForeground,
          shouldPlaySound: !isForeground,
          shouldSetBadge: false,
        };
      },
    });
    handlerSet = true;
  } catch {
    // Native module unavailable (Expo Go). Notifications disabled.
  }
}

export async function requestNotificationPermissions(): Promise<void> {
  try {
    ensureHandler();
    await Notifications.requestPermissionsAsync();
  } catch {
    // Ignore — permissions not available in Expo Go.
  }
}

function formatClockTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Shows (or replaces) the ongoing tray notification telling the user when rest
 * ends. Safe to call repeatedly — the fixed identifier replaces in place.
 */
export async function showRestTimerOngoingNotification(remainingSeconds: number): Promise<void> {
  try {
    ensureHandler();
    const safeSeconds = Math.max(0, Math.floor(remainingSeconds));
    const end = new Date(Date.now() + safeSeconds * 1000);
    await Notifications.scheduleNotificationAsync({
      identifier: ONGOING_NOTIFICATION_ID,
      content: {
        title: 'Rest timer',
        body: `Ends at ${formatClockTime(end)}`,
        sound: false,
        ...(Platform.OS === 'android' ? { sticky: true } : {}),
      },
      trigger: null,
    });
  } catch {
    // Native module unavailable. Timer still works in-app.
  }
}

export async function dismissRestTimerOngoingNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(ONGOING_NOTIFICATION_ID);
  } catch {
    // Ignore dismissal errors.
  }
}

/**
 * Starts the whole tray experience for a rest period: a live countdown that the
 * system ticks down, replaced in place by the "rest complete" alert.
 *
 * Returns false when the native module isn't in this build, in which case the
 * caller falls back to the expo-notifications path below.
 */
export function startNativeRestTimerNotification(seconds: number): boolean {
  if (!isNativeRestTimerAvailable) return false;
  const safeSeconds = Math.max(1, Math.floor(seconds));
  return startNativeRestTimer(
    Date.now() + safeSeconds * 1000,
    'Resting',
    'Rest complete',
    'Ready for the next set.'
  );
}

/** Cancels the native countdown and its pending alert. */
export function stopNativeRestTimerNotification(): boolean {
  return stopNativeRestTimer();
}

export const hasNativeRestTimer = isNativeRestTimerAvailable;

/**
 * Schedules the "rest complete" alert for `seconds` from now so it fires even
 * when the app is backgrounded or killed. Any previously scheduled alert is
 * cancelled first, so restarting a timer never leaves two pending alerts.
 *
 * Fallback for builds without the native module.
 */
export async function scheduleRestEndNotification(seconds: number): Promise<void> {
  await cancelRestEndNotification();
  try {
    ensureHandler();
    const safeSeconds = Math.max(1, Math.floor(seconds));
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest complete',
        body: 'Ready for the next set.',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(Date.now() + safeSeconds * 1000),
        // Android delivers scheduled notifications on the channel named by the
        // trigger. Without this they land on the default (low-importance)
        // channel, which is silent and gets batched — i.e. late or not at all.
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
    scheduledEndId = id;
  } catch {
    // Native module unavailable. Timer still works in-app.
  }
}

export async function cancelRestEndNotification(): Promise<void> {
  if (!scheduledEndId) return;
  const id = scheduledEndId;
  scheduledEndId = null;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Ignore cancellation errors.
  }
}
