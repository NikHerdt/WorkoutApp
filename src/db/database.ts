import * as SQLite from 'expo-sqlite';
import { resolveAliasToCanonicalExerciseName } from '../data/programExerciseNameAliases';
import { SEED_DATA } from './seed';
import { toLocalDateYmd } from '../utils/dateLocal';


let db: SQLite.SQLiteDatabase;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('workout.db');
  }
  return db;
}

export function initDatabase(): void {
  const database = getDb();

  database.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS phases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phase_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      day_type TEXT NOT NULL,
      FOREIGN KEY (phase_id) REFERENCES phases(id)
    );

    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER,
      name TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      warmup_sets INTEGER DEFAULT 0,
      working_sets INTEGER DEFAULT 1,
      target_reps TEXT DEFAULT '',
      target_rpe TEXT DEFAULT '',
      rest_seconds INTEGER DEFAULT 90,
      notes TEXT DEFAULT '',
      muscle_group TEXT DEFAULT '',
      is_superset INTEGER DEFAULT 0,
      superset_group TEXT,
      is_custom INTEGER DEFAULT 0,
      FOREIGN KEY (workout_id) REFERENCES workouts(id)
    );

    CREATE TABLE IF NOT EXISTS workout_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL,
      phase_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      workout_date TEXT,
      notes TEXT,
      FOREIGN KEY (workout_id) REFERENCES workouts(id)
    );

    CREATE TABLE IF NOT EXISTS set_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      exercise_order INTEGER NOT NULL DEFAULT 0,
      set_number INTEGER NOT NULL,
      set_type TEXT NOT NULL DEFAULT 'working',
      weight REAL DEFAULT 0,
      reps INTEGER DEFAULT 0,
      rpe REAL,
      completed_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES workout_sessions(id),
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS body_weight_log (
      logged_date TEXT PRIMARY KEY,
      weight_lbs REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_builtin INTEGER DEFAULT 0,
      phase_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS program_days (
      program_id INTEGER NOT NULL,
      day_index INTEGER NOT NULL,
      workout_id INTEGER,
      PRIMARY KEY (program_id, day_index),
      FOREIGN KEY (program_id) REFERENCES programs(id)
    );
  `);

  migrateKgToLbs(database);
  migrateAddWorkoutDate(database);
  migrateAddExerciseOrder(database);
  migrateAddCustomPhaseFlag(database);
  migrateAddMachineBrand(database);
  ensureBuiltinProgram(database);

  const seeded = database.getFirstSync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'seeded'"
  );

  if (!seeded) {
    seedDatabase(database);
    database.runSync("INSERT INTO settings (key, value) VALUES ('seeded', '1')");
    database.runSync("INSERT OR IGNORE INTO settings (key, value) VALUES ('schedule_day', '0')");
    database.runSync("INSERT OR IGNORE INTO settings (key, value) VALUES ('current_phase_id', '1')");
  }

  database.runSync("INSERT OR IGNORE INTO settings (key, value) VALUES ('phase_week', '1')");
}

const MIGRATION_KG_TO_LBS = 2.2046226218;

/** One-time: convert stored kg values to lbs for body weight and set weights (user_version < 2). */
function migrateKgToLbs(database: SQLite.SQLiteDatabase): void {
  const verRow = database.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const v = verRow?.user_version ?? 0;
  if (v >= 2) return;

  const cols = database.getAllSync<{ name: string }>('PRAGMA table_info(body_weight_log)');
  const hasKg = cols.some((c) => c.name === 'weight_kg');
  if (hasKg) {
    database.runSync('UPDATE body_weight_log SET weight_kg = weight_kg * ?', [MIGRATION_KG_TO_LBS]);
    database.execSync('ALTER TABLE body_weight_log RENAME COLUMN weight_kg TO weight_lbs');
  }

  database.runSync('UPDATE set_logs SET weight = weight * ? WHERE weight > 0', [MIGRATION_KG_TO_LBS]);
  database.execSync('PRAGMA user_version = 2');
}

/**
 * One-time: add workout_date (local YYYY-MM-DD) to workout_sessions and
 * backfill existing rows from their UTC timestamps using device local time
 * (user_version < 3).
 */
function migrateAddWorkoutDate(database: SQLite.SQLiteDatabase): void {
  const verRow = database.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const v = verRow?.user_version ?? 0;
  if (v >= 3) return;

  const cols = database.getAllSync<{ name: string }>('PRAGMA table_info(workout_sessions)');
  if (!cols.some((c) => c.name === 'workout_date')) {
    database.execSync('ALTER TABLE workout_sessions ADD COLUMN workout_date TEXT');
  }

  // Backfill completed sessions first, then fall back to started_at for incomplete ones.
  database.execSync(`
    UPDATE workout_sessions
      SET workout_date = date(datetime(completed_at, 'localtime'))
      WHERE completed_at IS NOT NULL AND workout_date IS NULL;
    UPDATE workout_sessions
      SET workout_date = date(datetime(started_at, 'localtime'))
      WHERE workout_date IS NULL;
  `);

  database.execSync('PRAGMA user_version = 3');
}

/**
 * One-time: store per-session exercise sequence on set_logs and backfill from
 * workout template order (with phase substitutions) for existing rows (user_version < 4).
 */
function migrateAddExerciseOrder(database: SQLite.SQLiteDatabase): void {
  const verRow = database.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const v = verRow?.user_version ?? 0;
  if (v >= 4) return;

  const cols = database.getAllSync<{ name: string }>('PRAGMA table_info(set_logs)');
  if (!cols.some((c) => c.name === 'exercise_order')) {
    database.execSync('ALTER TABLE set_logs ADD COLUMN exercise_order INTEGER NOT NULL DEFAULT 0');
  }

  const sessions = database.getAllSync<{ id: number; workout_id: number; phase_id: number }>(
    `SELECT DISTINCT ws.id, ws.workout_id, ws.phase_id
     FROM workout_sessions ws
     INNER JOIN set_logs sl ON sl.session_id = ws.id`
  );

  for (const session of sessions) {
    const templateExercises = database.getAllSync<{ id: number; order_index: number }>(
      'SELECT id, order_index FROM exercises WHERE workout_id = ? ORDER BY order_index',
      [session.workout_id]
    );

    const subs = getPhaseSubstitutionsForPhase(session.phase_id);
    const orderByExerciseId = new Map<number, number>();
    for (const ex of templateExercises) {
      const effectiveId = subs[ex.id] ?? ex.id;
      orderByExerciseId.set(effectiveId, ex.order_index);
      orderByExerciseId.set(ex.id, ex.order_index);
    }

    let nextOrder =
      templateExercises.length > 0
        ? Math.max(...templateExercises.map((ex) => ex.order_index)) + 1
        : 0;

    const logs = database.getAllSync<{ id: number; exercise_id: number }>(
      'SELECT id, exercise_id FROM set_logs WHERE session_id = ?',
      [session.id]
    );

    for (const log of logs) {
      let order = orderByExerciseId.get(log.exercise_id);
      if (order === undefined) {
        order = nextOrder;
        nextOrder += 1;
        orderByExerciseId.set(log.exercise_id, order);
      }
      database.runSync('UPDATE set_logs SET exercise_order = ? WHERE id = ?', [order, log.id]);
    }
  }

  database.execSync('PRAGMA user_version = 4');
}

/** One-time: mark phases owned by custom programs so they stay out of the phase picker (user_version < 5). */
function migrateAddCustomPhaseFlag(database: SQLite.SQLiteDatabase): void {
  const verRow = database.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const v = verRow?.user_version ?? 0;
  if (v >= 5) return;

  const cols = database.getAllSync<{ name: string }>('PRAGMA table_info(phases)');
  if (!cols.some((c) => c.name === 'is_custom')) {
    database.execSync('ALTER TABLE phases ADD COLUMN is_custom INTEGER DEFAULT 0');
  }

  database.execSync('PRAGMA user_version = 5');
}

/** One-time: per-set machine brand, so weights can be siloed per manufacturer (user_version < 6). */
function migrateAddMachineBrand(database: SQLite.SQLiteDatabase): void {
  const verRow = database.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const v = verRow?.user_version ?? 0;
  if (v >= 6) return;

  const cols = database.getAllSync<{ name: string }>('PRAGMA table_info(set_logs)');
  if (!cols.some((c) => c.name === 'machine_brand')) {
    database.execSync('ALTER TABLE set_logs ADD COLUMN machine_brand TEXT');
  }

  database.execSync('PRAGMA user_version = 6');
}

/** Idempotent: the preprogrammed PPL×UL plan is represented as a builtin program row. */
function ensureBuiltinProgram(database: SQLite.SQLiteDatabase): void {
  const existing = database.getFirstSync<{ id: number }>(
    'SELECT id FROM programs WHERE is_builtin = 1'
  );
  let builtinId = existing?.id;
  if (builtinId == null) {
    const result = database.runSync(
      'INSERT INTO programs (name, is_builtin, phase_id, created_at) VALUES (?, 1, NULL, ?)',
      ['PPL × UL (built-in)', new Date().toISOString()]
    );
    builtinId = result.lastInsertRowId;
  }
  database.runSync(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    [ACTIVE_PROGRAM_ID_KEY, String(builtinId)]
  );
}

function seedDatabase(database: SQLite.SQLiteDatabase): void {
  for (const phase of SEED_DATA) {
    const phaseResult = database.runSync(
      'INSERT INTO phases (name, description) VALUES (?, ?)',
      [phase.name, phase.description]
    );
    const phaseId = phaseResult.lastInsertRowId;

    for (const workout of phase.workouts) {
      const workoutResult = database.runSync(
        'INSERT INTO workouts (phase_id, name, day_type) VALUES (?, ?, ?)',
        [phaseId, workout.name, workout.day_type]
      );
      const workoutId = workoutResult.lastInsertRowId;

      workout.exercises.forEach((exercise, index) => {
        database.runSync(
          `INSERT INTO exercises
            (workout_id, name, order_index, warmup_sets, working_sets, target_reps,
             target_rpe, rest_seconds, notes, muscle_group, is_superset, superset_group)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            workoutId,
            exercise.name,
            index,
            exercise.warmup_sets,
            exercise.working_sets,
            exercise.target_reps,
            exercise.target_rpe,
            exercise.rest_seconds,
            exercise.notes,
            exercise.muscle_group,
            exercise.is_superset ?? 0,
            exercise.superset_group ?? null,
          ]
        );
      });
    }
  }
}

