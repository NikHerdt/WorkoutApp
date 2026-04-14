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
} from '../utils/restTimerNotification';

export default function RestTimer() {
  const {
    restTimerActive,
    restTimerSeconds,
    restTimerTotal,
    stopRestTimer,
    tickRestTimer,
    syncRestTimer,
  } = useWorkoutStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(1)).current;
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Schedule / cancel notification and manage interval when timer toggles
  useEffect(() => {
    if (restTimerActive) {
      scheduleRestEndNotification(restTimerSeconds);

      intervalRef.current = setInterval(() => {
        tickRestTimer();
      }, 1000);

      Animated.timing(progressAnim, {
        toValue: 0,
        duration: restTimerSeconds * 1000,
        useNativeDriver: false,
      }).start();
    } else {
      cancelRestEndNotification();

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

  // When app comes back to foreground, resync the countdown from the stored end time
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (
        nextState === 'active' &&
        (prev === 'background' || prev === 'inactive') &&
        useWorkoutStore.getState().restTimerActive
      ) {
        syncRestTimer();

        // Restart the interval and re-sync animation from the corrected seconds value
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
    <Modal transparent animationType="slide" visible={restTimerActive}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.label}>REST TIMER</Text>
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
});
