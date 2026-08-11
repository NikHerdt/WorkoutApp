/**
 * Migration: make an exercise a shared, program-independent record.
 *
 * Before, `exercises` conflated two things — the movement itself and its slot in
 * one workout — so the same movement existed as N rows (one per workout/phase),
 * splitting its history and cluttering the exercise list.
 *
 * After, `exercises` is a catalog of distinct movements and `workout_exercises`
 * holds the slots. Crucially, a slot keeps its *own* programming as overrides:
 * the built-in plan deliberately prescribes e.g. Bench Press at 3-5 reps / 210s
 * rest in one phase and 5-7 / 150s in another, and flattening those would
 * destroy the periodization. Effective value = slot override ?? exercise default.
 *
 * Set logs are repointed to the surviving row, so all history is preserved and
 * previously-split stats consolidate.
 *
 * Written against a minimal DB interface so it can be exercised in tests
 * without the native SQLite module.
 */

/**
 * Minimal shape shared by expo-sqlite's SQLiteDatabase and the test adapter.
 * Params are always supplied explicitly so the signature stays compatible with
 * expo-sqlite's overloads.
 */
export interface MigrationDb {
  execSync(sql: string): void;
  runSync(sql: string, params: any[]): unknown;
  getAllSync<T>(sql: string, params: any[]): T[];
  getFirstSync<T>(sql: string, params: any[]): T | null | undefined;
}

interface ExerciseRow {
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

export function normalizeExerciseName(name: string): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Remap the numeric exercise id inside a settings map key ("12" or "12|Brand"). */
function remapKeyedMap(
  raw: string | null | undefined,
  idMap: Map<number, number>
): string | null {
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const [idPart, ...restParts] = key.split('|');
    const oldId = Number(idPart);
    if (!Number.isFinite(oldId)) {
      out[key] = value;
      continue;
    }
    const newId = idMap.get(oldId) ?? oldId;
    const newKey = restParts.length ? `${newId}|${restParts.join('|')}` : String(newId);
    // First writer wins: the canonical row's own entry is inserted first below.
    if (!(newKey in out)) out[newKey] = value;
  }
  return JSON.stringify(out);
}

/**
 * phaseId -> { templateExerciseId -> replacementExerciseId }; both sides are ids.
 * Entries that don't resolve to a surviving exercise are dropped — some data
 * predates this migration and already referenced deleted rows, and such an entry
 * can never fire.
 */
function remapSubstitutions(
  raw: string | null | undefined,
  idMap: Map<number, number>,
  liveIds: Set<number>
): string | null {
  if (!raw) return null;
  let parsed: Record<string, Record<string, number>>;
  try {
    parsed = JSON.parse(raw) as Record<string, Record<string, number>>;
  } catch {
    return null;
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [phaseKey, inner] of Object.entries(parsed)) {
    if (!inner || typeof inner !== 'object') continue;
    const mapped: Record<string, number> = {};
    for (const [templateKey, replacementId] of Object.entries(inner)) {
      const t = Number(templateKey);
      const r = Number(replacementId);
      if (!Number.isFinite(t) || !Number.isFinite(r)) continue;
      const newT = idMap.get(t);
      const newR = idMap.get(r);
      if (newT === undefined || newR === undefined) continue; // stale reference
      if (!liveIds.has(newT) || !liveIds.has(newR)) continue;
      // A substitution that now points at itself is a no-op — drop it.
      if (newT === newR) continue;
      if (!(String(newT) in mapped)) mapped[String(newT)] = newR;
    }
    if (Object.keys(mapped).length > 0) out[phaseKey] = mapped;
  }
  return JSON.stringify(out);
}

