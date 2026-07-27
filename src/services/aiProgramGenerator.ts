import Anthropic from '@anthropic-ai/sdk';
import {
  getSetting,
  setSetting,
  getExerciseCatalog,
  getAllPrograms,
  getProgramDays,
  getProgramWorkouts,
  getExercisesByWorkout,
  getWorkoutsByPhase,
  getAllPhases,
  createCustomProgram,
  createProgramWorkout,
  setProgramDayWorkout,
  addExerciseToWorkout,
  deleteCustomProgram,
  PROGRAM_DAY_COUNT,
} from '../db/database';
import { ANTHROPIC_API_KEY } from '../config/env';
import { PLAN_SCHEMA, normalizePlan, GeneratedPlan } from './aiProgramPlan';
export type { GeneratedPlan, GeneratedDay, GeneratedExercise } from './aiProgramPlan';

/**
 * Generates a custom 7-day workout program with Claude, using the app's own
 * exercise catalog as the vocabulary and existing programs as style reference.
 */

const AI_API_KEY_SETTING = 'anthropic_api_key';
const MODEL = 'claude-opus-5';

export function getAiApiKey(): string | null {
  const fromSettings = getSetting(AI_API_KEY_SETTING);
  if (fromSettings && fromSettings.trim()) return fromSettings.trim();
  return ANTHROPIC_API_KEY || null;
}

export function isAiConfigured(): boolean {
  return getAiApiKey() !== null;
}

/** Where the effective key comes from — shown in settings so the source is obvious. */
export function getAiKeySource(): 'in-app' | 'built-in' | null {
  const fromSettings = getSetting(AI_API_KEY_SETTING);
  if (fromSettings && fromSettings.trim()) return 'in-app';
  return ANTHROPIC_API_KEY ? 'built-in' : null;
}

export function saveAiApiKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('Enter your Anthropic API key.');
  if (!trimmed.startsWith('sk-ant-')) {
    throw new Error('That does not look like an Anthropic API key (they start with "sk-ant-").');
  }
  setSetting(AI_API_KEY_SETTING, trimmed);
}

export function clearAiApiKey(): void {
  setSetting(AI_API_KEY_SETTING, '');
}

const SYSTEM_PROMPT = `You design strength-training programs for an experienced lifter's personal workout-tracking app.

You will be given a program name, an optional note describing what the user wants, the app's exercise catalog, and summaries of the programs already in the app.

Design a repeating 7-day cycle. Rules:
- Return exactly 7 days, dayIndex 0 through 6, in order.
- Prefer exercise names from the provided catalog, copied exactly — that keeps the new program consistent with the user's existing history and substitution options. Introduce a new name only when the catalog genuinely lacks a movement the program needs.
- Give each training day a short distinct name ("Upper A", "Push", "Legs"). Rest days must have rest=true, an empty workoutName, and no exercises.
- Order exercises within a day heaviest/most technical first, accessories after.
- Use realistic volume: typically 4-7 exercises per training day, 2-4 working sets each. Compounds get 1-3 warmup sets and 120-210s rest; isolation work gets 0-1 warmup sets and 60-120s rest.
- targetReps is a range like "6-8" or "10-12". targetRpe is a number or short range like "8" or "7-8"; use "" if not meaningful.
- Honor the user's note above all else — if it asks for a specific number of training days, split, equipment limitation, or emphasis, follow it exactly.
- Balance pushing and pulling volume, and don't schedule the same heavy movement pattern on consecutive days.`;

function buildUserPrompt(name: string, memo: string): string {
  const catalog = getExerciseCatalog();
  const catalogText = catalog
    .map((e) => (e.muscle_group ? `${e.name} (${e.muscle_group})` : e.name))
    .join('\n');

  const existing = describeExistingPrograms();

  return [
    `Program name: ${name}`,
    memo.trim() ? `What the user wants:\n${memo.trim()}` : 'The user did not add a note — infer a sensible program from the name.',
    '',
    'EXERCISE CATALOG (prefer these names, copied exactly):',
    catalogText || '(empty)',
    '',
    'PROGRAMS ALREADY IN THE APP (for style/volume reference):',
    existing || '(none)',
  ].join('\n');
}

/** Compact text summary of existing programs so the model can match house style. */
function describeExistingPrograms(): string {
  const lines: string[] = [];

  for (const program of getAllPrograms()) {
    if (program.is_builtin) {
      // The built-in plan lives in phases rather than program_days.
      for (const phase of getAllPhases()) {
        const workouts = getWorkoutsByPhase(phase.id);
        if (workouts.length === 0) continue;
        lines.push(`${program.name} — ${phase.name}:`);
        for (const w of workouts) {
          const exercises = getExercisesByWorkout(w.id) as { name: string }[];
          lines.push(`  ${w.name}: ${exercises.map((e) => e.name).join(', ')}`);
        }
      }
      continue;
    }

    const days = getProgramDays(program.id);
    const workouts = getProgramWorkouts(program.id) as { id: number; name: string }[];
    if (workouts.length === 0) continue;
    lines.push(`${program.name} (custom):`);
    for (const w of workouts) {
      const exercises = getExercisesByWorkout(w.id) as { name: string }[];
      lines.push(`  ${w.name}: ${exercises.map((e) => e.name).join(', ')}`);
    }
    const cycle = days
      .map((d, i) => `${i + 1}=${d.workout_name ?? 'Rest'}`)
      .join(' ');
    lines.push(`  cycle: ${cycle}`);
  }

  // Cap the reference material so a long history can't crowd out the request.
  const text = lines.join('\n');
  return text.length > 6000 ? `${text.slice(0, 6000)}\n…(truncated)` : text;
}

/** Ask Claude for a 7-day plan. Does not touch the database. */
export async function generateProgramPlan(name: string, memo: string): Promise<GeneratedPlan> {
  const apiKey = getAiApiKey();
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings first.');

  const client = new Anthropic({ apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: PLAN_SCHEMA as any },
      },
      messages: [{ role: 'user', content: buildUserPrompt(name, memo) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      throw new Error('Your Anthropic API key was rejected. Check it in Settings.');
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new Error('Rate limited by the Anthropic API. Wait a moment and try again.');
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new Error('Could not reach the Anthropic API. Check your connection.');
    }
    if (e instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error (${e.status}): ${e.message}`);
    }
    throw e;
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('The request was declined. Try rewording your program note.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The generated program was cut off. Try a simpler request.');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('The AI response was empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error('The AI response was not valid JSON.');
  }
  return normalizePlan(parsed, PROGRAM_DAY_COUNT);
}

/**
 * Persist a generated plan as a new custom program.
 * Rolls the program back if any part of the build fails, so a partial program
 * is never left behind.
 */
export function createProgramFromPlan(name: string, plan: GeneratedPlan): number {
  const programId = createCustomProgram(name);
  try {
    for (const day of plan.days) {
      if (day.rest || day.exercises.length === 0) {
        setProgramDayWorkout(programId, day.dayIndex, null);
        continue;
      }
      const workoutId = createProgramWorkout(programId, day.workoutName);
      for (const ex of day.exercises) {
        addExerciseToWorkout(workoutId, ex);
      }
      setProgramDayWorkout(programId, day.dayIndex, workoutId);
    }
    return programId;
  } catch (e) {
    try {
      deleteCustomProgram(programId);
    } catch {
      /* keep the original error */
    }
    throw e;
  }
}