// Settings
export function getSetting(key: string): string | null {
  const row = getDb().getFirstSync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().runSync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value]
  );
}

const EXERCISE_WARMUP_PRESETS_KEY = 'exercise_warmup_presets';

// --- Machine brand tracking ---------------------------------------------------
const MACHINE_BRANDS_KEY = 'machine_brands';
const MACHINE_BRAND_TRACKING_OVERRIDES_KEY = 'machine_brand_tracking_overrides';
const EXERCISE_SELECTED_BRAND_KEY = 'exercise_selected_brand';

/** Name fragments that strongly imply a weight-stack / plate-loaded machine or cable. */
const MACHINE_NAME_KEYWORDS = [
  'machine',
  'cable',
  'pulldown',
  'pull-down',
  'pull down',
  'lat pull',
  'pushdown',
  'push-down',
  'pressdown',
  'pec deck',
  'pec-deck',
  'leg press',
  'leg extension',
  'leg curl',
  'hack squat',
  'smith',
  'crossover',
  'seated row',
  'cable row',
  'assisted',
];

/** Heuristic: does this exercise name look like a machine/cable movement? */
export function isMachineExerciseByName(name: string): boolean {
  const n = String(name ?? '').toLowerCase();
  return MACHINE_NAME_KEYWORDS.some((kw) => n.includes(kw));
}

function readNumberBoolMap(key: string): Record<string, number> {
  const raw = getSetting(key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n ? 1 : 0;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Whether an exercise should show the machine-brand selector. Uses an explicit
 * per-exercise override when the user has set one, otherwise falls back to
 * name-based auto-detection.
 */
export function getExerciseTracksBrand(exerciseId: number, exerciseName?: string): boolean {
  const overrides = readNumberBoolMap(MACHINE_BRAND_TRACKING_OVERRIDES_KEY);
  const override = overrides[String(exerciseId)];
  if (override === 0 || override === 1) return override === 1;
  const name = exerciseName ?? getExerciseById(exerciseId)?.name ?? '';
  return isMachineExerciseByName(name);
}

/** Persist an explicit on/off override for brand tracking on one exercise. */
export function setExerciseTracksBrand(exerciseId: number, tracks: boolean): void {
  const overrides = readNumberBoolMap(MACHINE_BRAND_TRACKING_OVERRIDES_KEY);
  overrides[String(exerciseId)] = tracks ? 1 : 0;
  setSetting(MACHINE_BRAND_TRACKING_OVERRIDES_KEY, JSON.stringify(overrides));
}

/** All known machine brands: the user's saved list unioned with any used in set logs. */
export function getMachineBrands(): string[] {
  let stored: string[] = [];
  const raw = getSetting(MACHINE_BRANDS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) stored = parsed.map((b) => String(b));
    } catch {
      /* ignore */
    }
  }
  const used = getDb()
    .getAllSync<{ machine_brand: string }>(
      "SELECT DISTINCT machine_brand FROM set_logs WHERE machine_brand IS NOT NULL AND machine_brand != ''"
    )
    .map((r) => r.machine_brand);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of [...stored, ...used]) {
    const trimmed = b.trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed || seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/** Add a brand to the saved list (case-insensitive de-dupe). */
export function addMachineBrand(brand: string): void {
  const trimmed = brand.trim();
  if (!trimmed) return;
  let stored: string[] = [];
  const raw = getSetting(MACHINE_BRANDS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) stored = parsed.map((b) => String(b));
    } catch {
      /* ignore */
    }
  }
  if (stored.some((b) => b.trim().toLowerCase() === trimmed.toLowerCase())) return;
  stored.push(trimmed);
  setSetting(MACHINE_BRANDS_KEY, JSON.stringify(stored));
}

