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
import { getWeekCountForPhase } from '../data/programWeeks';
import {
  buildWarmupPresets,
  parseWorkingRepsFromTarget,
  applyWarmupPresetsToIncompleteWarmups,
} from '../utils/warmupSets';
import { toLocalDateYmd } from '../utils/dateLocal';

function parseYmdLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

function addDaysLocal(ymd: string, deltaDays: number): string {
  const base = parseYmdLocal(ymd) ?? new Date();
  base.setDate(base.getDate() + deltaDays);
  return toLocalDateYmd(base);
}

function resolveProgramProgress(programStartYmd: string): {
  scheduleDay: number;
  currentPhaseId: number;
  phaseWeek: number;
} {
  const start = parseYmdLocal(programStartYmd) ?? new Date();
  const today = parseYmdLocal(toLocalDateYmd()) ?? new Date();
  const elapsedDays = Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000));
  const scheduleDay = elapsedDays % 7;
  const elapsedProgramWeeks = Math.floor(elapsedDays / 7);

  const phase1Weeks = getWeekCountForPhase(1);
  const phase2Weeks = getWeekCountForPhase(2);
  const phase3Weeks = getWeekCountForPhase(3);
  const totalProgramWeeks = Math.max(1, phase1Weeks + phase2Weeks + phase3Weeks);
  let cycleWeek = elapsedProgramWeeks % totalProgramWeeks;

  if (cycleWeek < phase1Weeks) {
    return { scheduleDay, currentPhaseId: 1, phaseWeek: cycleWeek + 1 };
  }
  cycleWeek -= phase1Weeks;

  if (cycleWeek < phase2Weeks) {
    return { scheduleDay, currentPhaseId: 2, phaseWeek: cycleWeek + 1 };
  }
  cycleWeek -= phase2Weeks;

  return { scheduleDay, currentPhaseId: 3, phaseWeek: cycleWeek + 1 };
}

function getCompletedWeeksBeforePhase(phaseId: number): number {
  if (phaseId <= 1) return 0;
  if (phaseId === 2) return getWeekCountForPhase(1);
  return getWeekCountForPhase(1) + getWeekCountForPhase(2);
}

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
  /** Local YYYY-MM-DD marking Day 1 / Week 1 / Phase 1 anchor date. */
  programStartDate: string;

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
  restTimerMinimized: boolean;
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
  setProgramStartDate: (ymd: string) => boolean;
  startRestTimer: (seconds: number) => void;
  stopRestTimer: () => void;
  setRestTimerMinimized: (minimized: boolean) => void;
  tickRestTimer: () => void;
  syncRestTimer: () => void;
}

