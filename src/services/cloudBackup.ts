import { getDb, getSetting, setSetting } from '../db/database';
import {
  gcsDownloadObject,
  gcsUploadObject,
  parseServiceAccountKey,
  ServiceAccountKey,
} from './gcs';
import { GCS_BUCKET, GCS_SERVICE_ACCOUNT_JSON } from '../config/env';

/**
 * Full-database JSON backup to a GCS bucket. Uploaded after every finished
 * workout (with offline retry) and restorable on demand.
 *
 * Config lives in the settings table (entered in the app), so no credentials
 * are ever committed to the repo.
 */

const GCS_BUCKET_KEY = 'gcs_bucket';
const GCS_SA_JSON_KEY = 'gcs_service_account_json';
const LAST_BACKUP_AT_KEY = 'cloud_last_backup_at';
const BACKUP_PENDING_KEY = 'cloud_backup_pending';

const LATEST_OBJECT = 'backups/latest.json';
const HISTORY_PREFIX = 'backups/history/';

/** Tables included in a backup, in an order that satisfies FK dependencies on restore. */
const BACKUP_TABLES = [
  'phases',
  'workouts',
  'exercises',
  // The per-workout exercise slots. Omitting this loses the entire link between
  // a workout and its exercises: restoring without it leaves every day empty.
  'workout_exercises',
  'workout_sessions',
  'set_logs',
  'settings',
  'body_weight_log',
  'nutrition_log',
  'nutrition_meals',
  'programs',
  'program_days',
] as const;

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  schemaUserVersion: number;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface CloudSyncStatus {
  configured: boolean;
  /** Where the effective credentials come from. */
  source: 'in-app' | 'built-in' | null;
  bucket: string | null;
  lastBackupAt: string | null;
  pending: boolean;
}

/** Build-time config from `.env`, when present. In-app settings take precedence. */
function getBakedInConfig(): { bucket: string; saJson: string } | null {
  const bucket = GCS_BUCKET.replace(/^gs:\/\//, '');
  if (!bucket || !GCS_SERVICE_ACCOUNT_JSON) return null;
  return { bucket, saJson: GCS_SERVICE_ACCOUNT_JSON };
}

export function getCloudSyncStatus(): CloudSyncStatus {
  const bucket = getSetting(GCS_BUCKET_KEY);
  const sa = getSetting(GCS_SA_JSON_KEY);
  const baked = getBakedInConfig();
  const source = !!bucket && !!sa ? 'in-app' : baked ? 'built-in' : null;
  return {
    configured: source !== null,
    source,
    bucket: source === 'in-app' ? bucket : baked?.bucket ?? null,
    lastBackupAt: getSetting(LAST_BACKUP_AT_KEY) || null,
    pending: getSetting(BACKUP_PENDING_KEY) === '1',
  };
}

/** The service account key currently in effect (in-app override, else baked-in). */
export function getEffectiveServiceAccountJson(): string | null {
  return getSetting(GCS_SA_JSON_KEY) || getBakedInConfig()?.saJson || null;
}

/** Validates and persists the bucket + service account key. Throws with a readable message. */
export function saveCloudSyncConfig(bucket: string, serviceAccountJson: string): void {
  const trimmedBucket = bucket.trim().replace(/^gs:\/\//, '').replace(/\/+$/, '');
  if (!trimmedBucket) throw new Error('Enter the bucket name.');
  parseServiceAccountKey(serviceAccountJson); // throws if malformed
  setSetting(GCS_BUCKET_KEY, trimmedBucket);
  setSetting(GCS_SA_JSON_KEY, serviceAccountJson.trim());
}

export function clearCloudSyncConfig(): void {
  setSetting(GCS_BUCKET_KEY, '');
  setSetting(GCS_SA_JSON_KEY, '');
  setSetting(BACKUP_PENDING_KEY, '');
}

function getConfigOrNull(): { bucket: string; key: ServiceAccountKey } | null {
  const bucket = getSetting(GCS_BUCKET_KEY);
  const saJson = getSetting(GCS_SA_JSON_KEY);
  if (bucket && saJson) {
    try {
      return { bucket, key: parseServiceAccountKey(saJson) };
    } catch {
      // Fall through to the baked-in config below rather than failing outright.
    }
  }
  const baked = getBakedInConfig();
  if (baked) {
    try {
      return { bucket: baked.bucket, key: parseServiceAccountKey(baked.saJson) };
    } catch {
      return null;
    }
  }
  return null;
}

/** Device-local settings that must never leave the device (credentials, sync bookkeeping). */
const EXPORT_EXCLUDED_SETTINGS = new Set<string>([
  GCS_BUCKET_KEY,
  GCS_SA_JSON_KEY,
  LAST_BACKUP_AT_KEY,
  BACKUP_PENDING_KEY,
]);

export function exportAllData(): BackupPayload {
  const db = getDb();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of BACKUP_TABLES) {
    tables[table] = db.getAllSync<Record<string, unknown>>(`SELECT * FROM ${table}`);
  }
  tables['settings'] = (tables['settings'] ?? []).filter(
    (row) => !EXPORT_EXCLUDED_SETTINGS.has(String(row['key']))
  );
  const verRow = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    schemaUserVersion: verRow?.user_version ?? 0,
    tables,
  };
}

