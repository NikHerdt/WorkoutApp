import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { colors } from '../theme/colors';
import {
  getExercisesByWorkout,
  updateExerciseSetCounts,
  saveExercisesOrder,
} from '../db/database';
import type { HomeStackParamList } from '../navigation/AppNavigator';

type Route = RouteProp<HomeStackParamList, 'EditWorkout'>;

interface ExerciseRow {
  id: number;
  name: string;
  muscle_group: string;
  warmup_sets: number;
  working_sets: number;
  order_index: number;
}

export default function EditWorkoutScreen() {
  const route = useRoute<Route>();
  const { workoutId } = route.params;
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      const rows = getExercisesByWorkout(workoutId) as ExerciseRow[];
      setExercises(rows);
    }, [workoutId])
  );

  function adjustSets(
    exerciseId: number,
    field: 'warmup_sets' | 'working_sets',
    delta: number
  ) {
    setExercises((prev) => {
      const next = prev.map((ex) => {
        if (ex.id !== exerciseId) return ex;
        const updated = {
          ...ex,
          [field]: Math.max(field === 'working_sets' ? 1 : 0, ex[field] + delta),
        };
        updateExerciseSetCounts(updated.id, updated.warmup_sets, updated.working_sets);
        return updated;
      });
      return next;
    });
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setExercises((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      const reordered = next.map((ex, i) => ({ ...ex, order_index: i }));
      saveExercisesOrder(reordered.map((ex) => ({ id: ex.id, orderIndex: ex.order_index })));
      return reordered;
    });
  }

  function moveDown(index: number) {
    if (index === exercises.length - 1) return;
    setExercises((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      const reordered = next.map((ex, i) => ({ ...ex, order_index: i }));
      saveExercisesOrder(reordered.map((ex) => ({ id: ex.id, orderIndex: ex.order_index })));
      return reordered;
    });
  }

  if (exercises.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No exercises in this workout.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>
        Changes apply to future workouts. Drag order with the arrows. Tap +/- to adjust set counts.
      </Text>

      {exercises.map((ex, index) => (
        <View key={ex.id} style={styles.card}>
          {/* Order arrows */}
          <View style={styles.orderCol}>
            <TouchableOpacity
              style={[styles.arrowBtn, index === 0 && styles.arrowBtnDisabled]}
              onPress={() => moveUp(index)}
              disabled={index === 0}
            >
              <Text style={styles.arrowText}>▲</Text>
            </TouchableOpacity>
            <Text style={styles.orderNum}>{index + 1}</Text>
            <TouchableOpacity
              style={[styles.arrowBtn, index === exercises.length - 1 && styles.arrowBtnDisabled]}
              onPress={() => moveDown(index)}
              disabled={index === exercises.length - 1}
            >
              <Text style={styles.arrowText}>▼</Text>
            </TouchableOpacity>
          </View>

          {/* Exercise info + set counts */}
          <View style={styles.body}>
            <Text style={styles.exerciseName} numberOfLines={1}>
              {ex.name}
            </Text>
            <Text style={styles.muscleGroup}>{ex.muscle_group}</Text>

            <View style={styles.setRows}>
              {/* Warmup sets */}
              <View style={styles.setRow}>
                <Text style={styles.setLabel}>Warmup sets</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={[styles.stepBtn, ex.warmup_sets <= 0 && styles.stepBtnDisabled]}
                    onPress={() => adjustSets(ex.id, 'warmup_sets', -1)}
                    disabled={ex.warmup_sets <= 0}
                  >
                    <Text style={styles.stepBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepValue}>{ex.warmup_sets}</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => adjustSets(ex.id, 'warmup_sets', 1)}
                  >
                    <Text style={styles.stepBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Working sets */}
              <View style={styles.setRow}>
                <Text style={styles.setLabel}>Working sets</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={[styles.stepBtn, ex.working_sets <= 1 && styles.stepBtnDisabled]}
                    onPress={() => adjustSets(ex.id, 'working_sets', -1)}
                    disabled={ex.working_sets <= 1}
                  >
                    <Text style={styles.stepBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepValue}>{ex.working_sets}</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => adjustSets(ex.id, 'working_sets', 1)}
                  >
                    <Text style={styles.stepBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </View>
      ))}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16 },
  empty: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: 15 },

  hint: {
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16,
  },

  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },

  orderCol: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 4,
    backgroundColor: colors.surfaceElevated,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  arrowBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBtnDisabled: { opacity: 0.2 },
  arrowText: { color: colors.textSecondary, fontSize: 12 },
  orderNum: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 16,
    textAlign: 'center',
  },

  body: { flex: 1, padding: 12 },
  exerciseName: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  muscleGroup: {
    color: colors.textTertiary,
    fontSize: 11,
    marginBottom: 12,
  },

  setRows: { gap: 8 },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setLabel: { color: colors.textSecondary, fontSize: 13 },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  stepBtn: {
    width: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.25 },
  stepBtnText: { color: colors.text, fontSize: 18, fontWeight: '400', lineHeight: 22 },
  stepValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    minWidth: 28,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
});
