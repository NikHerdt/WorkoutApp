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
import { resolveWeekRollover } from '../data/programWeeks';
import {
  buildWarmupPresets,
  parseWorkingRepsFromTarget,
  applyWarmupPresetsToIncompleteWarmups,
} from '../utils/warmupSets';

function renumberSets(sets: ActiveSet[]): ActiveSet[] {
  let warmupIdx = 0;
  let workingIdx = 0;
  const warmupCount = sets.filter((s) => s.setType === 'warmup').length;
  return sets.map((s) => {
    if (s.setType === 'warmup') {
      warmupIdx++;
      return { ...s, setNumber: warmupIdx };
    }
    workingIdx++;
    return { ...s, setNumber: warmupCount + workingIdx };
  });
}

function buildActiveExerciseState(
  exerciseId: number,
  slotTemplateExerciseId?: number
): ActiveExerciseState | null {
  const ex = getExerciseById(exerciseId);
  if (!ex) return null;

  const isTimed = String(ex.target_reps ?? '').includes('HOLD');
  const prevSets = getLastSessionSetsForExercise(ex.id);
  const lastWeight = prevSets.find((s: any) => s.set_type === 'working')?.weight ?? 0;
  const lastReps = prevSets.find((s: any) => s.set_type === 'working')?.reps ?? 0;
  const workingRepsForWarmups =
    lastReps > 0 ? lastReps : parseWorkingRepsFromTarget(ex.target_reps ?? '');
  const warmupPresets = buildWarmupPresets(lastWeight, workingRepsForWarmups, ex.warmup_sets, isTimed);

  const sets: ActiveSet[] = [];

  for (let i = 0; i < ex.warmup_sets; i++) {
    const preset = warmupPresets[i];
    sets.push({
      setNumber: i + 1,
      setType: 'warmup',
      weight: preset?.weight ?? '',
      reps:
        preset?.reps ??
        (isTimed ? (lastReps > 0 ? String(lastReps) : '30') : ''),
      completed: false,
      propagationVersion: 0,
    });
  }

  for (let i = 0; i < ex.working_sets; i++) {
    sets.push({
      setNumber: ex.warmup_sets + i + 1,
      setType: 'working',
      weight: lastWeight > 0 ? String(lastWeight) : '',
      reps: isTimed ? (lastReps > 0 ? String(lastReps) : '30') : (lastReps > 0 ? String(lastReps) : ''),
      completed: false,
      propagationVersion: 0,
    });
  }

  return {
    exerciseId: ex.id,
    exerciseName: ex.name,
    sets,
    isTimed,
    slotTemplateExerciseId: slotTemplateExerciseId ?? exerciseId,
  };
}

interface WorkoutState {
  // Schedule
  scheduleDay: number; // 0-6
  currentPhaseId: number;
  /** 1-based week within the current phase (Excel week count per phase). */
  phaseWeek: number;

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
  restTimerEnabled: boolean;
  restTimerActive: boolean;
  restTimerSeconds: number;
  restTimerTotal: number;
  /** Unix ms timestamp when the current rest period ends. Used to resync after backgrounding. */
  restTimerEndTime: number | null;

  // Actions
  loadSettings: () => void;
  getCurrentDayType: () => DayType;
  startWorkout: () => Promise<void>;
  finishWorkout: () => void;
  abortWorkout: () => void;
  skipRestDay: () => void;
  /** Set which day of the 7-day program cycle is "today" (0–6). Persists to settings. */
  setScheduleDay: (dayIndex: number) => void;
  /** Manual phase change resets to week 1 of that phase. */
  setPhase: (phaseId: number) => void;

  updateSet: (exerciseIndex: number, setIndex: number, field: 'weight' | 'reps', value: string) => void;
  completeSet: (exerciseIndex: number, setIndex: number, restSeconds: number) => void;
  uncompleteSet: (exerciseIndex: number, setIndex: number) => void;
  /** Appends a new set of the given type, inserted in order (warmups before working), pre-filled from the last set of that type. */
  addSet: (exerciseIndex: number, setType: 'warmup' | 'working') => void;
  /** Removes a set by index if it is uncompleted. No-op if only one set remains. */
  removeSet: (exerciseIndex: number, setIndex: number) => void;
  setPendingSubstitution: (templateExerciseId: number, replacementExerciseId: number | null) => void;
  replaceActiveExercise: (exerciseIndex: number, replacementExerciseId: number) => void;
  /** Appends an exercise to the active session by exercise id. */
  addExerciseToSession: (exerciseId: number) => void;
  /** Removes an exercise from the active session by index. Stops the rest timer. */
  removeExerciseFromSession: (exerciseIndex: number) => void;
  setRestTimerEnabled: (enabled: boolean) => void;
  startRestTimer: (seconds: number) => void;
  stopRestTimer: () => void;
  tickRestTimer: () => void;
  syncRestTimer: () => void;
}

