/**
 * Pure plan types, the structured-output schema, and normalization for
 * AI-generated programs. Deliberately free of database/network imports so the
 * parsing logic can be exercised on its own.
 */

export interface GeneratedExercise {
  name: string;
  muscleGroup: string;
  warmupSets: number;
  workingSets: number;
  targetReps: string;
  targetRpe: string;
  restSeconds: number;
}

export interface GeneratedDay {
  dayIndex: number;
  rest: boolean;
  workoutName: string;
  exercises: GeneratedExercise[];
}

export interface GeneratedPlan {
  summary: string;
  days: GeneratedDay[];
}

/**
 * Structured-output schema. Numeric ranges and array lengths are intentionally
 * absent — the API's schema subset does not support them, so those bounds are
 * enforced in `normalizePlan` instead.
 */
export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'One or two sentences describing the split and its focus.',
    },
    days: {
      type: 'array',
      description: 'Exactly 7 entries, one per day of the repeating cycle, dayIndex 0-6.',
      items: {
        type: 'object',
        properties: {
          dayIndex: { type: 'integer' },
          rest: { type: 'boolean' },
          workoutName: {
            type: 'string',
            description: 'Short name, e.g. "Upper A". Empty string on rest days.',
          },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                muscleGroup: { type: 'string' },
                warmupSets: { type: 'integer' },
                workingSets: { type: 'integer' },
                targetReps: { type: 'string', description: 'e.g. "8-10" or "AMRAP".' },
                targetRpe: { type: 'string', description: 'e.g. "8" or "7-8". May be empty.' },
                restSeconds: { type: 'integer' },
              },
              required: [
                'name',
                'muscleGroup',
                'warmupSets',
                'workingSets',
                'targetReps',
                'targetRpe',
                'restSeconds',
              ],
              additionalProperties: false,
            },
          },
        },
        required: ['dayIndex', 'rest', 'workoutName', 'exercises'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'days'],
  additionalProperties: false,
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Coerce a model response into exactly `dayCount` days with in-range values.
 * Throws when there is nothing usable to build a program from.
 */
export function normalizePlan(raw: any, dayCount: number): GeneratedPlan {
  if (!raw || !Array.isArray(raw.days)) {
    throw new Error('The AI response did not contain a usable program.');
  }

  const days: GeneratedDay[] = [];
  for (let i = 0; i < dayCount; i++) {
    const match = raw.days.find((d: any) => Number(d?.dayIndex) === i) ?? raw.days[i] ?? null;
    if (!match || match.rest === true) {
      days.push({ dayIndex: i, rest: true, workoutName: '', exercises: [] });
      continue;
    }

    const rawExercises = Array.isArray(match.exercises) ? match.exercises : [];
    const exercises: GeneratedExercise[] = rawExercises
      .filter((e: any) => typeof e?.name === 'string' && e.name.trim())
      .slice(0, 12)
      .map((e: any) => ({
        name: String(e.name).trim(),
        muscleGroup: String(e.muscleGroup ?? '').trim(),
        warmupSets: clampInt(e.warmupSets, 0, 6, 0),
        workingSets: clampInt(e.workingSets, 1, 10, 3),
        targetReps: String(e.targetReps ?? '').trim() || '8-12',
        targetRpe: String(e.targetRpe ?? '').trim(),
        restSeconds: clampInt(e.restSeconds, 0, 600, 90),
      }));

    if (exercises.length === 0) {
      days.push({ dayIndex: i, rest: true, workoutName: '', exercises: [] });
      continue;
    }

    days.push({
      dayIndex: i,
      rest: false,
      workoutName: String(match.workoutName ?? '').trim() || `Day ${i + 1}`,
      exercises,
    });
  }

  if (days.every((d) => d.rest)) {
    throw new Error('The AI returned a program with no training days. Try rewording your note.');
  }

  return { summary: String(raw.summary ?? '').trim(), days };
}