function readSetting(db: MigrationDb, key: string): string | null {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

function writeSetting(db: MigrationDb, key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

/**
 * Null out slot overrides that merely restate the exercise's default.
 *
 * A redundant override is invisible but harmful: it masks the shared default, so
 * editing an exercise's rest timer or set counts would appear to do nothing.
 * Effective programming is unchanged — COALESCE resolves to the same value.
 */
export function clearRedundantSlotOverrides(db: MigrationDb): number {
  const before = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM workout_exercises we JOIN exercises e ON we.exercise_id = e.id
     WHERE we.warmup_sets  = e.warmup_sets  OR we.working_sets = e.working_sets
        OR we.target_reps  = e.target_reps  OR we.target_rpe   = e.target_rpe
        OR we.rest_seconds = e.rest_seconds`,
    []
  );

  db.runSync(
    `UPDATE workout_exercises
       SET warmup_sets  = CASE WHEN warmup_sets  = (SELECT warmup_sets  FROM exercises WHERE id = exercise_id) THEN NULL ELSE warmup_sets  END,
           working_sets = CASE WHEN working_sets = (SELECT working_sets FROM exercises WHERE id = exercise_id) THEN NULL ELSE working_sets END,
           target_reps  = CASE WHEN target_reps  = (SELECT target_reps  FROM exercises WHERE id = exercise_id) THEN NULL ELSE target_reps  END,
           target_rpe   = CASE WHEN target_rpe   = (SELECT target_rpe   FROM exercises WHERE id = exercise_id) THEN NULL ELSE target_rpe   END,
           rest_seconds = CASE WHEN rest_seconds = (SELECT rest_seconds FROM exercises WHERE id = exercise_id) THEN NULL ELSE rest_seconds END`,
    []
  );

  return before?.n ?? 0;
}

export interface MergeReport {
  exercisesBefore: number;
  exercisesAfter: number;
  slotsCreated: number;
  setLogsRepointed: number;
  groupsMerged: number;
}

/**
 * Collapse duplicate exercises and populate `workout_exercises`.
 * Assumes the `workout_exercises` table already exists and is empty.
 */
export function mergeDuplicateExercises(db: MigrationDb): MergeReport {
  const exercises = db.getAllSync<ExerciseRow>('SELECT * FROM exercises', []);
  const exercisesBefore = exercises.length;

  // How much history each row carries — the row with the most stays canonical so
  // the fewest set_logs need repointing.
  const logCounts = new Map<number, number>();
  for (const row of db.getAllSync<{ exercise_id: number; n: number }>(
    'SELECT exercise_id, COUNT(*) as n FROM set_logs GROUP BY exercise_id',
    []
  )) {
    logCounts.set(row.exercise_id, row.n);
  }

  const groups = new Map<string, ExerciseRow[]>();
  for (const ex of exercises) {
    const key = normalizeExerciseName(ex.name);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(ex);
    else groups.set(key, [ex]);
  }

  // oldExerciseId -> canonical exercise id (identity for canonical rows).
  const idMap = new Map<number, number>();
  const canonicalIds: number[] = [];
  let groupsMerged = 0;

  for (const rows of groups.values()) {
    const canonical = [...rows].sort((a, b) => {
      const diff = (logCounts.get(b.id) ?? 0) - (logCounts.get(a.id) ?? 0);
      if (diff !== 0) return diff;
      return a.id - b.id;
    })[0];
    canonicalIds.push(canonical.id);
    if (rows.length > 1) groupsMerged++;
    for (const row of rows) idMap.set(row.id, canonical.id);
  }

  // 1. Every row that sat in a workout becomes a slot, keeping its own
  //    programming as an override so each day's prescription is preserved.
  let slotsCreated = 0;
  const inWorkout = exercises
    .filter((e) => e.workout_id != null)
    .sort((a, b) => a.workout_id! - b.workout_id! || a.order_index - b.order_index || a.id - b.id);

  const byId = new Map(exercises.map((e) => [e.id, e]));

  for (const ex of inWorkout) {
    const canonicalId = idMap.get(ex.id) ?? ex.id;
    const canonical = byId.get(canonicalId)!;

    // Only store a value where this day actually differs from the shared
    // exercise. Slots that match inherit, so editing the exercise's defaults
    // later visibly updates them instead of being masked by a redundant copy.
    const override = <T>(slotValue: T, defaultValue: T): T | null =>
      String(slotValue ?? '') === String(defaultValue ?? '') ? null : slotValue;

    db.runSync(
      `INSERT INTO workout_exercises
         (workout_id, exercise_id, order_index, warmup_sets, working_sets,
          target_reps, target_rpe, rest_seconds, is_superset, superset_group)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ex.workout_id,
        canonicalId,
        ex.order_index,
        override(ex.warmup_sets, canonical.warmup_sets),
        override(ex.working_sets, canonical.working_sets),
        override(ex.target_reps, canonical.target_reps),
        override(ex.target_rpe, canonical.target_rpe),
        override(ex.rest_seconds, canonical.rest_seconds),
        ex.is_superset ?? 0,
        ex.superset_group ?? null,
      ]
    );
    slotsCreated++;
  }

  // 2. Repoint history onto the surviving rows.
  let setLogsRepointed = 0;
  for (const [oldId, newId] of idMap) {
    if (oldId === newId) continue;
    const n = logCounts.get(oldId) ?? 0;
    if (n > 0) {
      db.runSync('UPDATE set_logs SET exercise_id = ? WHERE exercise_id = ?', [newId, oldId]);
      setLogsRepointed += n;
    }
  }

  // 3. Remap exercise-id-keyed settings. Canonical entries are written first so
  //    "first writer wins" keeps the surviving row's own values.
  const orderedIdMap = new Map<number, number>();
  for (const id of canonicalIds) orderedIdMap.set(id, id);
  for (const [oldId, newId] of idMap) if (!orderedIdMap.has(oldId)) orderedIdMap.set(oldId, newId);

  for (const key of [
    'exercise_warmup_presets',
    'machine_brand_tracking_overrides',
    'exercise_selected_brand',
  ]) {
    const remapped = remapKeyedMap(readSetting(db, key), orderedIdMap);
    if (remapped !== null) writeSetting(db, key, remapped);
  }
  const keep = new Set(canonicalIds);
  const subs = remapSubstitutions(
    readSetting(db, 'phase_exercise_substitutions'),
    idMap,
    keep
  );
  if (subs !== null) writeSetting(db, 'phase_exercise_substitutions', subs);

  // 4. Drop the now-redundant rows and demote survivors to pure catalog entries.
  for (const ex of exercises) {
    if (!keep.has(ex.id)) {
      db.runSync('DELETE FROM exercises WHERE id = ?', [ex.id]);
    }
  }
  db.runSync('UPDATE exercises SET workout_id = NULL, order_index = 0', []);

  return {
    exercisesBefore,
    exercisesAfter: keep.size,
    slotsCreated,
    setLogsRepointed,
    groupsMerged,
  };
}