/**
 * Replace all local data with the backup payload. Rows are inserted using only
 * the columns that exist in both the payload and the current schema, so
 * backups from slightly older app versions still restore.
 */
export function importAllData(payload: BackupPayload): void {
  if (!payload || payload.version !== 1 || !payload.tables) {
    throw new Error('Backup file has an unexpected format.');
  }
  const db = getDb();

  // Keep this device's cloud config through the restore (the backup may predate it).
  const keepSettings: Record<string, string | null> = {
    [GCS_BUCKET_KEY]: getSetting(GCS_BUCKET_KEY),
    [GCS_SA_JSON_KEY]: getSetting(GCS_SA_JSON_KEY),
    [LAST_BACKUP_AT_KEY]: getSetting(LAST_BACKUP_AT_KEY),
  };

  db.execSync('PRAGMA foreign_keys = OFF');
  try {
    db.execSync('BEGIN');
    try {
      for (const table of [...BACKUP_TABLES].reverse()) {
        db.runSync(`DELETE FROM ${table}`);
      }
      for (const table of BACKUP_TABLES) {
        const rows = payload.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const schemaCols = new Set(
          db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name)
        );
        for (const row of rows) {
          const cols = Object.keys(row).filter((c) => schemaCols.has(c));
          if (cols.length === 0) continue;
          const placeholders = cols.map(() => '?').join(', ');
          db.runSync(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
            cols.map((c) => row[c] as any)
          );
        }
      }
      db.execSync('COMMIT');
    } catch (e) {
      db.execSync('ROLLBACK');
      throw e;
    }
  } finally {
    db.execSync('PRAGMA foreign_keys = ON');
  }

  for (const [key, value] of Object.entries(keepSettings)) {
    if (value !== null) setSetting(key, value);
  }
}

/** Upload the current database to the bucket. Throws on failure. */
export async function backupToCloud(): Promise<void> {
  const config = getConfigOrNull();
  if (!config) throw new Error('Cloud sync is not configured.');

  const payload = exportAllData();
  const content = JSON.stringify(payload);
  const stamp = payload.exportedAt.replace(/[:.]/g, '-');

  await gcsUploadObject(config.key, config.bucket, LATEST_OBJECT, content);
  await gcsUploadObject(config.key, config.bucket, `${HISTORY_PREFIX}${stamp}.json`, content);

  setSetting(LAST_BACKUP_AT_KEY, payload.exportedAt);
  setSetting(BACKUP_PENDING_KEY, '');
}

/**
 * Fire-and-forget backup used after finishing a workout. Failures (offline,
 * misconfig) mark the backup pending so it retries on the next app start or
 * finished workout.
 */
export function backupToCloudSilently(): void {
  const config = getConfigOrNull();
  if (!config) return;
  backupToCloud().catch((e) => {
    console.warn('Cloud backup failed, will retry later:', e);
    try {
      setSetting(BACKUP_PENDING_KEY, '1');
    } catch {
      /* ignore */
    }
  });
}

/** Retry a previously failed automatic backup, if any. */
export function retryPendingBackup(): void {
  if (getSetting(BACKUP_PENDING_KEY) !== '1') return;
  backupToCloudSilently();
}

export interface CloudBackupInfo {
  exportedAt: string;
  sessionCount: number;
  setCount: number;
}

/** Fetch metadata about the latest backup in the bucket (null if none exists). */
export async function fetchLatestBackupInfo(): Promise<CloudBackupInfo | null> {
  const payload = await downloadLatestBackup();
  if (!payload) return null;
  return {
    exportedAt: payload.exportedAt,
    sessionCount: payload.tables['workout_sessions']?.length ?? 0,
    setCount: payload.tables['set_logs']?.length ?? 0,
  };
}

async function downloadLatestBackup(): Promise<BackupPayload | null> {
  const config = getConfigOrNull();
  if (!config) throw new Error('Cloud sync is not configured.');
  const content = await gcsDownloadObject(config.key, config.bucket, LATEST_OBJECT);
  if (content === null) return null;
  let payload: BackupPayload;
  try {
    payload = JSON.parse(content) as BackupPayload;
  } catch {
    throw new Error('The backup in the bucket is not valid JSON.');
  }
  return payload;
}

/**
 * Pull the latest backup from the bucket and replace all local data with it.
 * Returns info about what was restored. Caller must reload app state after.
 */
export async function restoreFromCloud(): Promise<CloudBackupInfo> {
  const payload = await downloadLatestBackup();
  if (!payload) throw new Error('No backup found in the bucket yet.');
  importAllData(payload);
  return {
    exportedAt: payload.exportedAt,
    sessionCount: payload.tables['workout_sessions']?.length ?? 0,
    setCount: payload.tables['set_logs']?.length ?? 0,
  };
}
