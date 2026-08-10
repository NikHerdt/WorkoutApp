import type { GeneratedPlan } from '../services/aiProgramPlan';

/**
 * Hand-authored programs that build through the same pipeline as AI-generated
 * ones (`createProgramFromPlan`), so no API key is needed to use them.
 *
 * Exercise names and muscle groups are copied from the app's existing catalog
 * so a template shares history and substitution options with the built-in plan.
 */
export interface ProgramTemplate {
  id: string;
  name: string;
  /** One-line pitch shown on the template chip. */
  tagline: string;
  plan: GeneratedPlan;
}

const rest = (dayIndex: number) => ({
  dayIndex,
  rest: true as const,
  workoutName: '',
  exercises: [],
});

/**
 * Upper/Lower, 4 training days, sessions land ~55-65 min including warmups and
 * rest. Cycle runs train / train / rest / train / train / rest / rest, so the
 * two heavy lower days are never back to back.
 *
 * Compounds sit at 3 working sets with 150-180s rest (the time sink), and
 * accessories at 3 sets with 60-90s rest to keep each session inside the hour.
 * Upper A presses horizontally (bench), Upper B vertically (high-incline);
 * Lower A is squat-led, Lower B deadlift-led.
 */
const UPPER_LOWER_4DAY: GeneratedPlan = {
  summary:
    'Upper/Lower split, 4 days a week, about an hour per session. Upper A is bench-led and Upper B high-incline-led; Lower A is squat-led and Lower B deadlift-led, so no heavy pattern repeats on back-to-back days.',
  days: [
    {
      dayIndex: 0,
      rest: false,
      workoutName: 'Upper A',
      exercises: [
        { name: 'Bench Press', muscleGroup: 'Chest', warmupSets: 2, workingSets: 3, targetReps: '5-7', targetRpe: '8', restSeconds: 150 },
        { name: 'Omni-Grip Lat Pulldown', muscleGroup: 'Back', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 120 },
        { name: 'Seated DB Shoulder Press', muscleGroup: 'Shoulders', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 120 },
        { name: 'Close-Grip Seated Cable Row', muscleGroup: 'Back', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 90 },
        { name: 'Machine Lateral Raise', muscleGroup: 'Shoulders', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 60 },
        { name: 'Triceps Pressdown', muscleGroup: 'Triceps', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
        { name: 'EZ-Bar Curl', muscleGroup: 'Biceps', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
      ],
    },
    {
      dayIndex: 1,
      rest: false,
      workoutName: 'Lower A',
      exercises: [
        { name: 'Squat', muscleGroup: 'Quads', warmupSets: 3, workingSets: 3, targetReps: '5-7', targetRpe: '8', restSeconds: 180 },
        { name: 'Barbell RDL', muscleGroup: 'Hamstrings', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 150 },
        { name: 'Leg Press', muscleGroup: 'Quads', warmupSets: 1, workingSets: 3, targetReps: '10-12', targetRpe: '8', restSeconds: 120 },
        { name: 'Seated Leg Curl', muscleGroup: 'Hamstrings', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 90 },
        { name: 'Leg Extension', muscleGroup: 'Quads', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 75 },
        { name: 'Standing Calf Raise', muscleGroup: 'Calves', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
        { name: 'Cable Crunch', muscleGroup: 'Abs', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 60 },
      ],
    },
    rest(2),
    {
      dayIndex: 3,
      rest: false,
      workoutName: 'Upper B',
      exercises: [
        { name: 'High-Incline Smith Machine Press', muscleGroup: 'Shoulders', warmupSets: 2, workingSets: 3, targetReps: '6-8', targetRpe: '8', restSeconds: 150 },
        { name: 'Pull-Up', muscleGroup: 'Back', warmupSets: 1, workingSets: 3, targetReps: '6-8', targetRpe: '8', restSeconds: 150 },
        { name: 'Low Incline DB Press', muscleGroup: 'Chest', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 120 },
        { name: 'Omni-Grip Machine Chest-Supported Row', muscleGroup: 'Back', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 90 },
        { name: 'Egyptian Cable Lateral Raise', muscleGroup: 'Shoulders', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 60 },
        { name: 'Overhead Cable Triceps Extension', muscleGroup: 'Triceps', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
        { name: 'Bayesian Cable Curl', muscleGroup: 'Biceps', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
      ],
    },
    {
      dayIndex: 4,
      rest: false,
      workoutName: 'Lower B',
      exercises: [
        { name: 'Deadlift', muscleGroup: 'Hamstrings', warmupSets: 3, workingSets: 3, targetReps: '4-6', targetRpe: '8', restSeconds: 180 },
        { name: 'Hack Squat', muscleGroup: 'Quads', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 150 },
        { name: 'Dumbbell Walking Lunge', muscleGroup: 'Quads', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '8', restSeconds: 120 },
        { name: 'Lying Leg Curl', muscleGroup: 'Hamstrings', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 90 },
        { name: 'Slow-Eccentric Leg Extension', muscleGroup: 'Quads', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 75 },
        { name: 'Seated Calf Raise', muscleGroup: 'Calves', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 60 },
        { name: 'Roman Chair Leg Raise', muscleGroup: 'Abs', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 60 },
      ],
    },
    rest(5),
    rest(6),
  ],
};

/**
 * Push / Pull / Legs / Upper across Mon, Tue, Thu, Fri — day 0 of the cycle is
 * the Monday Push day, so aligning day 1 of the program to a Monday puts the
 * whole week where it belongs.
 *
 * Upper-body pressing and pulling each get two exposures a week (Push+Upper,
 * Pull+Upper) while legs train once; the Friday Upper day deliberately uses
 * different angles from Mon/Tue (high-incline press, wide-grip pull-up, dips)
 * rather than repeating them. Sessions run ~55-65 min.
 */
const PPL_UPPER_4DAY: GeneratedPlan = {
  summary:
    'Push, Pull, Legs, Upper on Mon/Tue/Thu/Fri. Chest, back and shoulders get two exposures a week; the Friday Upper day uses different angles from Monday and Tuesday rather than repeating them.',
  days: [
    {
      dayIndex: 0,
      rest: false,
      workoutName: 'Push',
      exercises: [
        { name: 'Bench Press', muscleGroup: 'Chest', warmupSets: 2, workingSets: 3, targetReps: '5-7', targetRpe: '8', restSeconds: 150 },
        { name: 'Seated DB Shoulder Press', muscleGroup: 'Shoulders', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 120 },
        { name: 'Low Incline DB Press', muscleGroup: 'Chest', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 120 },
        { name: 'Machine Lateral Raise', muscleGroup: 'Shoulders', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 60 },
        { name: 'Triceps Pressdown', muscleGroup: 'Triceps', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
        { name: 'Overhead Cable Triceps Extension', muscleGroup: 'Triceps', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
      ],
    },
    {
      dayIndex: 1,
      rest: false,
      workoutName: 'Pull',
      exercises: [
        { name: 'Pendlay Row', muscleGroup: 'Back', warmupSets: 2, workingSets: 3, targetReps: '5-7', targetRpe: '8', restSeconds: 150 },
        { name: 'Omni-Grip Lat Pulldown', muscleGroup: 'Back', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 120 },
        { name: 'Close-Grip Seated Cable Row', muscleGroup: 'Back', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '8', restSeconds: 90 },
        { name: 'Reverse Pec Deck', muscleGroup: 'Rear Delts', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 60 },
        { name: 'EZ-Bar Curl', muscleGroup: 'Biceps', warmupSets: 0, workingSets: 3, targetReps: '8-10', targetRpe: '9', restSeconds: 75 },
        { name: 'Bayesian Cable Curl', muscleGroup: 'Biceps', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
      ],
    },
    rest(2),
    {
      dayIndex: 3,
      rest: false,
      workoutName: 'Legs',
      exercises: [
        { name: 'Squat', muscleGroup: 'Quads', warmupSets: 3, workingSets: 3, targetReps: '5-7', targetRpe: '8', restSeconds: 180 },
        { name: 'Barbell RDL', muscleGroup: 'Hamstrings', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 150 },
        { name: 'Leg Press', muscleGroup: 'Quads', warmupSets: 1, workingSets: 3, targetReps: '10-12', targetRpe: '8', restSeconds: 120 },
        { name: 'Lying Leg Curl', muscleGroup: 'Hamstrings', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 90 },
        { name: 'Leg Extension', muscleGroup: 'Quads', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 75 },
        { name: 'Standing Calf Raise', muscleGroup: 'Calves', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
        { name: 'Roman Chair Leg Raise', muscleGroup: 'Abs', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 60 },
      ],
    },
    {
      dayIndex: 4,
      rest: false,
      workoutName: 'Upper',
      exercises: [
        { name: 'High-Incline Smith Machine Press', muscleGroup: 'Shoulders', warmupSets: 2, workingSets: 3, targetReps: '6-8', targetRpe: '8', restSeconds: 150 },
        { name: 'Wide-Grip Pull-Up', muscleGroup: 'Back', warmupSets: 1, workingSets: 3, targetReps: '6-8', targetRpe: '8', restSeconds: 150 },
        { name: 'Weighted Dip', muscleGroup: 'Chest', warmupSets: 1, workingSets: 3, targetReps: '8-10', targetRpe: '8', restSeconds: 120 },
        { name: 'Omni-Grip Machine Chest-Supported Row', muscleGroup: 'Back', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 90 },
        { name: 'Egyptian Cable Lateral Raise', muscleGroup: 'Shoulders', warmupSets: 0, workingSets: 3, targetReps: '12-15', targetRpe: '9', restSeconds: 60 },
        { name: 'Alternating DB Curl', muscleGroup: 'Biceps', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
        { name: 'N1-Style Cross-Body Triceps Extension', muscleGroup: 'Triceps', warmupSets: 0, workingSets: 3, targetReps: '10-12', targetRpe: '9', restSeconds: 60 },
      ],
    },
    rest(5),
    rest(6),
  ],
};

export const PROGRAM_TEMPLATES: ProgramTemplate[] = [
  {
    id: 'upper-lower-4day',
    name: 'Upper/Lower 4-Day',
    tagline: '4 days/week · ~1 hour · upper/lower',
    plan: UPPER_LOWER_4DAY,
  },
  {
    id: 'ppl-upper-4day',
    name: 'Push / Pull / Legs / Upper',
    tagline: '4 days/week · Mon · Tue · Thu · Fri',
    plan: PPL_UPPER_4DAY,
  },
];
