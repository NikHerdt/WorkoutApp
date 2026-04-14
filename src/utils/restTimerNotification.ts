import * as Notifications from 'expo-notifications';

let handlerSet = false;
let scheduledId: string | null = null;

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
    scheduledId = id;
  } catch {
    // Native module unavailable. Timer still works in-app.
  }
}

export async function cancelRestEndNotification(): Promise<void> {
  if (!scheduledId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(scheduledId);
  } catch {
    // Ignore cancellation errors.
  }
  scheduledId = null;
}