/** Last brand selected for an exercise (used to default the next session's silo). */
export function getExerciseSelectedBrand(exerciseId: number): string | null {
  const raw = getSetting(EXERCISE_SELECTED_BRAND_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const v = parsed[String(exerciseId)];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  } catch {
    return null;
  }
}

export function setExerciseSelectedBrand(exerciseId: number, brand: string | null): void {
  const raw = getSetting(EXERCISE_SELECTED_BRAND_KEY);
  let store: Record<string, string> = {};
  if (raw) {
    try {
      store = JSON.parse(raw) as Record<string, string>;
    } catch {
      store = {};
    }
  }
  if (brand == null || brand.trim() === '') {
    delete store[String(exerciseId)];
  } else {
    store[String(exerciseId)] = brand.trim();
  }
  setSetting(EXERCISE_SELECTED_BRAND_KEY, JSON.stringify(store));
}
// -----------------------------------------------------------------------------

export type WarmupPreset = { weight: string; reps: string };

/**
 * Warmup preset storage key. Brand-tracked exercises silo presets per brand;
 * a null/empty brand (untracked, or the "No brand" silo) uses the plain
 * exercise-id key so legacy presets keep working.
 */
function warmupPresetKey(exerciseId: number, brand?: string | null): string {
  const b = String(brand ?? '').trim();
  return b === '' ? String(exerciseId) : `${exerciseId}|${b}`;
}

/** Saved warmup weights/reps per exercise (from last edit or finished workout), optionally per brand. */
export function getSavedWarmupPresets(exerciseId: number, brand?: string | null): WarmupPreset[] | null {
  const raw = getSetting(EXERCISE_WARMUP_PRESETS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, WarmupPreset[]>;
    const entry = parsed[warmupPresetKey(exerciseId, brand)];
    if (!Array.isArray(entry)) return null;
    return entry.map((p) => ({
      weight: String(p?.weight ?? ''),
      reps: String(p?.reps ?? ''),
    }));
  } catch {
    return null;
  }
}

export function saveWarmupPresets(
  exerciseId: number,
  presets: WarmupPreset[],
  brand?: string | null
): void {
  const raw = getSetting(EXERCISE_WARMUP_PRESETS_KEY);
  let store: Record<string, WarmupPreset[]> = {};
  if (raw) {
    try {
      store = JSON.parse(raw) as Record<string, WarmupPreset[]>;
    } catch {
      store = {};
    }
  }
  store[warmupPresetKey(exerciseId, brand)] = presets.map((p) => ({
    weight: String(p.weight ?? ''),
    reps: String(p.reps ?? ''),
  }));
  setSetting(EXERCISE_WARMUP_PRESETS_KEY, JSON.stringify(store));
}

