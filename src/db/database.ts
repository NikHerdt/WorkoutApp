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
      notes TEXT,
      FOREIGN KEY (workout_id) REFERENCES workouts(id)
    );

    CREATE TABLE IF NOT EXISTS set_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
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
  `);

  migrateKgToLbs(database);

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
    'SELECT * FROM phases ORDER BY id'
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

export function insertCustomExercise(name: string, muscleGroup: string, notes: string): number {
  const result = getDb().runSync(
    `INSERT INTO exercises (name, muscle_group, notes, is_custom, working_sets, target_reps, rest_seconds)
     VALUES (?, ?, ?, 1, 3, '8-12', 90)`,
    [name, muscleGroup, notes]
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

// Sessions
export function createSession(workoutId: number, phaseId: number): number {
  const result = getDb().runSync(
    'INSERT INTO workout_sessions (workout_id, phase_id, started_at) VALUES (?, ?, ?)',
    [workoutId, phaseId, new Date().toISOString()]
  );
  return result.lastInsertRowId;
}

export function completeSession(sessionId: number): void {
  getDb().runSync(
    'UPDATE workout_sessions SET completed_at = ? WHERE id = ?',
    [new Date().toISOString(), sessionId]
  );
}

/** Remove an in-progress session (no completed_at). Orphan set_logs are removed first. */
export function deleteIncompleteSession(sessionId: number): void {
  const db = getDb();
  db.runSync('DELETE FROM set_logs WHERE session_id = ?', [sessionId]);
  db.runSync('DELETE FROM workout_sessions WHERE id = ? AND completed_at IS NULL', [sessionId]);
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
     ORDER BY sl.exercise_id, sl.set_number`,
    [sessionId]
  );
}

// Set logs
export function logSet(
  sessionId: number,
  exerciseId: number,
  setNumber: number,
  setType: string,
  weight: number,
  reps: number,
  rpe?: number
): void {
  getDb().runSync(
    `INSERT INTO set_logs (session_id, exercise_id, set_number, set_type, weight, reps, rpe, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, exerciseId, setNumber, setType, weight, reps, rpe ?? null, new Date().toISOString()]
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

export function getLastSessionSetsForExercise(exerciseId: number) {
  const lastSession = getDb().getFirstSync<{ session_id: number }>(
    `SELECT sl.session_id
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL
     ORDER BY ws.completed_at DESC
     LIMIT 1`,
    [exerciseId]
  );
  if (!lastSession) return [];

  return getDb().getAllSync<any>(
    `SELECT * FROM set_logs WHERE session_id = ? AND exercise_id = ? ORDER BY set_number`,
    [lastSession.session_id, exerciseId]
  );
}

// Analytics
export function getExerciseVolumeHistory(exerciseId: number) {
  return getDb().getAllSync<{ date: string; total_volume: number; max_weight: number; total_reps: number }>(
    `SELECT
       date(datetime(ws.completed_at, 'localtime')) as date,
       SUM(sl.weight * sl.reps) as total_volume,
       MAX(sl.weight) as max_weight,
       SUM(sl.reps) as total_reps
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'
     GROUP BY date(datetime(ws.completed_at, 'localtime'))
     ORDER BY date ASC
     LIMIT 30`,
    [exerciseId]
  );
}

export function getExerciseWeightHistory(exerciseId: number) {
  return getDb().getAllSync<{ date: string; max_weight: number; avg_weight: number }>(
    `SELECT
       date(datetime(ws.completed_at, 'localtime')) as date,
       MAX(sl.weight) as max_weight,
       AVG(sl.weight) as avg_weight
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'
     GROUP BY date(datetime(ws.completed_at, 'localtime'))
     ORDER BY date ASC
     LIMIT 30`,
    [exerciseId]
  );
}

export function getExercisePR(exerciseId: number) {
  return getDb().getFirstSync<{ max_weight: number; reps: number; date: string }>(
    `SELECT sl.weight as max_weight, sl.reps, date(datetime(ws.completed_at, 'localtime')) as date
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'
     ORDER BY sl.weight DESC, sl.reps DESC
     LIMIT 1`,
    [exerciseId]
  );
}

export function getLifetimeStats() {
  const db = getDb();
  const sessions = db.getFirstSync<{ total: number }>(
    `SELECT COUNT(*) as total FROM workout_sessions WHERE completed_at IS NOT NULL`
  );
  const volume = db.getFirstSync<{ total: number }>(
    `SELECT COALESCE(SUM(sl.weight * sl.reps), 0) as total
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE ws.completed_at IS NOT NULL AND sl.set_type = 'working'`
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

export function getWeeklySessionCounts(weeks = 12) {
  const db = getDb();
  const rows = db.getAllSync<{ week: string; count: number }>(
    `SELECT strftime('%Y-W%W', datetime(completed_at, 'localtime')) as week, COUNT(*) as count
     FROM workout_sessions
     WHERE completed_at IS NOT NULL
       AND completed_at >= date('now', ?)
     GROUP BY week
     ORDER BY week ASC`,
    [`-${weeks * 7} days`]
  );
  return rows;
}

export function getWeeklyVolumeTotals(weeks = 12) {
  const db = getDb();
  const rows = db.getAllSync<{ week: string; total_volume: number }>(
    `SELECT strftime('%Y-W%W', datetime(ws.completed_at, 'localtime')) as week,
            SUM(sl.weight * sl.reps) as total_volume
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE ws.completed_at IS NOT NULL
       AND ws.completed_at >= date('now', ?)
       AND sl.set_type = 'working'
     GROUP BY week
     ORDER BY week ASC`,
    [`-${weeks * 7} days`]
  );
  return rows;
}

export function getMuscleGroupVolume(days = 30) {
  const db = getDb();
  const rows = db.getAllSync<{ muscle_group: string; total_volume: number }>(
    `SELECT e.muscle_group,
            SUM(sl.weight * sl.reps) as total_volume
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     JOIN exercises e ON sl.exercise_id = e.id
     WHERE ws.completed_at IS NOT NULL
       AND ws.completed_at >= date('now', ?)
       AND sl.set_type = 'working'
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

export function getEstimated1RMHistory(exerciseId: number) {
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
       AND sl.reps > 0 AND sl.weight > 0
     GROUP BY date(datetime(ws.completed_at, 'localtime'))
     ORDER BY date ASC
     LIMIT 30`,
    [exerciseId]
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

/** Weekly body-weight averages aligned to week buckets (same key format as getWeeklyVolumeTotals). */
export function getWeeklyBodyWeightForRange(days: number): { week: string; avg_lbs: number }[] {
  return getDb().getAllSync<{ week: string; avg_lbs: number }>(
    `SELECT
       strftime('%Y-W%W', logged_date) as week,
       AVG(weight_lbs) as avg_lbs
     FROM body_weight_log
     WHERE logged_date >= date('now', ?)
     GROUP BY week
     ORDER BY week ASC`,
    [`-${days} days`]
  );
}
