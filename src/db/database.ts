import * as SQLite from 'expo-sqlite';
import { SEED_DATA } from './seed';

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
  `);

  const seeded = database.getFirstSync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'seeded'"
  );

  if (!seeded) {
    seedDatabase(database);
    database.runSync("INSERT INTO settings (key, value) VALUES ('seeded', '1')");
    database.runSync("INSERT OR IGNORE INTO settings (key, value) VALUES ('schedule_day', '0')");
    database.runSync("INSERT OR IGNORE INTO settings (key, value) VALUES ('current_phase_id', '1')");
  }
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
       AND date(s.completed_at) >= ? AND date(s.completed_at) <= ?
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
       date(ws.completed_at) as date,
       SUM(sl.weight * sl.reps) as total_volume,
       MAX(sl.weight) as max_weight,
       SUM(sl.reps) as total_reps
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'
     GROUP BY date(ws.completed_at)
     ORDER BY date ASC
     LIMIT 30`,
    [exerciseId]
  );
}

export function getExerciseWeightHistory(exerciseId: number) {
  return getDb().getAllSync<{ date: string; max_weight: number; avg_weight: number }>(
    `SELECT
       date(ws.completed_at) as date,
       MAX(sl.weight) as max_weight,
       AVG(sl.weight) as avg_weight
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'
     GROUP BY date(ws.completed_at)
     ORDER BY date ASC
     LIMIT 30`,
    [exerciseId]
  );
}

export function getExercisePR(exerciseId: number) {
  return getDb().getFirstSync<{ max_weight: number; reps: number; date: string }>(
    `SELECT sl.weight as max_weight, sl.reps, date(ws.completed_at) as date
     FROM set_logs sl
     JOIN workout_sessions ws ON sl.session_id = ws.id
     WHERE sl.exercise_id = ? AND ws.completed_at IS NOT NULL AND sl.set_type = 'working'
     ORDER BY sl.weight DESC, sl.reps DESC
     LIMIT 1`,
    [exerciseId]
  );
}
