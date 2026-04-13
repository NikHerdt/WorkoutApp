import { create } from 'zustand';
import {
  getSetting,
  setSetting,
  getWorkoutByPhaseAndType,
  getExercisesByWorkout,
  createSession,
  completeSession,
  logSet,
  getLastSessionSetsForExercise,
  deleteIncompleteSession,
  getExerciseById,
  getPhaseSubstitutionsForPhase,
  upsertPhaseSubstitution,
} from '../db/database';
import { SCHEDULE, DayType, ActiveSet, ActiveExerciseState } from '../types';

function buildActiveExerciseState(exerciseId: number): ActiveExerciseState | null {
  const ex = getExerciseById(exerciseId);
  if (!ex) return null;

  const prevSets = getLastSessionSetsForExercise(ex.id);
  const lastWeight = prevSets.find((s: any) => s.set_type === 'working')?.weight ?? 0;
  const lastReps = prevSets.find((s: any) => s.set_type === 'working')?.reps ?? 0;

  const sets: ActiveSet[] = [];

  for (let i = 0; i < ex.warmup_sets; i++) {
    sets.push({
      setNumber: i + 1,
      setType: 'warmup',
      weight: lastWeight > 0 ? String(Math.round(lastWeight * 0.6)) : '',
      reps: String(ex.target_reps ?? '').includes('HOLD') ? '30' : '',
      completed: false,
    });
  }

  for (let i = 0; i < ex.working_sets; i++) {
    sets.push({
      setNumber: ex.warmup_sets + i + 1,
      setType: 'working',
      weight: lastWeight > 0 ? String(lastWeight) : '',
      reps: lastReps > 0 ? String(lastReps) : '',
      completed: false,
    });
  }

  return {
    exerciseId: ex.id,
    exerciseName: ex.name,
    sets,
  };
}

interface WorkoutState {
  // Schedule
  scheduleDay: number; // 0-6
  currentPhaseId: number;

  // Active workout session
  activeSessionId: number | null;
  activeWorkoutId: number | null;
  activeWorkoutName: string;
  activeDayType: DayType | null;
  activeExercises: ActiveExerciseState[];

  /**
   * Phase-wide template exercise id -> replacement id (persisted per phase).
   * Applied when starting a session; in-workout Swap does not change this map.
   */
  pendingSubstitutions: Record<number, number>;

  // Rest timer
  restTimerActive: boolean;
  restTimerSeconds: number;
  restTimerTotal: number;

  // Actions
  loadSettings: () => void;
  getCurrentDayType: () => DayType;
  startWorkout: () => Promise<void>;
  finishWorkout: () => void;
  abortWorkout: () => void;
  skipRestDay: () => void;
  setPhase: (phaseId: number) => void;

  updateSet: (exerciseIndex: number, setIndex: number, field: 'weight' | 'reps', value: string) => void;
  completeSet: (exerciseIndex: number, setIndex: number, restSeconds: number) => void;
  uncompleteSet: (exerciseIndex: number, setIndex: number) => void;
  setPendingSubstitution: (templateExerciseId: number, replacementExerciseId: number | null) => void;
  replaceActiveExercise: (exerciseIndex: number, replacementExerciseId: number) => void;
  startRestTimer: (seconds: number) => void;
  stopRestTimer: () => void;
  tickRestTimer: () => void;
}