export function clearSavedWarmupPresets(exerciseId: number, brand?: string | null): void {
  const raw = getSetting(EXERCISE_WARMUP_PRESETS_KEY);
  if (!raw) return;
  try {
    const store = JSON.parse(raw) as Record<string, WarmupPreset[]>;
    delete store[warmupPresetKey(exerciseId, brand)];
    setSetting(EXERCISE_WARMUP_PRESETS_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

/** Body weight in lbs for a calendar day (YYYY-MM-DD). Replaces any existing entry for that date. */
export function upsertBodyWeightForDate(dateYmd: string, weightLbs: number): void {
  const t = new Date().toISOString();
  getDb().runSync(
    'INSERT OR REPLACE INTO body_weight_log (logged_date, weight_lbs, updated_at) VALUES (?, ?, ?)',
    [dateYmd.trim(), weightLbs, t]
  );
}

export function getBodyWeightForDate(dateYmd: string): number | null {
  const row = getDb().getFirstSync<{ weight_lbs: number }>(
    'SELECT weight_lbs FROM body_weight_log WHERE logged_date = ?',
    [dateYmd.trim()]
  );
  if (row == null || !Number.isFinite(row.weight_lbs)) return null;
  return row.weight_lbs;
}

export function getRecentBodyWeights(limit = 20) {
  return getDb().getAllSync<{ logged_date: string; weight_lbs: number; updated_at: string }>(
    'SELECT logged_date, weight_lbs, updated_at FROM body_weight_log ORDER BY logged_date DESC LIMIT ?',
    [limit]
  );
}

const PHASE_EXERCISE_SUBSTITUTIONS_KEY = 'phase_exercise_substitutions';

/** phaseId -> templateExerciseId -> replacementExerciseId */
export function getPhaseSubstitutionsMap(): Record<number, Record<number, number>> {
  const raw = getSetting(PHASE_EXERCISE_SUBSTITUTIONS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, number>>;
    const out: Record<number, Record<number, number>> = {};
    for (const [phaseKey, inner] of Object.entries(parsed)) {
      const phaseId = Number(phaseKey);
      if (!Number.isFinite(phaseId) || !inner || typeof inner !== 'object') continue;
      out[phaseId] = {};
      for (const [templateKey, replacementId] of Object.entries(inner)) {
        const templateId = Number(templateKey);
        if (!Number.isFinite(templateId) || !Number.isFinite(Number(replacementId))) continue;
        out[phaseId][templateId] = Number(replacementId);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function savePhaseSubstitutionsMap(map: Record<number, Record<number, number>>): void {
  setSetting(PHASE_EXERCISE_SUBSTITUTIONS_KEY, JSON.stringify(map));
}

export function getPhaseSubstitutionsForPhase(phaseId: number): Record<number, number> {
  const all = getPhaseSubstitutionsMap();
  return { ...(all[phaseId] ?? {}) };
}

/**
 * Set or clear a substitution for the phase. Clearing: pass replacementId equal to templateId or null.
 * Returns the updated substitution map for that phase only.
 */
export function upsertPhaseSubstitution(
  phaseId: number,
  templateExerciseId: number,
  replacementExerciseId: number | null
): Record<number, number> {
  const all: Record<number, Record<number, number>> = { ...getPhaseSubstitutionsMap() };
  const phaseMap = { ...(all[phaseId] ?? {}) };
  if (replacementExerciseId === null || replacementExerciseId === templateExerciseId) {
    delete phaseMap[templateExerciseId];
  } else {
    phaseMap[templateExerciseId] = replacementExerciseId;
  }
  if (Object.keys(phaseMap).length === 0) {
    delete all[phaseId];
  } else {
    all[phaseId] = phaseMap;
  }
  savePhaseSubstitutionsMap(all);
  return phaseMap;
}

// Phases
export function getAllPhases() {
  return getDb().getAllSync<{ id: number; name: string; description: string }>(
    'SELECT * FROM phases WHERE COALESCE(is_custom, 0) = 0 ORDER BY id'
  );
}

// Programs
const ACTIVE_PROGRAM_ID_KEY = 'active_program_id';
export const PROGRAM_DAY_COUNT = 7;

export interface ProgramRow {
  id: number;
  name: string;
  is_builtin: number;
  phase_id: number | null;
  created_at: string | null;
}

export interface ProgramDayRow {
  day_index: number;
  workout_id: number | null;
  workout_name: string | null;
}

export function getAllPrograms(): ProgramRow[] {
  return getDb().getAllSync<ProgramRow>(
    'SELECT * FROM programs ORDER BY is_builtin DESC, id'
  );
}

export function getProgramById(id: number): ProgramRow | null {
  return getDb().getFirstSync<ProgramRow>('SELECT * FROM programs WHERE id = ?', [id]) ?? null;
}

export function getBuiltinProgram(): ProgramRow {
  const row = getDb().getFirstSync<ProgramRow>('SELECT * FROM programs WHERE is_builtin = 1');
  if (!row) throw new Error('Builtin program row missing');
  return row;
}

/** The program the schedule currently runs on. Falls back to the builtin plan. */
export function getActiveProgram(): ProgramRow {
  const raw = getSetting(ACTIVE_PROGRAM_ID_KEY);
  const id = raw ? Number(raw) : NaN;
  if (Number.isFinite(id)) {
    const row = getProgramById(id);
    if (row) return row;
  }
  return getBuiltinProgram();
}

export function setActiveProgramId(programId: number): void {
  setSetting(ACTIVE_PROGRAM_ID_KEY, String(programId));
}

/** Create an empty custom program: a hidden phase to own its workouts plus 7 rest days. */
export function createCustomProgram(name: string): number {
  const db = getDb();
  const phaseResult = db.runSync(
    'INSERT INTO phases (name, description, is_custom) VALUES (?, ?, 1)',
    [name.trim(), 'Custom program']
  );
  const phaseId = phaseResult.lastInsertRowId;
  const result = db.runSync(
    'INSERT INTO programs (name, is_builtin, phase_id, created_at) VALUES (?, 0, ?, ?)',
    [name.trim(), phaseId, new Date().toISOString()]
  );
  const programId = result.lastInsertRowId;
  for (let day = 0; day < PROGRAM_DAY_COUNT; day++) {
    db.runSync(
      'INSERT INTO program_days (program_id, day_index, workout_id) VALUES (?, ?, NULL)',
      [programId, day]
    );
  }
  return programId;
}

export function renameCustomProgram(programId: number, name: string): void {
  const program = getProgramById(programId);
  if (!program || program.is_builtin) return;
  const db = getDb();
  db.runSync('UPDATE programs SET name = ? WHERE id = ?', [name.trim(), programId]);
  if (program.phase_id != null) {
    db.runSync('UPDATE phases SET name = ? WHERE id = ?', [name.trim(), program.phase_id]);
  }
}

/**
 * Delete a custom program and its schedule. Workouts/exercises/sessions logged under it
 * are kept so history and analytics remain intact.
 */
export function deleteCustomProgram(programId: number): void {
  const program = getProgramById(programId);
  if (!program || program.is_builtin) return;
  const db = getDb();
  db.runSync('DELETE FROM program_days WHERE program_id = ?', [programId]);
  db.runSync('DELETE FROM programs WHERE id = ?', [programId]);
  const active = getSetting(ACTIVE_PROGRAM_ID_KEY);
  if (active === String(programId)) {
    setActiveProgramId(getBuiltinProgram().id);
  }
}

/** The 7-day cycle for a program, with workout names resolved (workout_id NULL = rest). */
export function getProgramDays(programId: number): ProgramDayRow[] {
  const rows = getDb().getAllSync<ProgramDayRow>(
    `SELECT pd.day_index, pd.workout_id, w.name as workout_name
     FROM program_days pd
     LEFT JOIN workouts w ON pd.workout_id = w.id
     WHERE pd.program_id = ?
     ORDER BY pd.day_index`,
    [programId]
  );
  // Normalize to exactly PROGRAM_DAY_COUNT entries.
  const byIndex = new Map(rows.map((r) => [r.day_index, r]));
  const out: ProgramDayRow[] = [];
  for (let day = 0; day < PROGRAM_DAY_COUNT; day++) {
    out.push(byIndex.get(day) ?? { day_index: day, workout_id: null, workout_name: null });
  }
  return out;
}

export function setProgramDayWorkout(
  programId: number,
  dayIndex: number,
  workoutId: number | null
): void {
  getDb().runSync(
    'INSERT OR REPLACE INTO program_days (program_id, day_index, workout_id) VALUES (?, ?, ?)',
    [programId, dayIndex, workoutId]
  );
}

/** Create an empty workout owned by the program's custom phase. */
export function createProgramWorkout(programId: number, name: string): number {
  const program = getProgramById(programId);
  if (!program || program.phase_id == null) {
    throw new Error('Program not found or has no phase');
  }
  const result = getDb().runSync(
    'INSERT INTO workouts (phase_id, name, day_type) VALUES (?, ?, ?)',
    [program.phase_id, name.trim(), 'custom']
  );
  return result.lastInsertRowId;
}

/** All workouts belonging to a custom program (via its phase). */
export function getProgramWorkouts(programId: number) {
  const program = getProgramById(programId);
  if (!program || program.phase_id == null) return [];
  return getWorkoutsByPhase(program.phase_id);
}

export interface NewProgramExercise {
  name: string;
  muscleGroup: string;
  warmupSets: number;
  workingSets: number;
  targetReps: string;
  targetRpe: string;
  restSeconds: number;
}

/**
 * Append an exercise to a workout with explicit programming. Used when building
 * a program from a spec (e.g. AI-generated) rather than copying an existing row.
 */
export function addExerciseToWorkout(workoutId: number, ex: NewProgramExercise): number {
  const maxOrder = getDb().getFirstSync<{ max_order: number | null }>(
    'SELECT MAX(order_index) as max_order FROM exercises WHERE workout_id = ?',
    [workoutId]
  );
  const nextOrder = (maxOrder?.max_order ?? -1) + 1;
  const result = getDb().runSync(
    `INSERT INTO exercises
       (workout_id, name, order_index, warmup_sets, working_sets, target_reps,
        target_rpe, rest_seconds, notes, muscle_group, is_custom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, 1)`,
    [
      workoutId,
      ex.name.trim(),
      nextOrder,
      Math.max(0, ex.warmupSets),
      Math.max(1, ex.workingSets),
      ex.targetReps,
      ex.targetRpe,
      Math.max(0, ex.restSeconds),
      ex.muscleGroup,
    ]
  );
  return result.lastInsertRowId;
}

/** Distinct exercise names with their muscle group — the vocabulary for program generation. */
export function getExerciseCatalog(): { name: string; muscle_group: string }[] {
  return getDb().getAllSync<{ name: string; muscle_group: string }>(
    `SELECT name, COALESCE(MAX(muscle_group), '') as muscle_group
     FROM exercises
     WHERE name IS NOT NULL AND name != ''
     GROUP BY name
     ORDER BY muscle_group, name`
  );
}

export function getWorkoutById(workoutId: number) {
  return getDb().getFirstSync<{ id: number; phase_id: number; name: string; day_type: string }>(
    'SELECT * FROM workouts WHERE id = ?',
    [workoutId]
  );
}

// Workouts
export function getWorkoutsByPhase(phaseId: number) {
  return getDb().getAllSync<{ id: number; phase_id: number; name: string; day_type: string }>(
    'SELECT * FROM workouts WHERE phase_id = ? ORDER BY id',
    [phaseId]
  );
}

export function getWorkoutByPhaseAndType(phaseId: number, dayType: string) {
  return getDb().getFirstSync<{ id: number; phase_id: number; name: string; day_type: string }>(
    'SELECT * FROM workouts WHERE phase_id = ? AND day_type = ?',
    [phaseId, dayType]
  );
}

// Exercises
export function getExercisesByWorkout(workoutId: number) {
  return getDb().getAllSync<any>(
    'SELECT * FROM exercises WHERE workout_id = ? ORDER BY order_index',
    [workoutId]
  );
}

export function getExerciseById(id: number) {
  return getDb().getFirstSync<any>('SELECT * FROM exercises WHERE id = ?', [id]);
}

/** Match spreadsheet / display name to a row in `exercises` (exact or normalized whitespace). */
export function findExerciseIdByProgramName(name: string): number | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = norm(trimmed);
  const all = getAllExercises() as { id: number; name: string }[];
  const exact = all.find((e) => norm(e.name) === target);
  if (exact?.id != null) return exact.id;

  const canonical = resolveAliasToCanonicalExerciseName(target);
  if (canonical) {
    const target2 = norm(canonical);
    const byAlias = all.find((e) => norm(e.name) === target2);
    if (byAlias?.id != null) return byAlias.id;
  }

  const containing = all.filter((e) => {
    const en = norm(e.name);
    if (en.includes(target)) return true;
    if (target.length >= 12 && en.length >= 8 && target.includes(en)) return true;
    return false;
  });
  if (containing.length === 1) return containing[0].id;
  if (containing.length > 1) {
    const narrowed = containing.filter((e) => norm(e.name).includes(target));
    if (narrowed.length === 1) return narrowed[0].id;
  }
  return null;
}

export function getAllExercises() {
  return getDb().getAllSync<any>(
    `SELECT e.*, w.name as workout_name, p.name as phase_name
     FROM exercises e
     LEFT JOIN workouts w ON e.workout_id = w.id
     LEFT JOIN phases p ON w.phase_id = p.id
     ORDER BY e.muscle_group, e.name`
  );
}

export function getCustomExercises() {
  return getDb().getAllSync<any>(
    'SELECT * FROM exercises WHERE is_custom = 1 ORDER BY name'
  );
}

export function insertCustomExercise(
  name: string,
  muscleGroup: string,
  notes: string,
  warmupSets: number,
  workingSets: number,
  targetReps: string,
  targetRpe: string,
  restSeconds: number
): number {
  const result = getDb().runSync(
    `INSERT INTO exercises
       (name, muscle_group, notes, is_custom, warmup_sets, working_sets, target_reps, target_rpe, rest_seconds)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [name, muscleGroup, notes, warmupSets, workingSets, targetReps, targetRpe, restSeconds]
  );
  return result.lastInsertRowId;
}

/**
 * Resolve a substitution option name to an exercise id.
 * If the exercise does not exist yet, create it as a custom exercise by copying
 * the template exercise's volume/intensity/rest properties (only the name differs).
 * Returns the resolved or newly-created exercise id.
 *
 * Uses exact name matching only (no fuzzy/contains) so that e.g. "DB Bench Press"
 * never accidentally resolves to "DB Bench Press (No Leg Drive)".
 */
export function getOrCreateSubstitutionExercise(
  optionName: string,
  templateExerciseId: number
): number {
  const normStr = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = normStr(optionName);
  const all = getAllExercises() as { id: number; name: string }[];

  const exact = all.find((e) => normStr(e.name) === target);
  if (exact) return exact.id;

  const canonical = resolveAliasToCanonicalExerciseName(target);
  if (canonical) {
    const byAlias = all.find((e) => normStr(e.name) === normStr(canonical));
    if (byAlias) return byAlias.id;
  }

  const template = getExerciseById(templateExerciseId);
  const result = getDb().runSync(
    `INSERT INTO exercises
       (name, muscle_group, warmup_sets, working_sets, target_reps, target_rpe,
        rest_seconds, notes, is_custom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      optionName.trim(),
      template?.muscle_group ?? '',
      template?.warmup_sets ?? 0,
      template?.working_sets ?? 1,
      template?.target_reps ?? '',
      template?.target_rpe ?? '',
      template?.rest_seconds ?? 90,
      '',
    ]
  );
  return result.lastInsertRowId;
}

/** Update the warmup and working set counts for an exercise (affects future sessions). */
export function updateExerciseSetCounts(
  exerciseId: number,
  warmupSets: number,
  workingSets: number
): void {
  getDb().runSync(
    'UPDATE exercises SET warmup_sets = ?, working_sets = ? WHERE id = ?',
    [Math.max(0, warmupSets), Math.max(1, workingSets), exerciseId]
  );
}

/** Persist a new order_index for each exercise in the given array. */
export function saveExercisesOrder(entries: { id: number; orderIndex: number }[]): void {
  const db = getDb();
  for (const entry of entries) {
    db.runSync('UPDATE exercises SET order_index = ? WHERE id = ?', [entry.orderIndex, entry.id]);
  }
}

/** Duplicate an exercise's programming fields into a workout as a new slot. */
export function addExerciseToWorkoutFromSource(workoutId: number, sourceExerciseId: number): number {
  const source = getExerciseById(sourceExerciseId);
  if (!source) {
    throw new Error('Source exercise not found');
  }
  const maxOrder = getDb().getFirstSync<{ max_order: number | null }>(
    'SELECT MAX(order_index) as max_order FROM exercises WHERE workout_id = ?',
    [workoutId]
  );
  const nextOrder = (maxOrder?.max_order ?? -1) + 1;
  const result = getDb().runSync(
    `INSERT INTO exercises
       (workout_id, name, order_index, warmup_sets, working_sets, target_reps,
        target_rpe, rest_seconds, notes, muscle_group, is_superset, superset_group, is_custom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workoutId,
      source.name,
      nextOrder,
      source.warmup_sets ?? 0,
      source.working_sets ?? 1,
      source.target_reps ?? '',
      source.target_rpe ?? '',
      source.rest_seconds ?? 90,
      source.notes ?? '',
      source.muscle_group ?? '',
      source.is_superset ?? 0,
      source.superset_group ?? null,
      source.is_custom ?? 0,
    ]
  );
  return result.lastInsertRowId;
}

/** Remove an exercise row from a workout and compact the remaining order_index values. */
export function removeExerciseFromWorkout(exerciseId: number): void {
  const row = getDb().getFirstSync<{ workout_id: number | null }>(
    'SELECT workout_id FROM exercises WHERE id = ?',
    [exerciseId]
  );
  if (!row?.workout_id) return;
  getDb().runSync('DELETE FROM exercises WHERE id = ?', [exerciseId]);
  const remaining = getExercisesByWorkout(row.workout_id) as { id: number }[];
  saveExercisesOrder(remaining.map((ex, index) => ({ id: ex.id, orderIndex: index })));
}

// Sessions
export function createSession(workoutId: number, phaseId: number): number {
  const result = getDb().runSync(
    'INSERT INTO workout_sessions (workout_id, phase_id, started_at, workout_date) VALUES (?, ?, ?, ?)',
    [workoutId, phaseId, new Date().toISOString(), toLocalDateYmd()]
  );
  return result.lastInsertRowId;
}

export function completeSession(sessionId: number): void {
  getDb().runSync(
    'UPDATE workout_sessions SET completed_at = ?, workout_date = ? WHERE id = ?',
    [new Date().toISOString(), toLocalDateYmd(), sessionId]
  );
}

/** Remove an in-progress session (no completed_at). Orphan set_logs are removed first. */
export function deleteIncompleteSession(sessionId: number): void {
  const db = getDb();
  db.runSync('DELETE FROM set_logs WHERE session_id = ?', [sessionId]);
  db.runSync('DELETE FROM workout_sessions WHERE id = ? AND completed_at IS NULL', [sessionId]);
}

/** True when the session exists and is still in-progress (completed_at is null). */
export function isIncompleteSession(sessionId: number): boolean {
  const row = getDb().getFirstSync<{ id: number }>(
    'SELECT id FROM workout_sessions WHERE id = ? AND completed_at IS NULL',
    [sessionId]
  );
  return !!row;
}

/** Delete a finished workout and its set logs. Returns false if the session does not exist or is not completed. */
export function deleteCompletedWorkoutSession(sessionId: number): boolean {
  const db = getDb();
  const row = db.getFirstSync<{ id: number }>(
    'SELECT id FROM workout_sessions WHERE id = ? AND completed_at IS NOT NULL',
    [sessionId]
  );
  if (!row) return false;
  db.runSync('DELETE FROM set_logs WHERE session_id = ?', [sessionId]);
  db.runSync('DELETE FROM workout_sessions WHERE id = ?', [sessionId]);
  return true;
}

export function getRecentSessions(limit = 30) {
  return getDb().getAllSync<any>(
    `SELECT s.*, w.name as workout_name, w.day_type
     FROM workout_sessions s
     JOIN workouts w ON s.workout_id = w.id
     WHERE s.completed_at IS NOT NULL
     ORDER BY s.completed_at DESC
     LIMIT ?`,
    [limit]
  );
}

export function getSessionsByDateRange(startDate: string, endDate: string) {
  return getDb().getAllSync<any>(
    `SELECT s.*, w.name as workout_name, w.day_type
     FROM workout_sessions s
     JOIN workouts w ON s.workout_id = w.id
     WHERE s.completed_at IS NOT NULL
       AND date(datetime(s.completed_at, 'localtime')) >= ? AND date(datetime(s.completed_at, 'localtime')) <= ?
     ORDER BY s.completed_at DESC`,
    [startDate, endDate]
  );
}

export function getSessionDetail(sessionId: number) {
  return getDb().getAllSync<any>(
    `SELECT sl.*, e.name as exercise_name, e.muscle_group
     FROM set_logs sl
     JOIN exercises e ON sl.exercise_id = e.id
     WHERE sl.session_id = ?
     ORDER BY sl.exercise_order, sl.set_number`,
    [sessionId]
  );
}

// Set logs
export function logSet(
  sessionId: number,
  exerciseId: number,
  exerciseOrder: number,
  setNumber: number,
  setType: string,
  weight: number,
  reps: number,
  rpe?: number,
  machineBrand?: string | null
): void {
  getDb().runSync(
    `INSERT INTO set_logs (session_id, exercise_id, exercise_order, set_number, set_type, weight, reps, rpe, machine_brand, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      exerciseId,
      exerciseOrder,
      setNumber,
      setType,
      weight,
      reps,
      rpe ?? null,
      machineBrand && machineBrand.trim() !== '' ? machineBrand.trim() : null,
      new Date().toISOString(),
    ]
  );
}

export function getPreviousSetsForExercise(exerciseId: number, limit = 10) {
  return getDb().getAllSync<any>(
    `SELECT sl.*
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL
     ORDER BY ws.completed_at DESC, sl.set_number ASC
     LIMIT ?`,
    [exerciseId, limit]
  );
}

/**
 * Sets from the most recent completed session for an exercise.
 * When `brand` is provided the lookup is siloed to that machine brand
 * (pass null for the "No brand" / legacy silo; omit the argument to ignore
 * brand entirely).
 */
export function getLastSessionSetsForExercise(exerciseId: number, brand?: string | null) {
  const byBrand = brand !== undefined;
  const brandClause = !byBrand
    ? ''
    : brand === null || brand === ''
      ? ' AND sl.machine_brand IS NULL'
      : ' AND sl.machine_brand = ?';
  const brandParams = byBrand && brand !== null && brand !== '' ? [brand] : [];

  const lastSession = getDb().getFirstSync<{ session_id: number }>(
    `SELECT sl.session_id
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ?${brandClause} AND ws.completed_at IS NOT NULL
     ORDER BY ws.completed_at DESC
     LIMIT 1`,
    [exerciseId, ...brandParams]
  );
  if (!lastSession) return [];

  const rowBrandClause = !byBrand
    ? ''
    : brand === null || brand === ''
      ? ' AND machine_brand IS NULL'
      : ' AND machine_brand = ?';
  return getDb().getAllSync<any>(
    `SELECT * FROM set_logs WHERE session_id = ? AND exercise_id = ?${rowBrandClause} ORDER BY set_number`,
    [lastSession.session_id, exerciseId, ...brandParams]
  );
}

// Analytics

/**
 * SQL fragment + params to constrain set_logs (alias `sl`) to one machine brand.
 * `undefined` = no filter (aggregate); `null`/'' = the "No brand" silo; string = that brand.
 * Machine-tracked exercises use this so different machines' weights don't get
 * mixed into a single progression/PR.
 */
function brandFilterSql(brand: string | null | undefined): { clause: string; params: any[] } {
  if (brand === undefined) return { clause: '', params: [] };
  if (brand === null || brand === '') return { clause: " AND sl.machine_brand IS NULL", params: [] };
  return { clause: ' AND sl.machine_brand = ?', params: [brand] };
}

/** Distinct machine brands with logged data for an exercise, plus whether any un-branded sets exist. */
export function getExerciseLoggedBrands(exerciseId: number): { brands: string[]; hasNoBrand: boolean } {
  const rows = getDb().getAllSync<{ machine_brand: string | null }>(
    `SELECT DISTINCT sl.machine_brand
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL`,
    [exerciseId]
  );
  const brands: string[] = [];
  let hasNoBrand = false;
  for (const r of rows) {
    if (r.machine_brand == null || r.machine_brand === '') hasNoBrand = true;
    else brands.push(r.machine_brand);
  }
  brands.sort((a, b) => a.localeCompare(b));
  return { brands, hasNoBrand };
}

export function getExerciseVolumeHistory(exerciseId: number, brand?: string | null) {
  const b = brandFilterSql(brand);
  return getDb().getAllSync<{ date: string; total_volume: number; max_weight: number; total_reps: number }>(
    `SELECT
       date(datetime(ws.completed_at, 'localtime')) as date,
       SUM(CASE WHEN sl.weight > 0 THEN sl.weight * sl.reps ELSE sl.reps END) as total_volume,
       MAX(sl.weight) as max_weight,
       SUM(sl.reps) as total_reps
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'${b.clause}
     GROUP BY date(datetime(ws.completed_at, 'localtime'))
     ORDER BY date ASC
     LIMIT 30`,
    [exerciseId, ...b.params]
  );
}

export function getExerciseWeightHistory(exerciseId: number, brand?: string | null) {
  const b = brandFilterSql(brand);
  return getDb().getAllSync<{ date: string; max_weight: number; avg_weight: number }>(
    `SELECT
       date(datetime(ws.completed_at, 'localtime')) as date,
       MAX(sl.weight) as max_weight,
       AVG(sl.weight) as avg_weight
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'${b.clause}
     GROUP BY date(datetime(ws.completed_at, 'localtime'))
     ORDER BY date ASC
     LIMIT 30`,
    [exerciseId, ...b.params]
  );
}

export function getExercisePR(exerciseId: number, brand?: string | null) {
  const b = brandFilterSql(brand);
  return getDb().getFirstSync<{ max_weight: number; reps: number; date: string }>(
    `SELECT sl.weight as max_weight, sl.reps, date(datetime(ws.completed_at, 'localtime')) as date
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'${b.clause}
     ORDER BY sl.weight DESC, sl.reps DESC
     LIMIT 1`,
    [exerciseId, ...b.params]
  );
}

/**
 * Whole-history totals for an exercise across every machine brand. These are the
 * brand-agnostic metrics (session count, reps, volume, best estimated 1RM) that
 * stay meaningful even though raw weights differ between machines.
 */
export function getExerciseAggregateStats(exerciseId: number): {
  sessions: number;
  total_reps: number;
  total_volume: number;
  best_e1rm: number;
} {
  const row = getDb().getFirstSync<{
    sessions: number | null;
    total_reps: number | null;
    total_volume: number | null;
    best_e1rm: number | null;
  }>(
    `SELECT
       COUNT(DISTINCT ws.id) as sessions,
       SUM(sl.reps) as total_reps,
       SUM(CASE WHEN sl.weight > 0 THEN sl.weight * sl.reps ELSE sl.reps END) as total_volume,
       MAX(ROUND(sl.weight * (1.0 + sl.reps / 30.0), 1)) as best_e1rm
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working' AND sl.reps > 0`,
    [exerciseId]
  );
  return {
    sessions: row?.sessions ?? 0,
    total_reps: row?.total_reps ?? 0,
    total_volume: Math.round(row?.total_volume ?? 0),
    best_e1rm: row?.best_e1rm ?? 0,
  };
}

export function getLifetimeStats() {
  const db = getDb();
  const sessions = db.getFirstSync<{ total: number }>(
    `SELECT COUNT(*) as total FROM workout_sessions WHERE completed_at IS NOT NULL`
  );
  const volume = db.getFirstSync<{ total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN sl.weight > 0 THEN sl.weight * sl.reps ELSE sl.reps END), 0) as total
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE ws.completed_at IS NOT NULL AND sl.set_type = 'working' AND sl.reps > 0`
  );
  const completedByDate = db.getAllSync<{ d: string }>(
    `SELECT DISTINCT date(datetime(completed_at, 'localtime')) as d
     FROM workout_sessions
     WHERE completed_at IS NOT NULL
     ORDER BY d ASC`
  );

  let currentStreak = 0;
  let longestStreak = 0;
  if (completedByDate.length > 0) {
    const sortedDates = completedByDate.map((r) => r.d); // already distinct + sorted from SQL
    const workoutDateSet = new Set<string>(sortedDates);

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    // Current streak: walk backwards from today, counting workout days.
    // One consecutive rest-day gap is allowed (the program has at most 1 rest day
    // between workout blocks), so the streak only breaks after 2+ empty days.
    const cursor = new Date(today);
    let gap = 0;
    while (toLocalDateYmd(cursor) >= sortedDates[0]) {
      const ymd = toLocalDateYmd(cursor);
      if (workoutDateSet.has(ymd)) {
        currentStreak++;
        gap = 0;
      } else {
        gap++;
        if (gap > 1) break;
      }
      cursor.setDate(cursor.getDate() - 1);
    }

    // Longest streak: walk through sorted workout dates; a gap of ≤2 calendar
    // days between consecutive workouts counts as unbroken (1 rest day allowed).
    if (sortedDates.length === 1) {
      longestStreak = 1;
    } else {
      let run = 1;
      longestStreak = 1;
      for (let i = 1; i < sortedDates.length; i++) {
        const prev = new Date(`${sortedDates[i - 1]}T12:00:00`);
        const curr = new Date(`${sortedDates[i]}T12:00:00`);
        const dayGap = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        run = dayGap <= 2 ? run + 1 : 1;
        if (run > longestStreak) longestStreak = run;
      }
    }
  }

  return {
    totalSessions: sessions?.total ?? 0,
    totalVolume: volume?.total ?? 0,
    currentStreak,
    longestStreak,
  };
}

export function getSessionDates(days = 90): string[] {
  const db = getDb();
  const rows = db.getAllSync<{ d: string }>(
    `SELECT date(datetime(completed_at, 'localtime')) as d
     FROM workout_sessions
     WHERE completed_at IS NOT NULL
       AND completed_at >= date('now', ?)
     ORDER BY d ASC`,
    [`-${days} days`]
  );
  return rows.map((r) => r.d);
}

export function getSessionVolumes(days = 90): { date: string; volume: number }[] {
  const db = getDb();
  return db.getAllSync<{ date: string; volume: number }>(
    `SELECT date(datetime(ws.completed_at, 'localtime')) as date,
            SUM(CASE WHEN sl.weight > 0 THEN sl.weight * sl.reps ELSE sl.reps END) as volume
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE ws.completed_at IS NOT NULL
       AND ws.completed_at >= date('now', ?)
       AND sl.set_type = 'working'
       AND sl.reps > 0
     GROUP BY date
     ORDER BY date ASC`,
    [`-${days} days`]
  );
}

export function getMuscleGroupVolume(days = 30) {
  const db = getDb();
  const rows = db.getAllSync<{ muscle_group: string; total_volume: number }>(
    `SELECT e.muscle_group,
            SUM(CASE WHEN sl.weight > 0 THEN sl.weight * sl.reps ELSE sl.reps END) as total_volume
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     JOIN exercises e ON sl.exercise_id = e.id
     WHERE ws.completed_at IS NOT NULL
       AND ws.completed_at >= date('now', ?)
       AND sl.set_type = 'working'
       AND sl.reps > 0
       AND e.muscle_group IS NOT NULL
       AND e.muscle_group != ''
     GROUP BY e.muscle_group
     ORDER BY total_volume DESC`,
    [`-${days} days`]
  );
  return rows;
}

export function getRecentPRs(limit = 10, days = 60) {
  const db = getDb();
  return db.getAllSync<{
    exercise_name: string;
    max_weight: number;
    reps: number;
    date: string;
    estimated_1rm: number;
  }>(
    `SELECT e.name as exercise_name,
            sl.weight as max_weight,
            sl.reps,
            date(datetime(ws.completed_at, 'localtime')) as date,
            ROUND(sl.weight * (1.0 + sl.reps / 30.0), 1) as estimated_1rm
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     JOIN exercises e ON sl.exercise_id = e.id
     WHERE ws.completed_at IS NOT NULL
       AND ws.completed_at >= date('now', ?)
       AND sl.set_type = 'working'
       AND sl.weight > 0
       AND sl.reps > 0
     GROUP BY sl.exercise_id
     HAVING sl.weight = MAX(sl.weight)
     ORDER BY ws.completed_at DESC
     LIMIT ?`,
    [`-${days} days`, limit]
  );
}

export function getTop1RMs(limit = 15) {
  const db = getDb();
  return db.getAllSync<{
    exercise_id: number;
    exercise_name: string;
    best_weight: number;
    best_reps: number;
    estimated_1rm: number;
    last_date: string;
  }>(
    `SELECT
       e.id AS exercise_id,
       e.name AS exercise_name,
       sl.weight AS best_weight,
       sl.reps AS best_reps,
       ROUND(sl.weight * (1.0 + sl.reps / 30.0), 1) AS estimated_1rm,
       date(datetime(MAX(ws.completed_at), 'localtime')) AS last_date
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     JOIN exercises e ON sl.exercise_id = e.id
     WHERE ws.completed_at IS NOT NULL
       AND sl.set_type = 'working'
       AND sl.weight > 0
       AND sl.reps > 0
     GROUP BY sl.exercise_id
     HAVING ROUND(sl.weight * (1.0 + sl.reps / 30.0), 1) = MAX(ROUND(sl.weight * (1.0 + sl.reps / 30.0), 1))
     ORDER BY estimated_1rm DESC
     LIMIT ?`,
    [limit]
  );
}

export function getEstimated1RMHistory(exerciseId: number, brand?: string | null) {
  const b = brandFilterSql(brand);
  const db = getDb();
  return db.getAllSync<{ date: string; estimated_1rm: number; weight: number; reps: number }>(
    `SELECT
       date(datetime(ws.completed_at, 'localtime')) as date,
       ROUND(MAX(sl.weight * (1.0 + sl.reps / 30.0)), 1) as estimated_1rm,
       sl.weight,
       sl.reps
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'
       AND sl.reps > 0 AND sl.weight > 0${b.clause}
     GROUP BY date(datetime(ws.completed_at, 'localtime'))
     ORDER BY date ASC
     LIMIT 30`,
    [exerciseId, ...b.params]
  );
}

/** Estimated 1RM per session for a single exercise within a day range. */
export function get1RMHistoryInRange(
  exerciseId: number,
  days: number
): { date: string; estimated_1rm: number }[] {
  return getDb().getAllSync<{ date: string; estimated_1rm: number }>(
    `SELECT
       date(datetime(ws.completed_at, 'localtime')) as date,
       ROUND(MAX(sl.weight * (1.0 + sl.reps / 30.0)), 1) as estimated_1rm
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ?
       AND ws.completed_at IS NOT NULL
       AND ws.completed_at >= date('now', ?)
       AND sl.set_type = 'working'
       AND sl.reps > 0 AND sl.weight > 0
     GROUP BY date(datetime(ws.completed_at, 'localtime'))
     ORDER BY date ASC`,
    [exerciseId, `-${days} days`]
  );
}

/** All distinct workout dates within the range (YYYY-MM-DD). */
export function getWorkoutDatesInRange(days: number): string[] {
  const rows = getDb().getAllSync<{ d: string }>(
    `SELECT DISTINCT date(datetime(completed_at, 'localtime')) as d
     FROM workout_sessions
     WHERE completed_at IS NOT NULL
       AND completed_at >= date('now', ?)
     ORDER BY d ASC`,
    [`-${days} days`]
  );
  return rows.map((r) => r.d);
}

/** Average completed session duration in minutes within the range. */
export function getAvgSessionDurationMins(days: number): number {
  const row = getDb().getFirstSync<{ avg_mins: number | null }>(
    `SELECT AVG((julianday(completed_at) - julianday(started_at)) * 1440) as avg_mins
     FROM workout_sessions
     WHERE completed_at IS NOT NULL
       AND started_at IS NOT NULL
       AND completed_at >= date('now', ?)`,
    [`-${days} days`]
  );
  return Math.round(row?.avg_mins ?? 0);
}

export function getBodyWeightEntries(days: number): { date: string; lbs: number }[] {
  return getDb().getAllSync<{ date: string; lbs: number }>(
    `SELECT logged_date as date, weight_lbs as lbs
     FROM body_weight_log
     WHERE logged_date >= date('now', ?)
     ORDER BY logged_date ASC`,
    [`-${days} days`]
  );
}

/** Total volume (weight * reps, or reps for bodyweight) across all working sets in the last N days. */
export function getTotalVolumeForDays(days: number): number {
  const row = getDb().getFirstSync<{ total: number | null }>(
    `SELECT SUM(CASE WHEN sl.weight > 0 THEN sl.weight * sl.reps ELSE sl.reps END) as total
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE ws.completed_at IS NOT NULL
       AND ws.completed_at >= date('now', ?)
       AND sl.set_type = 'working'
       AND sl.reps > 0`,
    [`-${days} days`]
  );
  return row?.total ?? 0;
}
