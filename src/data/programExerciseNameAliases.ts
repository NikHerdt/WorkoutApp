/**
 * Spreadsheet / program labels that do not exactly match `exercises.name` in the DB.
 * Keys: normalized like findExerciseIdByProgramName (trim, lower, collapse spaces).
 * Values: exact exercise name from seed (matched case-insensitively against DB).
 */
const PROGRAM_EXERCISE_NAME_ALIASES: Record<string, string> = {
  'db lateral raise': 'A1: Lean-In DB Lateral Raise',
  'cable lateral raise': 'Cable Lateral Raise (Eccentric + Constant Tension)',
  'constant-tension cable lateral raise': 'Cable Lateral Raise (Eccentric + Constant Tension)',
  'constant-tension machine lateral raise': 'Machine Lateral Raise',
  // "Lat Pulldown" (bare) is ambiguous - multiple program exercises contain that string.
  // Map it to the feeder-sets variant as the canonical general lat pulldown slot.
  'lat pulldown': 'Lat Pulldown (Feeder Sets)',
  // Substitution spreadsheet uses "EZ Bar Curl" (no hyphen); DB stores "EZ-Bar Curl".
  'ez bar curl': 'EZ-Bar Curl',
};

export function resolveAliasToCanonicalExerciseName(normalizedProgramLabel: string): string | null {
  return PROGRAM_EXERCISE_NAME_ALIASES[normalizedProgramLabel] ?? null;
}