export const useWorkoutStore = create<WorkoutState>((set, get) => ({
  scheduleDay: 0,
  currentPhaseId: 1,
  phaseWeek: 1,
  activeSessionId: null,
  activeWorkoutId: null,
  activeWorkoutName: '',
  activeDayType: null,
  activeExercises: [],
  pendingSubstitutions: {},
  restTimerEnabled: true,
  restTimerActive: false,
  restTimerSeconds: 0,
  restTimerTotal: 0,
  restTimerEndTime: null,

  loadSettings: () => {
    const dayStr = getSetting('schedule_day');
    const phaseStr = getSetting('current_phase_id');
    const weekStr = getSetting('phase_week');
    const restTimerEnabledStr = getSetting('rest_timer_enabled');
    const phaseId = phaseStr ? parseInt(phaseStr, 10) : 1;
    const week = weekStr ? parseInt(weekStr, 10) : 1;
    set({
      scheduleDay: dayStr ? parseInt(dayStr, 10) : 0,
      currentPhaseId: phaseId,
      phaseWeek: Number.isFinite(week) && week >= 1 ? week : 1,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(phaseId),
      restTimerEnabled: restTimerEnabledStr === null ? true : restTimerEnabledStr === '1',
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
      const built = buildActiveExerciseState(effectiveId, ex.id);
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
    const { activeSessionId, activeExercises, scheduleDay, currentPhaseId, phaseWeek } = get();
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

    const prevDay = scheduleDay;
    const newDay = (scheduleDay + 1) % 7;
    setSetting('schedule_day', String(newDay));

    let nextPhaseId = currentPhaseId;
    let nextPhaseWeek = phaseWeek;
    if (prevDay === 6 && newDay === 0) {
      const rolled = resolveWeekRollover(currentPhaseId, phaseWeek);
      nextPhaseId = rolled.currentPhaseId;
      nextPhaseWeek = rolled.phaseWeek;
      setSetting('current_phase_id', String(nextPhaseId));
      setSetting('phase_week', String(nextPhaseWeek));
    }

    set({
      activeSessionId: null,
      activeWorkoutId: null,
      activeWorkoutName: '',
      activeDayType: null,
      activeExercises: [],
      restTimerActive: false,
      restTimerEndTime: null,
      scheduleDay: newDay,
      currentPhaseId: nextPhaseId,
      phaseWeek: nextPhaseWeek,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(nextPhaseId),
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
      restTimerEndTime: null,
    });
  },

  skipRestDay: () => {
    const { scheduleDay, currentPhaseId, phaseWeek } = get();
    const prevDay = scheduleDay;
    const newDay = (scheduleDay + 1) % 7;
    setSetting('schedule_day', String(newDay));

    let nextPhaseId = currentPhaseId;
    let nextPhaseWeek = phaseWeek;
    if (prevDay === 6 && newDay === 0) {
      const rolled = resolveWeekRollover(currentPhaseId, phaseWeek);
      nextPhaseId = rolled.currentPhaseId;
      nextPhaseWeek = rolled.phaseWeek;
      setSetting('current_phase_id', String(nextPhaseId));
      setSetting('phase_week', String(nextPhaseWeek));
    }

    set({
      scheduleDay: newDay,
      currentPhaseId: nextPhaseId,
      phaseWeek: nextPhaseWeek,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(nextPhaseId),
    });
  },

  setScheduleDay: (dayIndex: number) => {
    const d = ((Math.floor(dayIndex) % 7) + 7) % 7;
    setSetting('schedule_day', String(d));
    set({ scheduleDay: d });
  },

  setPhase: (phaseId: number) => {
    setSetting('current_phase_id', String(phaseId));
    setSetting('phase_week', '1');
    set({
      currentPhaseId: phaseId,
      phaseWeek: 1,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(phaseId),
    });
  },

  updateSet: (exerciseIndex, setIndex, field, value) => {
    set((state) => {
      const exercises = [...state.activeExercises];
      const ex = exercises[exerciseIndex];
      const sets = [...ex.sets];
      sets[setIndex] = { ...sets[setIndex], [field]: value };

      const warmupCount = sets.filter((s) => s.setType === 'warmup').length;
      const firstWorkingIdx = warmupCount;
      if (
        warmupCount > 0 &&
        setIndex === firstWorkingIdx &&
        sets[setIndex]?.setType === 'working' &&
        (field === 'weight' || field === 'reps')
      ) {
        const dbEx = getExerciseById(ex.exerciseId);
        const synced = applyWarmupPresetsToIncompleteWarmups(
          sets,
          dbEx?.target_reps ?? '',
          ex.isTimed
        );
        exercises[exerciseIndex] = { ...ex, sets: synced };
      } else {
        exercises[exerciseIndex] = { ...ex, sets };
      }
      return { activeExercises: exercises };
    });
  },

  completeSet: (exerciseIndex, setIndex, restSeconds) => {
    set((state) => {
      const exercises = [...state.activeExercises];
      const sets = [...exercises[exerciseIndex].sets];
      const completedSet = sets[setIndex];
      sets[setIndex] = { ...completedSet, completed: true };

      // Propagate this set's weight and reps to the next uncompleted set of the same type.
      const nextIndex = sets.findIndex(
        (s, i) => i > setIndex && !s.completed && s.setType === completedSet.setType
      );
      if (nextIndex !== -1) {
        sets[nextIndex] = {
          ...sets[nextIndex],
          weight: completedSet.weight,
          reps: completedSet.reps,
          propagationVersion: (sets[nextIndex].propagationVersion ?? 0) + 1,
        };
      }

      exercises[exerciseIndex] = { ...exercises[exerciseIndex], sets };
      return { activeExercises: exercises };
    });

    if (restSeconds > 0 && get().restTimerEnabled) {
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

  addSet: (exerciseIndex, setType) => {
    set((state) => {
      const exercises = [...state.activeExercises];
      const ex = exercises[exerciseIndex];
      const sets = [...ex.sets];
      const sameType = sets.filter((s) => s.setType === setType);
      const lastSameType = sameType[sameType.length - 1];
      const newSet: ActiveSet = {
        setNumber: 0,
        setType,
        weight: lastSameType?.weight ?? '',
        reps: lastSameType?.reps ?? '',
        completed: false,
        propagationVersion: 0,
      };
      const warmupCount = sets.filter((s) => s.setType === 'warmup').length;
      const insertAt = setType === 'warmup' ? warmupCount : sets.length;
      const newSets = [...sets.slice(0, insertAt), newSet, ...sets.slice(insertAt)];
      const renumbered = renumberSets(newSets);
      const dbEx = getExerciseById(ex.exerciseId);
      exercises[exerciseIndex] = {
        ...ex,
        sets: applyWarmupPresetsToIncompleteWarmups(
          renumbered,
          dbEx?.target_reps ?? '',
          ex.isTimed
        ),
      };
      return { activeExercises: exercises };
    });
  },

  removeSet: (exerciseIndex, setIndex) => {
    set((state) => {
      const exercises = [...state.activeExercises];
      const ex = exercises[exerciseIndex];
      const sets = [...ex.sets];
      if (sets.length <= 1) return {};
      if (sets[setIndex]?.completed) return {};
      const newSets = sets.filter((_, i) => i !== setIndex);
      const renumbered = renumberSets(newSets);
      const dbEx = getExerciseById(ex.exerciseId);
      exercises[exerciseIndex] = {
        ...ex,
        sets: applyWarmupPresetsToIncompleteWarmups(
          renumbered,
          dbEx?.target_reps ?? '',
          ex.isTimed
        ),
      };
      return { activeExercises: exercises };
    });
  },

  addExerciseToSession: (exerciseId) => {
    const built = buildActiveExerciseState(exerciseId);
    if (!built) return;
    set((state) => ({ activeExercises: [...state.activeExercises, built] }));
  },

  removeExerciseFromSession: (exerciseIndex) => {
    get().stopRestTimer();
    set((state) => {
      const exercises = [...state.activeExercises];
      exercises.splice(exerciseIndex, 1);
      return { activeExercises: exercises };
    });
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
      const prev = exercises[exerciseIndex];
      const slotId = prev.slotTemplateExerciseId ?? prev.exerciseId;
      exercises[exerciseIndex] = { ...built, slotTemplateExerciseId: slotId };
      return { activeExercises: exercises };
    });
    get().stopRestTimer();
  },

  setRestTimerEnabled: (enabled) => {
    setSetting('rest_timer_enabled', enabled ? '1' : '0');
    set({ restTimerEnabled: enabled });
    if (!enabled) {
      set({ restTimerActive: false, restTimerSeconds: 0, restTimerTotal: 0, restTimerEndTime: null });
    }
  },

  startRestTimer: (seconds) => {
    set({
      restTimerActive: true,
      restTimerSeconds: seconds,
      restTimerTotal: seconds,
      restTimerEndTime: Date.now() + seconds * 1000,
    });
  },

  stopRestTimer: () => {
    set({ restTimerActive: false, restTimerSeconds: 0, restTimerTotal: 0, restTimerEndTime: null });
  },

  tickRestTimer: () => {
    set((state) => {
      if (state.restTimerSeconds <= 1) {
        return { restTimerActive: false, restTimerSeconds: 0, restTimerEndTime: null };
      }
      return { restTimerSeconds: state.restTimerSeconds - 1 };
    });
  },

  syncRestTimer: () => {
    const { restTimerEndTime, restTimerActive } = get();
    if (!restTimerActive || restTimerEndTime === null) return;
    const remaining = Math.ceil((restTimerEndTime - Date.now()) / 1000);
    if (remaining <= 0) {
      set({ restTimerActive: false, restTimerSeconds: 0, restTimerTotal: 0, restTimerEndTime: null });
    } else {
      set({ restTimerSeconds: remaining });
    }
  },
}));
