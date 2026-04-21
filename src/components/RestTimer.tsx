import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Modal,
  AppState,
  AppStateStatus,
} from 'react-native';
import { colors } from '../theme/colors';
import { useWorkoutStore } from '../store/useWorkoutStore';
import {
  scheduleRestEndNotification,
  cancelRestEndNotification,
  updateRestTimerNotification,
  dismissRestTimerNotification,
  scheduleRestTimerCountdownNotifications,
  cancelRestTimerCountdownNotifications,
} from '../utils/restTimerNotification';

export default function RestTimer() {
  const {
    restTimerActive,
    restTimerMinimized,
    restTimerSeconds,
    restTimerTotal,
    stopRestTimer,
    setRestTimerMinimized,
    tickRestTimer,
    syncRestTimer,
  } = useWorkoutStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(1)).current;
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  // Track whether the timer reached zero naturally so we don't cancel the end notification.
  const naturallyCompletedRef = useRef(false);

  useEffect(() => {
    if (restTimerActive) {
      naturallyCompletedRef.current = false;

      scheduleRestEndNotification(restTimerSeconds);
      if (appStateRef.current !== 'active') {
        updateRestTimerNotification(restTimerSeconds);
      } else {
        dismissRestTimerNotification();
      }

      intervalRef.current = setInterval(() => {
        tickRestTimer();

        const state = useWorkoutStore.getState();
        if (
          state.restTimerActive &&
          state.restTimerSeconds > 0 &&
          appStateRef.current !== 'active'
        ) {
          updateRestTimerNotification(state.restTimerSeconds);
        } else if (!state.restTimerActive) {
          // Timer hit zero — mark as natural completion so cleanup skips cancellation.
          naturallyCompletedRef.current = true;
        }
      }, 1000);

      Animated.timing(progressAnim, {
        toValue: 0,
        duration: restTimerSeconds * 1000,
        useNativeDriver: false,
      }).start();
    } else {
      if (!naturallyCompletedRef.current) {
        // User tapped Skip — cancel the scheduled end notification.
        cancelRestEndNotification();
      }
      cancelRestTimerCountdownNotifications();
      naturallyCompletedRef.current = false;

      dismissRestTimerNotification();

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      progressAnim.setValue(1);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [restTimerActive]);

  // Handle app going to background and returning to foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      const isGoingBackground =
        (nextState === 'background' || nextState === 'inactive') && prev === 'active';
      const isReturningForeground =
        nextState === 'active' && (prev === 'background' || prev === 'inactive');

      if (isGoingBackground && useWorkoutStore.getState().restTimerActive) {
        const remaining = useWorkoutStore.getState().restTimerSeconds;
        scheduleRestTimerCountdownNotifications(remaining);
      }

      if (isReturningForeground && useWorkoutStore.getState().restTimerActive) {
        // Keep the tray clean while app is visible.
        cancelRestTimerCountdownNotifications();
        dismissRestTimerNotification();

        // Resync the stored countdown from wall-clock elapsed time.
        syncRestTimer();

        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        const remaining = useWorkoutStore.getState().restTimerSeconds;
        const total = useWorkoutStore.getState().restTimerTotal;

        if (remaining > 0) {
          progressAnim.stopAnimation();
          progressAnim.setValue(total > 0 ? remaining / total : 0);
          Animated.timing(progressAnim, {
            toValue: 0,
            duration: remaining * 1000,
            useNativeDriver: false,
          }).start();

          intervalRef.current = setInterval(() => {
            tickRestTimer();

            const state = useWorkoutStore.getState();
            if (
              state.restTimerActive &&
              state.restTimerSeconds > 0 &&
              appStateRef.current !== 'active'
            ) {
              updateRestTimerNotification(state.restTimerSeconds);
            } else if (!state.restTimerActive) {
              naturallyCompletedRef.current = true;
            }
          }, 1000);
        }
      }
    });

    return () => subscription.remove();
  }, []);

  if (!restTimerActive) return null;

  const minutes = Math.floor(restTimerSeconds / 60);
  const seconds = restTimerSeconds % 60;
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <>
      <Modal transparent animationType="slide" visible={restTimerActive && !restTimerMinimized}>
        <View style={styles.overlay}>
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <Text style={styles.label}>REST TIMER</Text>
              <TouchableOpacity
                style={styles.minimizeButton}
                onPress={() => setRestTimerMinimized(true)}
              >
                <Text style={styles.minimizeText}>Minimize</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.timerCircle}>
              <Text style={styles.time}>{timeStr}</Text>
              <Text style={styles.subText}>
                {Math.ceil(restTimerTotal / 60)} min rest
              </Text>
            </View>
            <View style={styles.progressBar}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
            <TouchableOpacity style={styles.skipButton} onPress={stopRestTimer}>
              <Text style={styles.skipText}>Skip Rest</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {restTimerActive && restTimerMinimized ? (
        <View pointerEvents="box-none" style={styles.minimizedWrap}>
          <TouchableOpacity
            style={styles.minimizedChip}
            onPress={() => setRestTimerMinimized(false)}
            activeOpacity={0.85}
          >
            <View style={styles.minimizedLeft}>
              <Text style={styles.minimizedLabel}>REST</Text>
              <Text style={styles.minimizedTime}>{timeStr}</Text>
            </View>
            <TouchableOpacity style={styles.minimizedSkip} onPress={stopRestTimer}>
              <Text style={styles.minimizedSkipText}>Skip</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.restTimer,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingBottom: 48,
    paddingHorizontal: 32,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  label: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 24,
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  minimizeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  minimizeText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  timerCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  time: {
    color: colors.accent,
    fontSize: 42,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  subText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: 28,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  skipButton: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skipText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  minimizedWrap: {
    position: 'absolute',
    bottom: 92,
    right: 12,
    left: 12,
    zIndex: 1000,
  },
  minimizedChip: {
    backgroundColor: colors.restTimer,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  minimizedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  minimizedLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '700',
  },
  minimizedTime: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  minimizedSkip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  minimizedSkipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
});
