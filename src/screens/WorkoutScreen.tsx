import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { HomeStackParamList } from '../navigation/AppNavigator';
import { getExerciseById, getExercisesByWorkout, getLastSessionSetsForExercise, upsertBodyWeightForDate } from '../db/database';
import SetRow from '../components/SetRow';
import RestTimer from '../components/RestTimer';
import ExerciseSubstituteModal from '../components/ExerciseSubstituteModal';
import BodyWeightLogModal from '../components/BodyWeightLogModal';
import { toLocalDateYmd } from '../utils/dateLocal';
import { WEIGHT_UNIT_HEADER } from '../constants/weightUnits';

type Nav = NativeStackNavigationProp<HomeStackParamList, 'Workout'>;

export default function WorkoutScreen() {
  const navigation = useNavigation<Nav>();
  const {
    activeSessionId,
    activeWorkoutId,
    activeWorkoutName,
    activeExercises,
    startWorkout,
    finishWorkout,
    abortWorkout,
    updateSet,
    completeSet,
    uncompleteSet,
    replaceActiveExercise,
  } = useWorkoutStore();

  const [previousSetsMap, setPreviousSetsMap] = useState<Record<number, any[]>>({});
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null);
  const [exerciseDetails, setExerciseDetails] = useState<Record<number, any>>({});
  const [substituteModalForIndex, setSubstituteModalForIndex] = useState<number | null>(null);
  const [bodyWeightModal, setBodyWeightModal] = useState(false);

  const activeExerciseIds = activeExercises.map((e) => e.exerciseId).join(',');

  useEffect(() => {
    if (!activeSessionId) {
      startWorkout();
    }
  }, []);

  useEffect(() => {
    if (!activeExerciseIds) return;
    const nextDetail: Record<number, any> = {};
    const nextPrev: Record<number, any[]> = {};
    for (const ae of activeExercises) {
      const row = getExerciseById(ae.exerciseId);
      if (row) nextDetail[ae.exerciseId] = row;
      nextPrev[ae.exerciseId] = getLastSessionSetsForExercise(ae.exerciseId);
    }
    setExerciseDetails(nextDetail);
    setPreviousSetsMap(nextPrev);
  }, [activeExerciseIds, activeExercises]);

  function handleStopWorkout() {
    Alert.alert(
      'Stop workout?',
      'Your in-progress session will be discarded. Logged sets are not saved until you finish a workout.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: () => {
            abortWorkout();
            navigation.goBack();
          },
        },
      ]
    );
  }

  function completeFinishFlow() {
    finishWorkout();
    navigation.goBack();
  }

  function handleFinish() {
    const totalCompleted = activeExercises.reduce(
      (sum, ex) => sum + ex.sets.filter((s) => s.completed).length,
      0
    );

    if (totalCompleted === 0) {
      Alert.alert('No Sets Logged', 'Log at least one set before finishing.', [
        { text: 'OK' },
      ]);
      return;
    }

    Alert.alert(
      'Finish Workout?',
      `You've logged ${totalCompleted} sets. You can log body weight next (optional).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish',
          onPress: () => setBodyWeightModal(true),
        },
      ]
    );
  }

  function getWorkingSetNumber(exerciseIndex: number, setIndex: number): number {
    const sets = activeExercises[exerciseIndex].sets;
    const warmupCount = sets.filter((s) => s.setType === 'warmup').length;
    return setIndex - warmupCount + 1;
  }

  if (activeExercises.length === 0) {
    return (
      <View style={[styles.container, styles.loading]}>
        <Text style={styles.loadingText}>Loading workout...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <RestTimer />

      {/* Header stats */}
      <View style={styles.headerBar}>
        <Text style={styles.workoutName}>{activeWorkoutName}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.stopButton} onPress={handleStopWorkout}>
            <Text style={styles.stopButtonText}>Stop</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.finishButton} onPress={handleFinish}>
            <Text style={styles.finishButtonText}>Finish</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {activeExercises.map((exercise, exerciseIndex) => {
          const detail = exerciseDetails[exercise.exerciseId];
          const prevSets = previousSetsMap[exercise.exerciseId] ?? [];
          const prevWorking = prevSets.filter((s: any) => s.set_type === 'working');
          const allCompleted = exercise.sets.every((s) => s.completed);
          const someCompleted = exercise.sets.some((s) => s.completed);
          const isExpanded = expandedExercise === exerciseIndex;

          return (
            <View key={`${exerciseIndex}-${exercise.exerciseId}`} style={[styles.exerciseCard, allCompleted && styles.exerciseCardDone]}>
              {/* Exercise header */}
              <TouchableOpacity
                style={styles.exerciseHeader}
                onPress={() => setExpandedExercise(isExpanded ? null : exerciseIndex)}
                activeOpacity={0.7}
              >
                <View style={styles.exerciseHeaderLeft}>
                  <View style={[styles.exerciseIndex, allCompleted && styles.exerciseIndexDone]}>
                    {allCompleted ? (
                      <Text style={styles.exerciseIndexDoneText}>✓</Text>
                    ) : (
                      <Text style={styles.exerciseIndexText}>{exerciseIndex + 1}</Text>
                    )}
                  </View>
                  <View style={styles.exerciseTitleArea}>
                    <Text style={[styles.exerciseName, allCompleted && styles.exerciseNameDone]}>
                      {exercise.exerciseName}
                    </Text>
                    {detail && (
                      <Text style={styles.exerciseMeta}>
                        {detail.warmup_sets > 0 ? `${detail.warmup_sets}W + ` : ''}{detail.working_sets} sets · {detail.target_reps} reps · RPE {detail.target_rpe}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.exerciseHeaderRight}>
                  <Text style={styles.muscleGroup}>{detail?.muscle_group}</Text>
                  <TouchableOpacity
                    style={styles.swapButton}
                    onPress={() => setSubstituteModalForIndex(exerciseIndex)}
                  >
                    <Text style={styles.swapButtonText}>Swap</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.infoButton}
                    onPress={() => {
                      const templateRow =
                        activeWorkoutId != null
                          ? getExercisesByWorkout(activeWorkoutId)[exerciseIndex]
                          : undefined;
                      const slotId =
                        exercise.slotTemplateExerciseId ?? templateRow?.id ?? exercise.exerciseId;
                      navigation.navigate('ExerciseDetail', {
                        exerciseId: exercise.exerciseId,
                        exerciseName: exercise.exerciseName,
                        programSlotTemplateExerciseId: slotId,
                      });
                    }}
                  >
                    <Text style={styles.infoButtonText}>Info</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>

              {/* Notes */}
              {detail?.notes ? (
                <View style={styles.notesRow}>
                  <Text style={styles.notesText} numberOfLines={2}>{detail.notes}</Text>
                </View>
              ) : null}

              {/* Column headers */}
              <View style={styles.columnHeaders}>
                <Text style={[styles.colHeader, { width: 30 }]}>SET</Text>
                <Text style={[styles.colHeader, { flex: 1, textAlign: 'center' }]}>PREV</Text>
                <Text style={[styles.colHeader, { width: 64, textAlign: 'center' }]}>{WEIGHT_UNIT_HEADER}</Text>
                <Text style={[styles.colHeader, { width: 64, textAlign: 'center' }]}>REPS</Text>
                <Text style={[styles.colHeader, { width: 48 }]}></Text>
              </View>

              {/* Sets */}
              {exercise.sets.map((setItem, setIndex) => {
                const isWorking = setItem.setType === 'working';
                const warmupCount = exercise.sets.filter((s) => s.setType === 'warmup').length;
                const workingIndex = isWorking ? setIndex - warmupCount : 0;
                const prevSet = isWorking && prevWorking[workingIndex] ? prevWorking[workingIndex] : null;

                return (
                  <SetRow
                    key={`${setIndex}-${setItem.propagationVersion}`}
                    set={setItem}
                    previousWeight={prevSet ? String(prevSet.weight) : undefined}
                    previousReps={prevSet ? String(prevSet.reps) : undefined}
                    onWeightChange={(v) => updateSet(exerciseIndex, setIndex, 'weight', v)}
                    onRepsChange={(v) => updateSet(exerciseIndex, setIndex, 'reps', v)}
                    onToggleComplete={() => {
                      if (setItem.completed) {
                        uncompleteSet(exerciseIndex, setIndex);
                      } else {
                        completeSet(exerciseIndex, setIndex, detail?.rest_seconds ?? 90);
                      }
                    }}
                  />
                );
              })}

              {/* Rest time indicator */}
              {detail?.rest_seconds > 0 && (
                <View style={styles.restIndicator}>
                  <Text style={styles.restIndicatorText}>
                    Rest {Math.floor(detail.rest_seconds / 60)}:{String(detail.rest_seconds % 60).padStart(2, '0')}
                  </Text>
                </View>
              )}
            </View>
          );
        })}

        <View style={{ height: 32 }} />
      </ScrollView>

      <ExerciseSubstituteModal
        visible={substituteModalForIndex !== null}
        title={
          substituteModalForIndex !== null
            ? `Substitute: ${activeExercises[substituteModalForIndex]?.exerciseName ?? ''}`
            : 'Substitute'
        }
        excludeExerciseId={
          substituteModalForIndex !== null
            ? activeExercises[substituteModalForIndex]?.exerciseId
            : undefined
        }
        onClose={() => setSubstituteModalForIndex(null)}
        onSelect={(newId) => {
          if (substituteModalForIndex === null) return;
          const idx = substituteModalForIndex;
          const hadCompleted = activeExercises[idx].sets.some((s) => s.completed);
          const run = () => replaceActiveExercise(idx, newId);
          if (hadCompleted) {
            Alert.alert(
              'Replace exercise?',
              'Completed sets for this exercise will be cleared.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Replace', style: 'destructive', onPress: run },
              ]
            );
          } else {
            run();
          }
        }}
      />

      <BodyWeightLogModal
        visible={bodyWeightModal}
        title="Body weight (optional)"
        initialDateYmd={toLocalDateYmd()}
        lockDate
        showSkip
        onClose={() => setBodyWeightModal(false)}
        onSkip={() => {
          setBodyWeightModal(false);
          completeFinishFlow();
        }}
        onSave={(dateYmd, lbs) => {
          upsertBodyWeightForDate(dateYmd, lbs);
          setBodyWeightModal(false);
          completeFinishFlow();
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textSecondary, fontSize: 16 },

  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  workoutName: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stopButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  stopButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  finishButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  finishButtonText: { color: '#000', fontSize: 14, fontWeight: '700' },

  scroll: { flex: 1 },

  exerciseCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  exerciseCardDone: {
    borderColor: colors.success + '44',
  },

  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  exerciseHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  exerciseIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  exerciseIndexDone: { backgroundColor: colors.success, borderColor: colors.success },
  exerciseIndexText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  exerciseIndexDoneText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  exerciseTitleArea: { flex: 1 },
  exerciseName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  exerciseNameDone: { color: colors.textSecondary },
  exerciseMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  exerciseHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muscleGroup: {
    color: colors.textTertiary,
    fontSize: 11,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  swapButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  swapButtonText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  infoButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoButtonText: { fontSize: 11, fontWeight: '600', color: colors.accent },

  notesRow: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    marginLeft: 38,
  },
  notesText: {
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },

  columnHeaders: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: colors.surfaceElevated,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  colHeader: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  restIndicator: {
    padding: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  restIndicatorText: { color: colors.textTertiary, fontSize: 12 },
});
