import * as Notifications from 'expo-notifications';

let handlerSet = false;
let scheduledEndId: string | null = null;

const ACTIVE_NOTIFICATION_ID = 'workout-rest-timer-active';

function ensureHandler(): void {
  if (handlerSet) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
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
    await Notifications.scheduleNotificationAsync({
      identifier: ACTIVE_NOTIFICATION_ID,
      content: {
        title: 'Rest Timer',
        body: formatRestSeconds(remainingSeconds),
        sound: false,
      },
      trigger: null,
    });
  } catch {
    // Native module unavailable. Timer still works in-app.
  }
}

/**
 * When the app is backgrounded JS cannot update the notification every second.
 * Switch to a static "Done at HH:MM AM/PM" message so it stays accurate.
 */
export async function showRestTimerEndTimeNotification(remainingSeconds: number): Promise<void> {
  try {
    ensureHandler();
    const end = new Date(Date.now() + remainingSeconds * 1000);
    const h = end.getHours();
    const m = end.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    await Notifications.scheduleNotificationAsync({
      identifier: ACTIVE_NOTIFICATION_ID,
      content: {
        title: 'Rest Timer',
        body: `Done at ${timeStr}`,
        sound: false,
      },
      trigger: null,
    });
  } catch {
    // Native module unavailable.
  }
}

export async function dismissRestTimerNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(ACTIVE_NOTIFICATION_ID);
  } catch {
    // Ignore dismissal errors.
  }
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
