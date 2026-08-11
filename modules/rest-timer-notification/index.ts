import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Android-only native rest timer notification.
 *
 * The countdown is drawn by the system (a chronometer counting down to a fixed
 * end time), so it stays accurate without the app re-posting every second — the
 * pattern that previously got the app rate-limited. The completion alert is
 * delivered by an exact alarm the module owns and reuses the same notification
 * id, so it replaces the countdown instead of stacking a second notification.
 *
 * Null on iOS, in Expo Go, or in any build made before this module existed;
 * callers fall back to expo-notifications.
 */
interface RestTimerNotificationModule {
  /** endTimeMillis is epoch ms. */
  start(
    endTimeMillis: number,
    title: string,
    completeTitle: string,
    completeBody: string
  ): void;
  stop(): void;
}

const nativeModule =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<RestTimerNotificationModule>('RestTimerNotification')
    : null;

export const isNativeRestTimerAvailable = nativeModule != null;

export function startNativeRestTimer(
  endTimeMillis: number,
  title: string,
  completeTitle: string,
  completeBody: string
): boolean {
  if (!nativeModule) return false;
  try {
    nativeModule.start(endTimeMillis, title, completeTitle, completeBody);
    return true;
  } catch {
    return false;
  }
}

export function stopNativeRestTimer(): boolean {
  if (!nativeModule) return false;
  try {
    nativeModule.stop();
    return true;
  } catch {
    return false;
  }
}
