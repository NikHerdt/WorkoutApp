import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { HomeStackParamList } from '../navigation/AppNavigator';
import { useWorkoutStore } from '../store/useWorkoutStore';
import {
  getProgramById,
  getProgramDays,
  getProgramWorkouts,
  setProgramDayWorkout,
  createProgramWorkout,
  renameCustomProgram,
  getExercisesByWorkout,
  ProgramDayRow,
} from '../db/database';
import { AppInputModal } from '../components/AppModalDialogs';

type Route = RouteProp<HomeStackParamList, 'ProgramEdit'>;
type Nav = NativeStackNavigationProp<HomeStackParamList, 'ProgramEdit'>;

interface WorkoutOption {
  id: number;
  name: string;
  exerciseCount: number;
}

export default function ProgramEditScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { programId } = route.params;

  const [programName, setProgramName] = useState(route.params.programName);
  const [days, setDays] = useState<ProgramDayRow[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutOption[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [dayPickerIndex, setDayPickerIndex] = useState<number | null>(null);
  const [newWorkoutForDay, setNewWorkoutForDay] = useState<number | null>(null);

  const activeProgramId = useWorkoutStore((s) => s.activeProgramId);
  const isActiveProgram = activeProgramId === programId;

  const refresh = useCallback(() => {
    const program = getProgramById(programId);
    if (program) setProgramName(program.name);
    setDays(getProgramDays(programId));
    setWorkouts(
      (getProgramWorkouts(programId) as { id: number; name: string }[]).map((w) => ({
        id: w.id,
        name: w.name,
        exerciseCount: getExercisesByWorkout(w.id).length,
      }))
    );
  }, [programId]);

  useFocusEffect(refresh);

  function assignDay(dayIndex: number, workoutId: number | null) {
    setProgramDayWorkout(programId, dayIndex, workoutId);
    setDayPickerIndex(null);
    refresh();
    if (isActiveProgram) useWorkoutStore.getState().loadSettings();
  }

  function openWorkoutEditor(workoutId: number, workoutName: string) {
    navigation.navigate('EditWorkout', { workoutId, workoutName });
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Program name */}
        <TouchableOpacity style={styles.nameRow} onPress={() => setRenameOpen(true)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nameLabel}>PROGRAM NAME</Text>
            <Text style={styles.nameText}>{programName}</Text>
          </View>
          <Text style={styles.nameEdit}>Rename</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          Assign a workout (or rest) to each day of the 7-day cycle. Tap a day to change it,
          then use “Exercises” to build the workout. The same cycle repeats every week.
        </Text>

        {days.map((day) => {
          const isRest = day.workout_id == null;
          return (
            <View key={day.day_index} style={styles.dayCard}>
              <TouchableOpacity
                style={styles.dayMain}
                onPress={() => setDayPickerIndex(day.day_index)}
                activeOpacity={0.7}
              >
                <View style={styles.dayIndexBubble}>
                  <Text style={styles.dayIndexText}>{day.day_index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dayWorkoutName, isRest && styles.dayRestText]}>
                    {day.workout_name ?? 'Rest'}
                  </Text>
                  <Text style={styles.dayChangeHint}>Tap to change</Text>
                </View>
              </TouchableOpacity>
              {!isRest ? (
                <TouchableOpacity
                  style={styles.exercisesBtn}
                  onPress={() => openWorkoutEditor(day.workout_id!, day.workout_name ?? 'Workout')}
                >
                  <Text style={styles.exercisesBtnText}>Exercises</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}

        {/* Workouts in this program */}
        {workouts.length > 0 ? (
          <View style={styles.workoutsSection}>
            <Text style={styles.sectionTitle}>Workouts in this program</Text>
            {workouts.map((w) => (
              <TouchableOpacity
                key={w.id}
                style={styles.workoutRow}
                onPress={() => openWorkoutEditor(w.id, w.name)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.workoutRowName}>{w.name}</Text>
                  <Text style={styles.workoutRowMeta}>
                    {w.exerciseCount} exercise{w.exerciseCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text style={styles.workoutRowChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* Day assignment picker */}
      <Modal
        visible={dayPickerIndex !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setDayPickerIndex(null)}
      >
        <View style={styles.pickerOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDayPickerIndex(null)} />
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>
              Day {(dayPickerIndex ?? 0) + 1}
            </Text>
            <ScrollView style={{ maxHeight: 380 }}>
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => {
                  if (dayPickerIndex !== null) assignDay(dayPickerIndex, null);
                }}
              >
                <Text style={styles.pickerRowRest}>Rest day</Text>
              </TouchableOpacity>
              {workouts.map((w) => (
                <TouchableOpacity
                  key={w.id}
                  style={styles.pickerRow}
                  onPress={() => {
                    if (dayPickerIndex !== null) assignDay(dayPickerIndex, w.id);
                  }}
                >
                  <Text style={styles.pickerRowText}>{w.name}</Text>
                  <Text style={styles.pickerRowMeta}>
                    {w.exerciseCount} exercise{w.exerciseCount === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.pickerRow, styles.pickerRowNew]}
                onPress={() => {
                  setNewWorkoutForDay(dayPickerIndex);
                  setDayPickerIndex(null);
                }}
              >
                <Text style={styles.pickerRowNewText}>+ New workout…</Text>
              </TouchableOpacity>
            </ScrollView>
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setDayPickerIndex(null)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AppInputModal
        visible={newWorkoutForDay !== null}
        title="New workout"
        message="Name this workout (e.g. Upper A, Full Body 1). You can add exercises next."
        placeholder="Workout name"
        submitText="Create"
        onCancel={() => setNewWorkoutForDay(null)}
        onSubmit={(name) => {
          const dayIndex = newWorkoutForDay;
          setNewWorkoutForDay(null);
          const workoutId = createProgramWorkout(programId, name);
          if (dayIndex !== null) {
            assignDay(dayIndex, workoutId);
          } else {
            refresh();
          }
          openWorkoutEditor(workoutId, name);
        }}
      />

      <AppInputModal
        visible={renameOpen}
        title="Rename program"
        initialValue={programName}
        placeholder="Program name"
        onCancel={() => setRenameOpen(false)}
        onSubmit={(name) => {
          setRenameOpen(false);
          renameCustomProgram(programId, name);
          refresh();
          if (isActiveProgram) useWorkoutStore.getState().loadSettings();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 32 },

  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  nameLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  nameText: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
  nameEdit: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  hint: { color: colors.textTertiary, fontSize: 12, lineHeight: 17, marginBottom: 14 },

  dayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  dayMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayIndexBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayIndexText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  dayWorkoutName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  dayRestText: { color: colors.textTertiary, fontWeight: '500' },
  dayChangeHint: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  exercisesBtn: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  exercisesBtnText: { color: colors.accent, fontSize: 12, fontWeight: '700' },

  workoutsSection: { marginTop: 16 },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  workoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  workoutRowName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  workoutRowMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  workoutRowChevron: { color: colors.textTertiary, fontSize: 18 },

  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    zIndex: 1,
  },
  pickerTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 10 },
  pickerRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    marginBottom: 8,
  },
  pickerRowText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  pickerRowMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  pickerRowRest: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  pickerRowNew: { borderStyle: 'dashed' },
  pickerRowNewText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  pickerCancel: { marginTop: 4, paddingVertical: 12, alignItems: 'center' },
  pickerCancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
});
