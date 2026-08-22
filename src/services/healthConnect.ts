import { Platform } from 'react-native';
import {
  getSetting,
  setSetting,
  getBodyWeightForDate,
  getAllBodyWeights,
  upsertBodyWeightForDate,
  upsertNutritionDay,
  replaceNutritionMealsForDate,
  getNutritionDayCount,
  getLatestNutritionDate,
} from '../db/database';
import { toLocalDateYmd, isValidYmd } from '../utils/dateLocal';

/**
 * Body weight sync with Android Health Connect.
 *
 * Health Connect is the bridge to Cronometer: Cronometer imports Weight from
 * Health Connect and exports Nutrition to it, so writing weight here is what
 * gets it into Cronometer's calorie tracking. There is no usable Cronometer
 * API — this is the supported path.
 *
 * Android only. Every entry point no-ops on other platforms rather than
 * throwing, so callers don't need to branch.
 */

const ENABLED_KEY = 'health_connect_enabled';
const LAST_SYNC_AT_KEY = 'health_connect_last_sync_at';

/**
 * Prefix for the clientRecordId of every weight record we write.
 *
 * Two jobs: Health Connect upserts on clientRecordId, so re-logging a date
 * replaces our record instead of duplicating it (matching body_weight_log's
 * one-row-per-date key); and on read it identifies our own writes so we don't
 * re-import them and create a sync loop.
 */
const WEIGHT_CLIENT_ID_PREFIX = 'highwater-bw-';

/** Must match `expo.android.package` in app.json — used to skip our own records on read. */
const ANDROID_PACKAGE = 'com.ppl.tracker';

/** How far back a manual sync looks when pulling records from Health Connect. */
const DEFAULT_PULL_DAYS = 365;

/** First backfill reach when history access is granted. */
const HISTORY_PULL_DAYS = 1095;

export type SdkAvailability =
  | 'available'
  | 'update-required'
  | 'unavailable'
  | 'unsupported-platform';

export interface HealthConnectStatus {
  /** User has connected the integration in settings. */
  enabled: boolean;
  lastSyncAt: string | null;
}

export interface WeightPermissions {
  read: boolean;
  write: boolean;
}

export interface HealthPermissions extends WeightPermissions {
  /** Nutrition read — the calorie/macro data Cronometer exports. */
  nutrition: boolean;
  /**
   * Access to records older than 30 days.
   *
   * NOT TRUSTWORTHY as a denial. react-native-health-connect requests this
   * permission correctly but its reverse mapping never re-emits it, so a
   * granted history permission still reads as false here. Treat true as "known
   * granted" and false as "unknown" — never as a reason to narrow a read.
   */
  history: boolean;
}

export interface SyncResult {
  /** Records written to Health Connect. */
  pushed: number;
  /** Days imported from Health Connect into body_weight_log. */
  pulled: number;
  /** Records seen but skipped because a local entry already exists for that day. */
  skippedExisting: number;
  /** Days of nutrition imported from Health Connect. */
  nutritionDays: number;
  /** Individual meal records stored for timing analysis. */
  nutritionMeals: number;
}

export function isHealthConnectSupported(): boolean {
  return Platform.OS === 'android';
}

/**
 * The library is Android-only and touches native modules at import time, so it
 * is required lazily behind a platform check rather than imported at the top.
 */
function getLib(): typeof import('react-native-health-connect') | null {
  if (!isHealthConnectSupported()) return null;
  return require('react-native-health-connect');
}

export function getHealthConnectStatus(): HealthConnectStatus {
  return {
    enabled: getSetting(ENABLED_KEY) === '1',
    lastSyncAt: getSetting(LAST_SYNC_AT_KEY),
  };
}

