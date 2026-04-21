import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

let handlerSet = false;
let scheduledEndId: string | null = null;
let scheduledCountdownIds: string[] = [];
let activeLiveNotificationId: string | null = null;

function ensureHandler(): void {
  if (handlerSet) return;
  try {
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('rest-timer', {
        name: 'Rest timer',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 120, 250],
        lightColor: '#FF6B35',
      }).catch(() => {
        // Ignore channel setup failures.
      });
    }
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        // Suppress tray alerts only while app is visibly active.
        shouldShowAlert: AppState.currentState !== 'active',
        shouldPlaySound: AppState.currentState !== 'active',
        shouldSetBadge: false,
      }),
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

function formatRestSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Updates (or creates) the live countdown notification shown in the tray.
 * Uses a fixed identifier so each call replaces the previous instead of
 * stacking a new notification.
 */
export async function updateRestTimerNotification(remainingSeconds: number): Promise<void> {
  try {
    ensureHandler();
    activeLiveNotificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest Timer',
        body: formatRestSeconds(remainingSeconds),
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: 'rest-timer' } : {}),
      },
      trigger: null,
    });
  } catch {
    // Native module unavailable. Timer still works in-app.
  }
}

export async function dismissRestTimerNotification(): Promise<void> {
  try {
    if (activeLiveNotificationId) {
      await Notifications.dismissNotificationAsync(activeLiveNotificationId);
      activeLiveNotificationId = null;
    }
    if (scheduledCountdownIds.length > 0) {
      await Promise.all(
        scheduledCountdownIds.map((id) => Notifications.dismissNotificationAsync(id))
      );
    }
  } catch {
    // Ignore dismissal errors.
  }
}

/**
 * Schedule second-by-second countdown notifications for background mode.
 * Each one replaces the previous via fixed identifier.
 */
export async function scheduleRestTimerCountdownNotifications(seconds: number): Promise<void> {
  await cancelRestTimerCountdownNotifications();
  await dismissRestTimerNotification();
  try {
    ensureHandler();
    const safeSeconds = Math.max(1, Math.floor(seconds));
    const end = new Date(Date.now() + safeSeconds * 1000);
    const h = end.getHours();
    const m = end.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    activeLiveNotificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest Timer',
        body: `Ends at ${timeStr}`,
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: 'rest-timer' } : {}),
      },
      trigger: null,
    });
  } catch {
    // Native module unavailable.
  }
}

export async function cancelRestTimerCountdownNotifications(): Promise<void> {
  if (scheduledCountdownIds.length === 0) return;
  try {
    await Promise.all(
      scheduledCountdownIds.map((id) => Notifications.cancelScheduledNotificationAsync(id))
    );
  } catch {
    // Ignore cancellation errors.
  }
  scheduledCountdownIds = [];
}

/**
 * Schedules the "rest complete" alert to fire after `seconds` seconds.
 * This runs as a system-scheduled notification so it fires even when
 * the app is backgrounded.
 */
export async function scheduleRestEndNotification(seconds: number): Promise<void> {
  await cancelRestEndNotification();
  try {
    ensureHandler();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest complete',
        body: 'Ready for the next set.',
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: 'rest-timer' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
    scheduledEndId = id;
  } catch {
    // Native module unavailable. Timer still works in-app.
  }
}

export async function cancelRestEndNotification(): Promise<void> {
  if (!scheduledEndId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(scheduledEndId);
  } catch {
    // Ignore cancellation errors.
  }
  scheduledEndId = null;
}