export const useWorkoutStore = create<WorkoutState>((set, get) => ({
  scheduleDay: 0,
  currentPhaseId: 1,
  phaseWeek: 1,
  programStartDate: toLocalDateYmd(),
  activeSessionId: null,
  activeWorkoutId: null,
  activeWorkoutName: '',
  activeDayType: null,
  activeExercises: [],
  pendingSubstitutions: {},
  restTimerEnabled: true,
  restTimerActive: false,
  restTimerMinimized: false,
  restTimerSeconds: 0,
  restTimerTotal: 0,
  restTimerEndTime: null,

  loadSettings: () => {
    const restTimerEnabledStr = getSetting('rest_timer_enabled');
    const migrationV2Done = getSetting('program_start_date_migrated_v2') === '1';
    const legacyDayStr = getSetting('schedule_day');
    const legacyPhaseStr = getSetting('current_phase_id');
    const legacyWeekStr = getSetting('phase_week');
    const legacyDay = legacyDayStr ? parseInt(legacyDayStr, 10) : 0;
    const legacyPhase = legacyPhaseStr ? parseInt(legacyPhaseStr, 10) : 1;
    const legacyWeek = legacyWeekStr ? parseInt(legacyWeekStr, 10) : 1;
    const safeDay = Number.isFinite(legacyDay) ? ((legacyDay % 7) + 7) % 7 : 0;
    const safePhase = Number.isFinite(legacyPhase) ? Math.min(3, Math.max(1, legacyPhase)) : 1;
    const maxWeekInPhase = getWeekCountForPhase(safePhase);
    const safeWeek = Number.isFinite(legacyWeek)
      ? Math.min(maxWeekInPhase, Math.max(1, legacyWeek))
      : 1;
    const completedWeeksBeforeCurrentPhase = getCompletedWeeksBeforePhase(safePhase);
    const totalCompletedWeeks = completedWeeksBeforeCurrentPhase + (safeWeek - 1);
    const elapsedDays = totalCompletedWeeks * 7 + safeDay;
    const legacyDerivedStart = addDaysLocal(toLocalDateYmd(), -elapsedDays);

    let programStartDate = getSetting('program_start_date');
    if (!programStartDate) {
      programStartDate = legacyDerivedStart;
      setSetting('program_start_date', programStartDate);
      setSetting('program_start_date_migrated_v2', '1');
    } else if (!migrationV2Done) {
      // One-time correction for installs that got the initial day-only anchor migration.
      programStartDate = legacyDerivedStart;
      setSetting('program_start_date', programStartDate);
      setSetting('program_start_date_migrated_v2', '1');
    }
    const progress = resolveProgramProgress(programStartDate);
    set({
      scheduleDay: progress.scheduleDay,
      currentPhaseId: progress.currentPhaseId,
      phaseWeek: progress.phaseWeek,
      programStartDate,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(progress.currentPhaseId),
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
    const { activeSessionId, activeExercises } = get();
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

    set({
      activeSessionId: null,
      activeWorkoutId: null,
      activeWorkoutName: '',
      activeDayType: null,
      activeExercises: [],
      restTimerActive: false,
      restTimerMinimized: false,
      restTimerEndTime: null,
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
      restTimerMinimized: false,
      restTimerSeconds: 0,
      restTimerTotal: 0,
      restTimerEndTime: null,
    });
  },

  skipRestDay: () => {
    const { programStartDate } = get();
    const nextStart = addDaysLocal(programStartDate, -1);
    setSetting('program_start_date', nextStart);
    const progress = resolveProgramProgress(nextStart);
    set({
      scheduleDay: progress.scheduleDay,
      currentPhaseId: progress.currentPhaseId,
      phaseWeek: progress.phaseWeek,
      programStartDate: nextStart,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(progress.currentPhaseId),
    });
  },

  setScheduleDay: (dayIndex: number) => {
    const d = ((Math.floor(dayIndex) % 7) + 7) % 7;
    const currentDay = get().scheduleDay % 7;
    const delta = currentDay - d;
    const nextStart = addDaysLocal(get().programStartDate, delta);
    setSetting('program_start_date', nextStart);
    const progress = resolveProgramProgress(nextStart);
    set({
      scheduleDay: progress.scheduleDay,
      currentPhaseId: progress.currentPhaseId,
      phaseWeek: progress.phaseWeek,
      programStartDate: nextStart,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(progress.currentPhaseId),
    });
  },

  setPhase: (phaseId: number) => {
    const weekOffsetToPhaseStart =
      (phaseId <= 1 ? 0 : getWeekCountForPhase(1)) +
      (phaseId <= 2 ? 0 : getWeekCountForPhase(2));
    const today = toLocalDateYmd();
    const dayIndex = get().scheduleDay % 7;
    const start = addDaysLocal(today, -(weekOffsetToPhaseStart * 7 + dayIndex));
    setSetting('program_start_date', start);
    const progress = resolveProgramProgress(start);
    set({
      scheduleDay: progress.scheduleDay,
      currentPhaseId: progress.currentPhaseId,
      phaseWeek: progress.phaseWeek,
      programStartDate: start,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(progress.currentPhaseId),
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
    const stateBeforeComplete = get();
    const isTargetAlreadyCompleted =
      stateBeforeComplete.activeExercises[exerciseIndex]?.sets[setIndex]?.completed ?? false;
    const incompleteSetCount = stateBeforeComplete.activeExercises.reduce(
      (count, exercise) => count + exercise.sets.filter((s) => !s.completed).length,
      0
    );
    const isLastRemainingSet = !isTargetAlreadyCompleted && incompleteSetCount === 1;

    set((state) => {
      const exercises = [...state.activeExercises];
      const sets = [...exercises[exerciseIndex].sets];
      const completedSet = sets[setIndex];
      sets[setIndex] = { ...completedSet, completed: true };

      // Propagate weight/reps to the next uncompleted set only for working sets.
      // Warmup sets have pre-calculated presets and should not overwrite each other.
      if (completedSet.setType === 'working') {
        const nextIndex = sets.findIndex(
          (s, i) => i > setIndex && !s.completed && s.setType === 'working'
        );
        if (nextIndex !== -1) {
          sets[nextIndex] = {
            ...sets[nextIndex],
            weight: completedSet.weight,
            reps: completedSet.reps,
            propagationVersion: (sets[nextIndex].propagationVersion ?? 0) + 1,
          };
        }
      }

      exercises[exerciseIndex] = { ...exercises[exerciseIndex], sets };
      return { activeExercises: exercises };
    });

    if (restSeconds > 0 && get().restTimerEnabled && !isLastRemainingSet) {
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
      set({
        restTimerActive: false,
        restTimerMinimized: false,
        restTimerSeconds: 0,
        restTimerTotal: 0,
        restTimerEndTime: null,
      });
    }
  },

  setProgramStartDate: (ymd) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;

    const normalized = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const parsed = parseYmdLocal(normalized);
    if (!parsed || Number.isNaN(parsed.getTime())) return false;

    setSetting('program_start_date', normalized);
    setSetting('program_start_date_migrated_v2', '1');
    const progress = resolveProgramProgress(normalized);
    set({
      scheduleDay: progress.scheduleDay,
      currentPhaseId: progress.currentPhaseId,
      phaseWeek: progress.phaseWeek,
      programStartDate: normalized,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(progress.currentPhaseId),
    });
    return true;
  },

  startRestTimer: (seconds) => {
    set({
      restTimerActive: true,
      restTimerMinimized: false,
      restTimerSeconds: seconds,
      restTimerTotal: seconds,
      restTimerEndTime: Date.now() + seconds * 1000,
    });
  },

  stopRestTimer: () => {
    set({
      restTimerActive: false,
      restTimerMinimized: false,
      restTimerSeconds: 0,
      restTimerTotal: 0,
      restTimerEndTime: null,
    });
  },

  setRestTimerMinimized: (minimized) => {
    set({ restTimerMinimized: minimized });
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