export async function getSdkAvailability(): Promise<SdkAvailability> {
  const lib = getLib();
  if (!lib) return 'unsupported-platform';
  const status = await lib.getSdkStatus();
  if (status === lib.SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
  if (status === lib.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
    return 'update-required';
  }
  return 'unavailable';
}

const HEALTH_PERMISSIONS = [
  { accessType: 'read', recordType: 'Weight' },
  { accessType: 'write', recordType: 'Weight' },
  { accessType: 'read', recordType: 'Nutrition' },
  // Lifts the 30-day read window so trends can reach back past a month.
  { accessType: 'read', recordType: 'ReadHealthDataHistory' },
] as const;

function toHealthPermissions(
  granted: { accessType: string; recordType: string }[]
): HealthPermissions {
  const has = (recordType: string, accessType: string) =>
    granted.some((p) => p.recordType === recordType && p.accessType === accessType);
  return {
    read: has('Weight', 'read'),
    write: has('Weight', 'write'),
    nutrition: has('Nutrition', 'read'),
    history: has('ReadHealthDataHistory', 'read'),
  };
}

export async function getHealthPermissions(): Promise<HealthPermissions> {
  const lib = getLib();
  if (!lib) return { read: false, write: false, nutrition: false, history: false };
  await lib.initialize();
  return toHealthPermissions(await lib.getGrantedPermissions());
}

/**
 * Reads always ask for the full range.
 *
 * Clamping to 30 days when `history` looks ungranted would throw away data we
 * may well be entitled to, because that flag can't be read back reliably (see
 * HealthPermissions.history). Health Connect simply returns less when it is not
 * allowed, so over-asking is safe and self-correcting.
 */
export function readableDays(_permissions: HealthPermissions, requested: number): number {
  return requested;
}

/**
 * Prompt for Weight read/write access and remember the connection. Returns what
 * was actually granted — the user can approve one direction and not the other.
 */
export async function connectHealthConnect(): Promise<HealthPermissions> {
  const lib = getLib();
  if (!lib) throw new Error('Health Connect is only available on Android.');

  const availability = await getSdkAvailability();
  if (availability === 'update-required') {
    throw new Error('Health Connect needs to be updated on this device before it can be used.');
  }
  if (availability !== 'available') {
    throw new Error('Health Connect is not available on this device.');
  }

  await lib.initialize();
  const granted = toHealthPermissions(
    await lib.requestPermission([...HEALTH_PERMISSIONS] as any)
  );
  if (granted.read || granted.write || granted.nutrition) setSetting(ENABLED_KEY, '1');
  return granted;
}

/**
 * Re-prompt for any permission not yet granted. Health Connect shows only the
 * outstanding ones, so this doubles as "grant nutrition/history later".
 */
export async function requestMissingPermissions(): Promise<HealthPermissions> {
  const lib = getLib();
  if (!lib) throw new Error('Health Connect is only available on Android.');
  await lib.initialize();
  await lib.requestPermission([...HEALTH_PERMISSIONS] as any);
  return getHealthPermissions();
}

/**
 * Stop syncing. Deliberately does not call revokeAllPermissions: Health Connect
 * only applies a revoke after the app process restarts, so the grant would
 * appear to linger. Tracking the off state here is immediate and honest; the
 * user can revoke for real in the Health Connect app.
 */
export function disconnectHealthConnect(): void {
  setSetting(ENABLED_KEY, '');
}

export function openHealthConnectSettings(): void {
  getLib()?.openHealthConnectSettings();
}

/** Noon local, so a date never lands on the neighbouring day in another timezone. */
function ymdToInstant(dateYmd: string): Date {
  const [y, m, d] = dateYmd.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function weightRecordFor(dateYmd: string, weightLbs: number) {
  return {
    recordType: 'Weight' as const,
    time: ymdToInstant(dateYmd).toISOString(),
    weight: { value: weightLbs, unit: 'pounds' as const },
    metadata: {
      clientRecordId: `${WEIGHT_CLIENT_ID_PREFIX}${dateYmd}`,
      // Bumped on every write so Health Connect accepts the newer value for a
      // date the user has corrected.
      clientRecordVersion: Date.now(),
    },
  };
}

/**
 * Write one day's body weight to Health Connect. Safe to call for a date that
 * was already synced — the clientRecordId makes it an update.
 */
export async function pushBodyWeight(dateYmd: string, weightLbs: number): Promise<void> {
  const lib = getLib();
  if (!lib || !getHealthConnectStatus().enabled) return;
  await lib.initialize();
  await lib.insertRecords([weightRecordFor(dateYmd, weightLbs)]);
}

/**
 * Fire-and-forget push for the body-weight logging flow. Sync problems must
 * never surface as a failure to save a weight the user just typed.
 */
export function pushBodyWeightSilently(dateYmd: string, weightLbs: number): void {
  if (!getHealthConnectStatus().enabled) return;
  pushBodyWeight(dateYmd, weightLbs).catch(() => {
    /* best effort — a manual sync will backfill it */
  });
}

/** Send every locally logged body weight to Health Connect (first-connect backfill). */
export async function pushAllBodyWeights(): Promise<number> {
  const lib = getLib();
  if (!lib || !getHealthConnectStatus().enabled) return 0;

  const entries = getAllBodyWeights().filter(
    (e) => isValidYmd(e.logged_date) && Number.isFinite(e.weight_lbs) && e.weight_lbs > 0
  );
  if (entries.length === 0) return 0;

  await lib.initialize();
  // Chunked: Health Connect rejects oversized batches, and a partial failure
  // shouldn't lose the whole backfill.
  const CHUNK = 100;
  let pushed = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = entries
      .slice(i, i + CHUNK)
      .map((e) => weightRecordFor(e.logged_date, e.weight_lbs));
    await lib.insertRecords(batch);
    pushed += batch.length;
  }
  return pushed;
}

/**
 * Import weights recorded by other apps (a smart scale, Cronometer itself).
 *
 * Only fills days with no local entry — a value typed into this app is never
 * overwritten by an external one. Our own records are skipped so a write can't
 * come back as an import.
 */
export async function pullBodyWeights(
  days = DEFAULT_PULL_DAYS
): Promise<{ pulled: number; skippedExisting: number }> {
  const lib = getLib();
  if (!lib || !getHealthConnectStatus().enabled) return { pulled: 0, skippedExisting: 0 };

  await lib.initialize();
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const { records } = await lib.readRecords('Weight', {
    timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
    ascendingOrder: true,
  });

  // Later records win within a day, so the most recent reading for a date is
  // the one that lands.
  const byDate = new Map<string, number>();
  for (const record of records) {
    const origin = record.metadata?.dataOrigin;
    const clientId = record.metadata?.clientRecordId;
    const isOurs =
      origin === ANDROID_PACKAGE || (clientId?.startsWith(WEIGHT_CLIENT_ID_PREFIX) ?? false);
    if (isOurs) continue;

    const lbs = record.weight?.inPounds;
    if (!Number.isFinite(lbs) || lbs <= 0) continue;
    byDate.set(toLocalDateYmd(new Date(record.time)), Math.round(lbs * 10) / 10);
  }

  let pulled = 0;
  let skippedExisting = 0;
  for (const [dateYmd, lbs] of byDate) {
    if (getBodyWeightForDate(dateYmd) != null) {
      skippedExisting++;
      continue;
    }
    upsertBodyWeightForDate(dateYmd, lbs);
    pulled++;
  }
  return { pulled, skippedExisting };
}

function gramsOf(mass: { inGrams: number } | undefined): number | null {
  const v = mass?.inGrams;
  return Number.isFinite(v) ? (v as number) : null;
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a + b;
}

/**
 * Import nutrition written to Health Connect by Cronometer.
 *
 * Records arrive per meal, so they are summed into daily totals for trend work
 * and also stored individually — their timestamps are what let intake be
 * related to session times.
 *
 * Days are always replaced wholesale rather than merged: a day being re-imported
 * may have had entries edited or deleted in Cronometer since last time.
 */
export async function pullNutrition(days: number): Promise<{ daysImported: number; meals: number }> {
  const lib = getLib();
  if (!lib || !getHealthConnectStatus().enabled) return { daysImported: 0, meals: 0 };

  await lib.initialize();
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const { records } = await lib.readRecords('Nutrition', {
    timeRangeFilter: {
      operator: 'between',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
    ascendingOrder: true,
  });

  interface DayAccumulator {
    energy: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fiber: number | null;
    sodium: number | null;
    count: number;
    meals: {
      hc_record_id: string;
      start_time: string;
      meal_type: number | null;
      name: string | null;
      energy_kcal: number | null;
      protein_g: number | null;
      carbs_g: number | null;
    }[];
  }

  const byDate = new Map<string, DayAccumulator>();

  for (const record of records) {
    const startTime = record.startTime;
    if (!startTime) continue;
    const dateYmd = toLocalDateYmd(new Date(startTime));

    let day = byDate.get(dateYmd);
    if (!day) {
      day = {
        energy: null, protein: null, carbs: null, fat: null,
        fiber: null, sodium: null, count: 0, meals: [],
      };
      byDate.set(dateYmd, day);
    }

    const kcal = Number.isFinite(record.energy?.inKilocalories)
      ? (record.energy!.inKilocalories as number)
      : null;
    const protein = gramsOf(record.protein);
    const carbs = gramsOf(record.totalCarbohydrate);

    day.energy = addNullable(day.energy, kcal);
    day.protein = addNullable(day.protein, protein);
    day.carbs = addNullable(day.carbs, carbs);
    day.fat = addNullable(day.fat, gramsOf(record.totalFat));
    day.fiber = addNullable(day.fiber, gramsOf(record.dietaryFiber));
    // Sodium is reported as a mass; the column stores milligrams.
    const sodiumG = gramsOf(record.sodium);
    day.sodium = addNullable(day.sodium, sodiumG == null ? null : sodiumG * 1000);
    day.count += 1;

    const id = record.metadata?.id;
    if (id) {
      day.meals.push({
        hc_record_id: id,
        start_time: startTime,
        meal_type: record.mealType ?? null,
        name: record.name ?? null,
        energy_kcal: kcal,
        protein_g: protein,
        carbs_g: carbs,
      });
    }
  }

  let meals = 0;
  for (const [dateYmd, day] of byDate) {
    upsertNutritionDay({
      logged_date: dateYmd,
      energy_kcal: day.energy,
      protein_g: day.protein,
      carbs_g: day.carbs,
      fat_g: day.fat,
      fiber_g: day.fiber,
      sodium_mg: day.sodium,
      entry_count: day.count,
    });
    replaceNutritionMealsForDate(dateYmd, day.meals);
    meals += day.meals.length;
  }

  return { daysImported: byDate.size, meals };
}

/** Manual sync: push weights, then import weights and nutrition. */
export async function syncBodyWeightNow(days = DEFAULT_PULL_DAYS): Promise<SyncResult> {
  if (!isHealthConnectSupported()) {
    throw new Error('Health Connect is only available on Android.');
  }
  if (!getHealthConnectStatus().enabled) {
    throw new Error('Connect Health Connect first.');
  }

  const permissions = await getHealthPermissions();
  if (!permissions.read && !permissions.write && !permissions.nutrition) {
    throw new Error(
      'Health Connect has no permissions for this app. Grant them in Health Connect and try again.'
    );
  }

  const pushed = permissions.write ? await pushAllBodyWeights() : 0;
  const { pulled, skippedExisting } = permissions.read
    ? await pullBodyWeights(readableDays(permissions, days))
    : { pulled: 0, skippedExisting: 0 };

  // First nutrition import reaches as far back as allowed; later ones only need
  // to cover the gap since the newest cached day (plus slack for edits).
  let nutritionDays = 0;
  let nutritionMeals = 0;
  if (permissions.nutrition) {
    const haveHistory = getNutritionDayCount() > 0;
    const latest = getLatestNutritionDate();
    let reach = HISTORY_PULL_DAYS;
    if (haveHistory && latest) {
      const sinceLatest = Math.ceil(
        (Date.now() - new Date(`${latest}T12:00:00`).getTime()) / 86400000
      );
      reach = Math.min(reach, Math.max(7, sinceLatest + 3));
    }
    const result = await pullNutrition(reach);
    nutritionDays = result.daysImported;
    nutritionMeals = result.meals;
  }

  setSetting(LAST_SYNC_AT_KEY, new Date().toISOString());
  return { pushed, pulled, skippedExisting, nutritionDays, nutritionMeals };
}