export const useWorkoutStore = create<WorkoutState>((set, get) => ({
  scheduleDay: 0,
  currentPhaseId: 1,
  activeSessionId: null,
  activeWorkoutId: null,
  activeWorkoutName: '',
  activeDayType: null,
  activeExercises: [],
  pendingSubstitutions: {},
  restTimerActive: false,
  restTimerSeconds: 0,
  restTimerTotal: 0,

  loadSettings: () => {
    const dayStr = getSetting('schedule_day');
    const phaseStr = getSetting('current_phase_id');
    const phaseId = phaseStr ? parseInt(phaseStr, 10) : 1;
    set({
      scheduleDay: dayStr ? parseInt(dayStr, 10) : 0,
      currentPhaseId: phaseId,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(phaseId),
    });
  },

  getCurrentDayType: () => {
    const { scheduleDay } = get();
    return SCHEDULE[scheduleDay % 7];
  },

  startWorkout: async () => {
    const { currentPhaseId, activeSessionId, getCurrentDayType } = get();

    // Already have an active session
    if (activeSessionId) return;

    const dayType = getCurrentDayType();
    if (dayType === 'rest') return;

    const workout = getWorkoutByPhaseAndType(currentPhaseId, dayType);
    if (!workout) return;

    const exercises = getExercisesByWorkout(workout.id);
    const sessionId = createSession(workout.id, currentPhaseId);
    const { pendingSubstitutions } = get();

    const activeExercises: ActiveExerciseState[] = [];
    for (const ex of exercises) {
      const effectiveId = pendingSubstitutions[ex.id] ?? ex.id;
      const built = buildActiveExerciseState(effectiveId);
      if (built) activeExercises.push(built);
    }

    set({
      activeSessionId: sessionId,
      activeWorkoutId: workout.id,
      activeWorkoutName: workout.name,
      activeDayType: dayType,
      activeExercises,
    });
  },

  finishWorkout: () => {
    const { activeSessionId, activeExercises, scheduleDay } = get();
    if (!activeSessionId) return;

    // Log all completed sets
    for (const exercise of activeExercises) {
      for (const setItem of exercise.sets) {
        if (setItem.completed) {
          logSet(
            activeSessionId,
            exercise.exerciseId,
            setItem.setNumber,
            setItem.setType,
            parseFloat(setItem.weight) || 0,
            parseInt(setItem.reps) || 0
          );
        }
      }
    }

    completeSession(activeSessionId);

    const newDay = (scheduleDay + 1) % 7;
    setSetting('schedule_day', String(newDay));

    set({
      activeSessionId: null,
      activeWorkoutId: null,
      activeWorkoutName: '',
      activeDayType: null,
      activeExercises: [],
      restTimerActive: false,
      scheduleDay: newDay,
    });
  },

  abortWorkout: () => {
    const { activeSessionId } = get();
    if (activeSessionId) {
      deleteIncompleteSession(activeSessionId);
    }
    set({
      activeSessionId: null,
      activeWorkoutId: null,
      activeWorkoutName: '',
      activeDayType: null,
      activeExercises: [],
      restTimerActive: false,
      restTimerSeconds: 0,
      restTimerTotal: 0,
    });
  },

  skipRestDay: () => {
    const { scheduleDay } = get();
    const newDay = (scheduleDay + 1) % 7;
    setSetting('schedule_day', String(newDay));
    set({ scheduleDay: newDay });
  },

  setPhase: (phaseId: number) => {
    setSetting('current_phase_id', String(phaseId));
    set({
      currentPhaseId: phaseId,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(phaseId),
    });
  },

  updateSet: (exerciseIndex, setIndex, field, value) => {
    set((state) => {
      const exercises = [...state.activeExercises];
      const sets = [...exercises[exerciseIndex].sets];
      sets[setIndex] = { ...sets[setIndex], [field]: value };
      exercises[exerciseIndex] = { ...exercises[exerciseIndex], sets };
      return { activeExercises: exercises };
    });
  },

  completeSet: (exerciseIndex, setIndex, restSeconds) => {
    set((state) => {
      const exercises = [...state.activeExercises];
      const sets = [...exercises[exerciseIndex].sets];
      sets[setIndex] = { ...sets[setIndex], completed: true };
      exercises[exerciseIndex] = { ...exercises[exerciseIndex], sets };
      return { activeExercises: exercises };
    });

    if (restSeconds > 0) {
      get().startRestTimer(restSeconds);
    }
  },

  uncompleteSet: (exerciseIndex, setIndex) => {
    set((state) => {
      const exercises = [...state.activeExercises];
      const sets = [...exercises[exerciseIndex].sets];
      sets[setIndex] = { ...sets[setIndex], completed: false };
      exercises[exerciseIndex] = { ...exercises[exerciseIndex], sets };
      return { activeExercises: exercises };
    });
    get().stopRestTimer();
  },

  setPendingSubstitution: (templateExerciseId, replacementExerciseId) => {
    const phaseId = get().currentPhaseId;
    const phaseMap = upsertPhaseSubstitution(phaseId, templateExerciseId, replacementExerciseId);
    set({ pendingSubstitutions: { ...phaseMap } });
  },

  replaceActiveExercise: (exerciseIndex, replacementExerciseId) => {
    const built = buildActiveExerciseState(replacementExerciseId);
    if (!built) return;
    set((state) => {
      const exercises = [...state.activeExercises];
      exercises[exerciseIndex] = built;
      return { activeExercises: exercises };
    });
    get().stopRestTimer();
  },

  startRestTimer: (seconds) => {
    set({ restTimerActive: true, restTimerSeconds: seconds, restTimerTotal: seconds });
  },

  stopRestTimer: () => {
    set({ restTimerActive: false, restTimerSeconds: 0, restTimerTotal: 0 });
  },

  tickRestTimer: () => {
    set((state) => {
      if (state.restTimerSeconds <= 1) {
        return { restTimerActive: false, restTimerSeconds: 0 };
      }
      return { restTimerSeconds: state.restTimerSeconds - 1 };
    });
  },
}));
