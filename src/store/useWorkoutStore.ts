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
  isIncompleteSession,
  getExerciseById,
  getPhaseSubstitutionsForPhase,
  upsertPhaseSubstitution,
  getSavedWarmupPresets,
  saveWarmupPresets,
  clearSavedWarmupPresets,
  getActiveProgram,
  getProgramDays,
  setActiveProgramId,
  getWorkoutById,
  getExerciseTracksBrand,
  getExerciseSelectedBrand,
  setExerciseSelectedBrand,
  addMachineBrand,
  ProgramDayRow,
} from '../db/database';
import { backupToCloudSilently } from '../services/cloudBackup';
import { SCHEDULE, DayType, ActiveSet, ActiveExerciseState } from '../types';
import { getWeekCountForPhase } from '../data/programWeeks';
import {
  parseWorkingRepsFromTarget,
  applyWarmupPresetsToIncompleteWarmups,
  resolveInitialWarmupPresets,
  extractWarmupPresetsFromSets,
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

/** ISO YYYY-MM-DD lexicographic compare. */
function compareYmd(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * After finish/skip-rest we shift programStart back one day so the schedule advances immediately.
 * When the calendar moves to the next local day, `today - start` would otherwise grow by two;
 * undo that one artificial shift once we've left that calendar day.
 */
const SCHEDULE_EXPLICIT_ADVANCE_YMD_KEY = 'schedule_explicit_advance_ymd';
const ACTIVE_WORKOUT_STATE_KEY = 'active_workout_state_v1';
const EMPTY_PROGRAM_DAYS: ProgramDayRow[] = [];

type PersistedActiveWorkoutState = {
  activeSessionId: number;
  activeWorkoutId: number | null;
  activeWorkoutName: string;
  activeDayType: DayType | null;
  activeExercises: ActiveExerciseState[];
  restTimerActive: boolean;
  restTimerMinimized: boolean;
  restTimerSeconds: number;
  restTimerTotal: number;
  restTimerEndTime: number | null;
};

function readPersistedActiveWorkoutState(): PersistedActiveWorkoutState | null {
  const raw = getSetting(ACTIVE_WORKOUT_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedActiveWorkoutState;
    if (!parsed || !Number.isFinite(parsed.activeSessionId) || parsed.activeSessionId <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistActiveWorkoutState(state: WorkoutState): void {
  if (!state.activeSessionId) {
    setSetting(ACTIVE_WORKOUT_STATE_KEY, '');
    return;
  }
  const payload: PersistedActiveWorkoutState = {
    activeSessionId: state.activeSessionId,
    activeWorkoutId: state.activeWorkoutId,
    activeWorkoutName: state.activeWorkoutName,
    activeDayType: state.activeDayType,
    activeExercises: state.activeExercises,
    restTimerActive: state.restTimerActive,
    restTimerMinimized: state.restTimerMinimized,
    restTimerSeconds: state.restTimerSeconds,
    restTimerTotal: state.restTimerTotal,
    restTimerEndTime: state.restTimerEndTime,
  };
  setSetting(ACTIVE_WORKOUT_STATE_KEY, JSON.stringify(payload));
}

function maybeUndoExplicitScheduleAdvance(programStartDate: string): string {
  const explicit = getSetting(SCHEDULE_EXPLICIT_ADVANCE_YMD_KEY);
  if (!explicit) return programStartDate;
  const today = toLocalDateYmd();
  if (compareYmd(today, explicit) <= 0) return programStartDate;
  const restored = addDaysLocal(programStartDate, 1);
  setSetting(SCHEDULE_EXPLICIT_ADVANCE_YMD_KEY, '');
  setSetting('program_start_date', restored);
  return restored;
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

/**
 * State fields to apply after the schedule anchor moves. The builtin plan derives
 * phase/week from the calendar; a custom program keeps its own phase and has no weeks.
 */
function progressStateUpdate(
  progress: { scheduleDay: number; currentPhaseId: number; phaseWeek: number },
  programStartDate: string,
  isBuiltinProgram: boolean
): Partial<WorkoutState> {
  if (isBuiltinProgram) {
    return {
      scheduleDay: progress.scheduleDay,
      currentPhaseId: progress.currentPhaseId,
      phaseWeek: progress.phaseWeek,
      programStartDate,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(progress.currentPhaseId),
    };
  }
  return { scheduleDay: progress.scheduleDay, programStartDate };
}

function getCompletedWeeksBeforePhase(phaseId: number): number {
  if (phaseId <= 1) return 0;
  if (phaseId === 2) return getWeekCountForPhase(1);
  return getWeekCountForPhase(1) + getWeekCountForPhase(2);
}

function persistWarmupPresetsForExercise(
  exerciseId: number,
  sets: ActiveSet[],
  brand?: string | null
): void {
  const presets = extractWarmupPresetsFromSets(sets);
  if (presets.length === 0) return;
  if (presets.some((p) => String(p.weight ?? '').trim() !== '')) {
    saveWarmupPresets(exerciseId, presets, brand);
  } else {
    clearSavedWarmupPresets(exerciseId, brand);
  }
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

/** Programming a workout slot may override for one day. */
export interface SlotProgramming {
  warmup_sets?: number | null;
  working_sets?: number | null;
  target_reps?: string | null;
  target_rpe?: string | null;
  rest_seconds?: number | null;
}

function buildActiveExerciseState(
  exerciseId: number,
  slotTemplateExerciseId?: number,
  brandOverride?: string | null,
  slot?: SlotProgramming
): ActiveExerciseState | null {
  const base = getExerciseById(exerciseId);
  if (!base) return null;

  // Effective programming: the day's slot wins over the exercise's defaults, so
  // a shared exercise still honours each program's prescription.
  const ex = {
    ...base,
    warmup_sets: slot?.warmup_sets ?? base.warmup_sets,
    working_sets: slot?.working_sets ?? base.working_sets,
    target_reps: slot?.target_reps ?? base.target_reps,
    target_rpe: slot?.target_rpe ?? base.target_rpe,
    rest_seconds: slot?.rest_seconds ?? base.rest_seconds,
  };

  const tracksBrand = getExerciseTracksBrand(ex.id, ex.name);
  const machineBrand = tracksBrand
    ? brandOverride !== undefined
      ? brandOverride
      : getExerciseSelectedBrand(ex.id)
    : null;
  // Silo history/presets by brand only when tracking is on; otherwise ignore brand.
  const brandFilter = tracksBrand ? machineBrand : undefined;

  const isTimed = String(ex.target_reps ?? '').includes('HOLD');
  const prevSets = getLastSessionSetsForExercise(ex.id, brandFilter);
  const prevWorking = prevSets.filter((s: any) => s.set_type === 'working');
  const prevWarmup = prevSets.filter((s: any) => s.set_type === 'warmup');
  const firstWorkingHist = prevWorking[0];
  const lastWorkingHist = prevWorking[prevWorking.length - 1];
  const lastWeight = Number(firstWorkingHist?.weight) || 0;
  const lastReps = Number(firstWorkingHist?.reps) || 0;
  const workingRepsForWarmups =
    lastReps > 0 ? lastReps : parseWorkingRepsFromTarget(ex.target_reps ?? '');
  const warmupPresets = resolveInitialWarmupPresets(
    getSavedWarmupPresets(ex.id, brandFilter),
    prevWarmup,
    lastWeight,
    workingRepsForWarmups,
    ex.warmup_sets,
    isTimed
  );

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
      completedAtMs: null,
    });
  }

  for (let i = 0; i < ex.working_sets; i++) {
    const hist =
      prevWorking.length > 0 ? prevWorking[i] ?? lastWorkingHist : undefined;
    const wNum = hist != null ? Number(hist.weight) || 0 : 0;
    const rNum = hist != null ? Number(hist.reps) || 0 : 0;
    sets.push({
      setNumber: ex.warmup_sets + i + 1,
      setType: 'working',
      weight: wNum > 0 ? String(wNum) : '',
      reps: isTimed
        ? rNum > 0
          ? String(rNum)
          : '30'
        : rNum > 0
          ? String(rNum)
          : '',
      completed: false,
      propagationVersion: 0,
      completedAtMs: null,
    });
  }

  return {
    exerciseId: ex.id,
    exerciseName: ex.name,
    sets,
    isTimed,
    slotTemplateExerciseId: slotTemplateExerciseId ?? exerciseId,
    tracksBrand,
    machineBrand,
    warmupSets: ex.warmup_sets,
    workingSets: ex.working_sets,
    targetReps: String(ex.target_reps ?? ''),
    targetRpe: String(ex.target_rpe ?? ''),
    restSeconds: Number(ex.rest_seconds ?? 90),
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

  // Active program (builtin PPL×UL plan or a user-created regimen)
  activeProgramId: number | null;
  activeProgramIsBuiltin: boolean;
  activeProgramName: string;
  /** 7-day cycle for a custom program (empty for the builtin plan). */
  programDays: ProgramDayRow[];

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
  /**
   * Incremented every time a rest timer starts. Lets the timer UI notice a
   * restart that happens while a timer is already running (completing another
   * set) and cancel/reschedule instead of overlapping the previous one.
   */
  restTimerRunId: number;

  // Actions
  loadSettings: () => void;
  getCurrentDayType: () => DayType;
  /** Today's workout for the active program (builtin or custom). Null on rest days. */
  getTodayWorkout: () => { id: number; name: string } | null;
  /** Switch the active program. Refused (returns false) while a workout is in progress. */
  setActiveProgram: (programId: number) => boolean;
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
  /** Change the machine brand for an active exercise, re-filling its sets from that brand's history. */
  setMachineBrand: (exerciseIndex: number, brand: string | null) => void;
  /** Re-read brand-tracking settings for the active session's exercises (after toggling one). */
  refreshBrandTrackingForSession: () => void;
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
  activeProgramId: null,
  activeProgramIsBuiltin: true,
  activeProgramName: '',
  programDays: EMPTY_PROGRAM_DAYS,
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
  restTimerRunId: 0,

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
    programStartDate = maybeUndoExplicitScheduleAdvance(programStartDate);
    const progress = resolveProgramProgress(programStartDate);
    const nextState: Partial<WorkoutState> = {
      scheduleDay: progress.scheduleDay,
      currentPhaseId: progress.currentPhaseId,
      phaseWeek: progress.phaseWeek,
      programStartDate,
      pendingSubstitutions: getPhaseSubstitutionsForPhase(progress.currentPhaseId),
      restTimerEnabled: restTimerEnabledStr === null ? true : restTimerEnabledStr === '1',
    };

    const program = getActiveProgram();
    nextState.activeProgramId = program.id;
    nextState.activeProgramIsBuiltin = !!program.is_builtin;
    nextState.activeProgramName = program.name;
    if (program.is_builtin) {
      // Stable reference so callbacks depending on programDays don't churn every loadSettings() call.
      nextState.programDays = EMPTY_PROGRAM_DAYS;
    } else {
      // Custom programs have a fixed phase and no week progression.
      nextState.programDays = getProgramDays(program.id);
      if (program.phase_id != null) {
        nextState.currentPhaseId = program.phase_id;
        nextState.pendingSubstitutions = getPhaseSubstitutionsForPhase(program.phase_id);
      }
      nextState.phaseWeek = 1;
    }

    const persisted = readPersistedActiveWorkoutState();
    if (persisted && isIncompleteSession(persisted.activeSessionId)) {
      nextState.activeSessionId = persisted.activeSessionId;
      nextState.activeWorkoutId = persisted.activeWorkoutId;
      nextState.activeWorkoutName = persisted.activeWorkoutName;
      nextState.activeDayType = persisted.activeDayType;
      // A session persisted by an older build predates the effective-programming
      // fields; backfill from the catalog so resuming can't break the rest timer.
      nextState.activeExercises = (persisted.activeExercises ?? []).map((ex) => {
        if (ex && typeof (ex as any).restSeconds === 'number') return ex;
        const base = getExerciseById(ex.exerciseId);
        const warmupCount = ex.sets?.filter((s) => s.setType === 'warmup').length ?? 0;
        const workingCount = ex.sets?.filter((s) => s.setType === 'working').length ?? 0;
        return {
          ...ex,
          warmupSets: warmupCount,
          workingSets: Math.max(1, workingCount),
          targetReps: String(base?.target_reps ?? ''),
          targetRpe: String(base?.target_rpe ?? ''),
          restSeconds: Number(base?.rest_seconds ?? 90),
        };
      });
      nextState.restTimerActive = persisted.restTimerActive;
      nextState.restTimerMinimized = persisted.restTimerMinimized;
      nextState.restTimerSeconds = persisted.restTimerSeconds;
      nextState.restTimerTotal = persisted.restTimerTotal;
      nextState.restTimerEndTime = persisted.restTimerEndTime;
    } else if (persisted) {
      setSetting(ACTIVE_WORKOUT_STATE_KEY, '');
    }

    set(nextState);
  },

  getCurrentDayType: () => {
    const { scheduleDay, activeProgramIsBuiltin, programDays } = get();
    if (!activeProgramIsBuiltin) {
      return programDays[scheduleDay % 7]?.workout_id != null ? SCHEDULE[0] : 'rest';
    }
    return SCHEDULE[scheduleDay % 7];
  },

  getTodayWorkout: () => {
    const { scheduleDay, currentPhaseId, activeProgramIsBuiltin, programDays } = get();
    if (!activeProgramIsBuiltin) {
      const workoutId = programDays[scheduleDay % 7]?.workout_id;
      if (workoutId == null) return null;
      const workout = getWorkoutById(workoutId);
      return workout ? { id: workout.id, name: workout.name } : null;
    }
    const dayType = SCHEDULE[scheduleDay % 7];
    if (dayType === 'rest') return null;
    const workout = getWorkoutByPhaseAndType(currentPhaseId, dayType);
    return workout ? { id: workout.id, name: workout.name } : null;
  },

  setActiveProgram: (programId) => {
    if (get().activeSessionId) return false;
    setActiveProgramId(programId);
    get().loadSettings();
    return true;
  },

  startWorkout: async () => {
    const { activeSessionId, activeProgramIsBuiltin, getTodayWorkout, getCurrentDayType } = get();

    // Already have an active session
    if (activeSessionId) return;

    const today = getTodayWorkout();
    if (!today) return;

    const workout = getWorkoutById(today.id);
    if (!workout) return;
    const dayType = activeProgramIsBuiltin ? getCurrentDayType() : null;
    const currentPhaseId = activeProgramIsBuiltin ? get().currentPhaseId : workout.phase_id;

    const exercises = getExercisesByWorkout(workout.id);
    const sessionId = createSession(workout.id, currentPhaseId);
    const { pendingSubstitutions } = get();

    const activeExercises: ActiveExerciseState[] = [];
    for (const ex of exercises) {
      const effectiveId = pendingSubstitutions[ex.id] ?? ex.id;
      const built = buildActiveExerciseState(effectiveId, ex.id, undefined, ex);
      if (built) activeExercises.push(built);
    }

    set({
      activeSessionId: sessionId,
      activeWorkoutId: workout.id,
      activeWorkoutName: workout.name,
      activeDayType: dayType,
      activeExercises,
    });
    persistActiveWorkoutState(get());
  },

  finishWorkout: () => {
    const { activeSessionId, activeExercises } = get();
    if (!activeSessionId) return;

    // Log all completed sets in session exercise order, carrying the live
    // completion stamps so the gap between two sets of an exercise survives.
    activeExercises.forEach((exercise, exerciseOrder) => {
      const brand = exercise.tracksBrand ? exercise.machineBrand : null;
      const completed = exercise.sets.filter((s) => s.completed);
      // Order by when they were actually done, not by row order: sets can be
      // ticked out of order, and the gap only means anything in real time.
      const inCompletionOrder = [...completed].sort(
        (a, b) => (a.completedAtMs ?? 0) - (b.completedAtMs ?? 0)
      );
      const restBySet = new Map<ActiveSet, number | null>();
      for (let i = 0; i < inCompletionOrder.length; i++) {
        const current = inCompletionOrder[i];
        const previous = i > 0 ? inCompletionOrder[i - 1] : null;
        const gapMs =
          previous?.completedAtMs != null && current.completedAtMs != null
            ? current.completedAtMs - previous.completedAtMs
            : null;
        restBySet.set(current, gapMs != null && gapMs > 0 ? Math.round(gapMs / 1000) : null);
      }

      for (const setItem of completed) {
        logSet(
          activeSessionId,
          exercise.exerciseId,
          exerciseOrder,
          setItem.setNumber,
          setItem.setType,
          parseFloat(setItem.weight) || 0,
          parseInt(setItem.reps) || 0,
          undefined,
          brand,
          setItem.completedAtMs,
          restBySet.get(setItem) ?? null
        );
      }
    });

    completeSession(activeSessionId);

    for (const exercise of activeExercises) {
      persistWarmupPresetsForExercise(
        exercise.exerciseId,
        exercise.sets,
        exercise.tracksBrand ? exercise.machineBrand : undefined
      );
    }

    let programStartDate = get().programStartDate;
    programStartDate = maybeUndoExplicitScheduleAdvance(programStartDate);
    const bumpedStart = addDaysLocal(programStartDate, -1);
    setSetting('program_start_date', bumpedStart);
    setSetting(SCHEDULE_EXPLICIT_ADVANCE_YMD_KEY, toLocalDateYmd());
    const progress = resolveProgramProgress(bumpedStart);

    set({
      activeSessionId: null,
      activeWorkoutId: null,
      activeWorkoutName: '',
      activeDayType: null,
      activeExercises: [],
      restTimerActive: false,
      restTimerMinimized: false,
      restTimerEndTime: null,
      ...progressStateUpdate(progress, bumpedStart, get().activeProgramIsBuiltin),
    });
    persistActiveWorkoutState(get());
    backupToCloudSilently();
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
    persistActiveWorkoutState(get());
  },

  skipRestDay: () => {
    let { programStartDate } = get();
    programStartDate = maybeUndoExplicitScheduleAdvance(programStartDate);
    const nextStart = addDaysLocal(programStartDate, -1);
    setSetting('program_start_date', nextStart);
    setSetting(SCHEDULE_EXPLICIT_ADVANCE_YMD_KEY, toLocalDateYmd());
    const progress = resolveProgramProgress(nextStart);
    set(progressStateUpdate(progress, nextStart, get().activeProgramIsBuiltin));
  },

  setScheduleDay: (dayIndex: number) => {
    const d = ((Math.floor(dayIndex) % 7) + 7) % 7;
    const currentDay = get().scheduleDay % 7;
    const delta = currentDay - d;
    const nextStart = addDaysLocal(get().programStartDate, delta);
    setSetting(SCHEDULE_EXPLICIT_ADVANCE_YMD_KEY, '');
    setSetting('program_start_date', nextStart);
    const progress = resolveProgramProgress(nextStart);
    set(progressStateUpdate(progress, nextStart, get().activeProgramIsBuiltin));
  },

  setPhase: (phaseId: number) => {
    if (!get().activeProgramIsBuiltin) return;
    const weekOffsetToPhaseStart =
      (phaseId <= 1 ? 0 : getWeekCountForPhase(1)) +
      (phaseId <= 2 ? 0 : getWeekCountForPhase(2));
    const today = toLocalDateYmd();
    const dayIndex = get().scheduleDay % 7;
    const start = addDaysLocal(today, -(weekOffsetToPhaseStart * 7 + dayIndex));
    setSetting(SCHEDULE_EXPLICIT_ADVANCE_YMD_KEY, '');
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
        const synced = applyWarmupPresetsToIncompleteWarmups(
          sets,
          ex.targetReps,
          ex.isTimed
        );
        exercises[exerciseIndex] = { ...ex, sets: synced };
      } else {
        exercises[exerciseIndex] = { ...ex, sets };
      }
      return { activeExercises: exercises };
    });
    const updated = get().activeExercises[exerciseIndex];
    if (updated) {
      const changedSet = updated.sets[setIndex];
      if (changedSet?.setType === 'warmup' && (field === 'weight' || field === 'reps')) {
        persistWarmupPresetsForExercise(
          updated.exerciseId,
          updated.sets,
          updated.tracksBrand ? updated.machineBrand : undefined
        );
      }
    }
    persistActiveWorkoutState(get());
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
      // Stamped live: sets aren't written to the DB until the workout is
      // finished, so this is the only record of when the set actually happened
      // and the basis for measuring the gap to the next one.
      sets[setIndex] = { ...completedSet, completed: true, completedAtMs: Date.now() };

      // Propagate weight/reps to the next uncompleted set only for working sets.
      // Warmup sets have pre-calculated presets and should not overwrite each other.
      if (completedSet.setType === 'working') {
        const nextIndex = sets.findIndex(
          (s, i) => i > setIndex && !s.completed && s.setType === 'working'
        );
        if (nextIndex !== -1) {
          const next = sets[nextIndex];
          const nextWeightEmpty = String(next.weight ?? '').trim() === '';
          const nextRepsEmpty = String(next.reps ?? '').trim() === '';
          const newWeight = nextWeightEmpty ? completedSet.weight : next.weight;
          const newReps = nextRepsEmpty ? completedSet.reps : next.reps;
          const changed = newWeight !== next.weight || newReps !== next.reps;
          sets[nextIndex] = {
            ...next,
            weight: newWeight,
            reps: newReps,
            propagationVersion: changed
              ? (next.propagationVersion ?? 0) + 1
              : next.propagationVersion ?? 0,
          };
        }
      }

      exercises[exerciseIndex] = { ...exercises[exerciseIndex], sets };
      return { activeExercises: exercises };
    });
    persistActiveWorkoutState(get());

    if (restSeconds > 0 && get().restTimerEnabled && !isLastRemainingSet) {
      get().startRestTimer(restSeconds);
    }
  },

  uncompleteSet: (exerciseIndex, setIndex) => {
    set((state) => {
      const exercises = [...state.activeExercises];
      const sets = [...exercises[exerciseIndex].sets];
      sets[setIndex] = { ...sets[setIndex], completed: false, completedAtMs: null };
      exercises[exerciseIndex] = { ...exercises[exerciseIndex], sets };
      return { activeExercises: exercises };
    });
    persistActiveWorkoutState(get());
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
        completedAtMs: null,
      };
      const warmupCount = sets.filter((s) => s.setType === 'warmup').length;
      const insertAt = setType === 'warmup' ? warmupCount : sets.length;
      const newSets = [...sets.slice(0, insertAt), newSet, ...sets.slice(insertAt)];
      const renumbered = renumberSets(newSets);
      exercises[exerciseIndex] = {
        ...ex,
        sets: applyWarmupPresetsToIncompleteWarmups(renumbered, ex.targetReps, ex.isTimed),
      };
      return { activeExercises: exercises };
    });
    persistActiveWorkoutState(get());
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
      exercises[exerciseIndex] = {
        ...ex,
        sets: applyWarmupPresetsToIncompleteWarmups(renumbered, ex.targetReps, ex.isTimed),
      };
      return { activeExercises: exercises };
    });
    persistActiveWorkoutState(get());
  },

  addExerciseToSession: (exerciseId) => {
    const built = buildActiveExerciseState(exerciseId);
    if (!built) return;
    set((state) => ({ activeExercises: [...state.activeExercises, built] }));
    persistActiveWorkoutState(get());
  },

  removeExerciseFromSession: (exerciseIndex) => {
    // The rest timer is global (not tied to an exercise), so keep it running
    // when an exercise is removed mid-session.
    set((state) => {
      const exercises = [...state.activeExercises];
      exercises.splice(exerciseIndex, 1);
      return { activeExercises: exercises };
    });
    persistActiveWorkoutState(get());
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
    persistActiveWorkoutState(get());
  },

  setMachineBrand: (exerciseIndex, brand) => {
    const current = get().activeExercises[exerciseIndex];
    if (!current || !current.tracksBrand) return;
    const normalized = brand && brand.trim() !== '' ? brand.trim() : null;
    if (normalized === current.machineBrand) return;

    // Remember this brand as the exercise default and add it to the global list.
    setExerciseSelectedBrand(current.exerciseId, normalized);
    if (normalized) addMachineBrand(normalized);

    // Re-fill from the selected brand's history. Sets already logged this
    // session are kept; only not-yet-completed sets adopt the new prefill.
    const rebuilt = buildActiveExerciseState(
      current.exerciseId,
      current.slotTemplateExerciseId,
      normalized,
      {
        warmup_sets: current.warmupSets,
        working_sets: current.workingSets,
        target_reps: current.targetReps,
        target_rpe: current.targetRpe,
        rest_seconds: current.restSeconds,
      }
    );
    if (!rebuilt) return;
    set((state) => {
      const exercises = [...state.activeExercises];
      const mergedSets = current.sets.map((s, i) => {
        if (s.completed) return s;
        const fresh = rebuilt.sets[i];
        if (!fresh || fresh.setType !== s.setType) return s;
        return {
          ...s,
          weight: fresh.weight,
          reps: fresh.reps,
          propagationVersion: (s.propagationVersion ?? 0) + 1,
        };
      });
      exercises[exerciseIndex] = { ...current, machineBrand: normalized, sets: mergedSets };
      return { activeExercises: exercises };
    });
    persistActiveWorkoutState(get());
  },

  refreshBrandTrackingForSession: () => {
    const { activeExercises } = get();
    if (activeExercises.length === 0) return;
    let changed = false;
    const next = activeExercises.map((ex) => {
      const tracks = getExerciseTracksBrand(ex.exerciseId, ex.exerciseName);
      if (tracks === ex.tracksBrand) return ex;
      changed = true;
      return {
        ...ex,
        tracksBrand: tracks,
        // Turning tracking on adopts the exercise's last-used brand; turning it
        // off drops back to the un-siloed history.
        machineBrand: tracks ? getExerciseSelectedBrand(ex.exerciseId) : null,
      };
    });
    if (!changed) return;
    set({ activeExercises: next });
    persistActiveWorkoutState(get());
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
    setSetting(SCHEDULE_EXPLICIT_ADVANCE_YMD_KEY, '');
    const progress = resolveProgramProgress(normalized);
    set(progressStateUpdate(progress, normalized, get().activeProgramIsBuiltin));
    return true;
  },

  startRestTimer: (seconds) => {
    set((state) => ({
      restTimerActive: true,
      restTimerMinimized: false,
      restTimerSeconds: seconds,
      restTimerTotal: seconds,
      restTimerEndTime: Date.now() + seconds * 1000,
      restTimerRunId: state.restTimerRunId + 1,
    }));
    persistActiveWorkoutState(get());
  },

  stopRestTimer: () => {
    set({
      restTimerActive: false,
      restTimerMinimized: false,
      restTimerSeconds: 0,
      restTimerTotal: 0,
      restTimerEndTime: null,
    });
    persistActiveWorkoutState(get());
  },

  setRestTimerMinimized: (minimized) => {
    set({ restTimerMinimized: minimized });
    persistActiveWorkoutState(get());
  },

  tickRestTimer: () => {
    set((state) => {
      if (state.restTimerSeconds <= 1) {
        return { restTimerActive: false, restTimerSeconds: 0, restTimerEndTime: null };
      }
      return { restTimerSeconds: state.restTimerSeconds - 1 };
    });
    persistActiveWorkoutState(get());
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
    persistActiveWorkoutState(get());
  },
}));
