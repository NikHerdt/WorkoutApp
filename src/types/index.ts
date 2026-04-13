export type DayType = 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'rest';

export interface Phase {
  id: number;
  name: string;
  description: string;
}

export interface Workout {
  id: number;
  phase_id: number;
  name: string;
  day_type: DayType;
}

export interface Exercise {
  id: number;
  workout_id: number | null;
  name: string;
  order_index: number;
  warmup_sets: number;
  working_sets: number;
  target_reps: string;
  target_rpe: string;
  rest_seconds: number;
  notes: string;
  muscle_group: string;
  is_superset: number;
  superset_group: string | null;
  is_custom: number;
}

export interface WorkoutSession {
  id: number;
  workout_id: number;
  phase_id: number;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
}

export type SetType = 'warmup' | 'working' | 'dropset' | 'failure';

export interface SetLog {
  id: number;
  session_id: number;
  exercise_id: number;
  set_number: number;
  set_type: SetType;
  weight: number;
  reps: number;
  rpe: number | null;
  completed_at: string;
}

export interface ExerciseWithSets extends Exercise {
  sets: ActiveSet[];
  previousSets: SetLog[];
}

export interface ActiveSet {
  setNumber: number;
  setType: SetType;
  weight: string;
  reps: string;
  completed: boolean;
}

export interface ActiveExerciseState {
  exerciseId: number;
  exerciseName: string;
  sets: ActiveSet[];
  /** Program workout row (slot); unchanged when swapping mid-session. */
  slotTemplateExerciseId: number;
}

export interface PreviousSetInfo {
  weight: number;
  reps: number;
}

export const SCHEDULE: DayType[] = ['push', 'pull', 'legs', 'rest', 'upper', 'lower', 'rest'];
export const DAY_LABELS: Record<DayType, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  upper: 'Upper',
  lower: 'Lower',
  rest: 'Rest',
};
