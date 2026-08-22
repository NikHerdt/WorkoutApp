import {
  NutritionDay,
  getNutritionDays,
  getNutritionMeals,
  getSessionTrainingSummaries,
  getDatedRestSetRows,
  getBodyWeightEntries,
} from '../db/database';
import { buildRestPairs } from './restAnalysis';

/**
 * Analyses that combine nutrition (imported from Cronometer via Health Connect)
 * with the training and body-weight data this app already holds.
 *
 * The unifying idea: Cronometer knows what you ate but nothing about what you
 * lifted, and this app knows the reverse. Everything worth computing lives in
 * the overlap.
 */

/** Energy per pound of body mass — the standard approximation for tissue change. */
const KCAL_PER_LB = 3500;

/** Weight moves on water and glycogen day to day; smooth before trusting it. */
const TREND_HALF_LIFE_DAYS = 7;

/** A day counts toward intake analysis only if it looks actually logged. */
const MIN_KCAL_FOR_LOGGED_DAY = 400;

/** TDEE needs a window long enough for the trend to outrun the noise. */
const MIN_TDEE_WINDOW_DAYS = 14;
/** …and enough of that window actually logged. */
const MIN_TDEE_COVERAGE = 0.6;

export interface DatedValue {
  date: string;
  value: number;
}

function ymdToTime(dateYmd: string): number {
  return new Date(`${dateYmd}T12:00:00`).getTime();
}

function daysBetween(aYmd: string, bYmd: string): number {
  return Math.round((ymdToTime(bYmd) - ymdToTime(aYmd)) / 86400000);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Least-squares slope of weight against time, in lbs per day.
 *
 * Deliberately not measured from the ends of the smoothed trend: an EMA lags a
 * real linear change by roughly its half-life, so endpoint differences
 * understate the true rate and bias TDEE toward whatever was eaten. Regression
 * over the raw points is unbiased and already handles the day-to-day noise the
 * smoothing was there for.
 */
export function weightSlopeLbsPerDay(
  entries: { date: string; lbs: number }[]
): { slope: number; interceptAtLast: number } | null {
  if (entries.length < 3) return null;
  const t0 = ymdToTime(entries[0].date);
  const xs = entries.map((e) => (ymdToTime(e.date) - t0) / 86400000);
  const ys = entries.map((e) => e.lbs);

  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;

  const slope = num / den;
  const intercept = my - slope * mx;
  return { slope, interceptAtLast: intercept + slope * xs[xs.length - 1] };
}

/** Days where energy was actually logged, not a blank or near-blank day. */
export function loggedDays(days: NutritionDay[]): NutritionDay[] {
  return days.filter((d) => (d.energy_kcal ?? 0) >= MIN_KCAL_FOR_LOGGED_DAY);
}

// ─── Weight trend ─────────────────────────────────────────────────────────────

/**
 * Exponentially weighted trend over daily weights.
 *
 * Gaps are handled by decaying on elapsed days rather than on samples, so a
 * week without weigh-ins doesn't let one reading snap the trend to itself.
 */
export function computeWeightTrend(
  entries: { date: string; lbs: number }[],
  halfLifeDays = TREND_HALF_LIFE_DAYS
): DatedValue[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => ymdToTime(a.date) - ymdToTime(b.date));

  const out: DatedValue[] = [];
  let trend = sorted[0].lbs;
  let prevDate = sorted[0].date;
  out.push({ date: sorted[0].date, value: trend });

  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.max(1, daysBetween(prevDate, sorted[i].date));
    // Weight of the new sample grows with the gap: 1 - 0.5^(gap / halfLife).
    const alpha = 1 - Math.pow(0.5, gap / halfLifeDays);
    trend = trend + alpha * (sorted[i].lbs - trend);
    out.push({ date: sorted[i].date, value: trend });
    prevDate = sorted[i].date;
  }
  return out;
}

export interface TdeeResult {
  /** Estimated maintenance calories per day. Null when the data can't support it. */
  tdee: number | null;
  /** Mean logged intake across the window. */
  meanIntake: number;
  /** Trend-weight change per week, lbs. Negative = losing. */
  weeklyRateLbs: number;
  /** Same rate as a percent of current body weight — the number to program by. */
  weeklyRatePct: number;
  /** Trend weight at the end of the window. */
  currentTrendLbs: number | null;
  /** Days in the window with intake logged. */
  daysLogged: number;
  /** Days spanned by the window. */
  windowDays: number;
  /** daysLogged / windowDays. */
  coverage: number;
  confidence: 'none' | 'low' | 'moderate' | 'good';
  /** Present when tdee is null: what is missing. */
  blockedReason: string | null;
}

/**
 * Solve for maintenance calories from observed intake and trend-weight change.
 *
 * TDEE = mean intake − (energy banked as tissue) / days. It needs no formula,
 * no activity multiplier and no guess about metabolism — but it does need
 * consistent logging, which is why coverage gates the result.
 */
export function computeAdaptiveTdee(
  nutrition: NutritionDay[],
  weights: { date: string; lbs: number }[],
  windowDays = 28
): TdeeResult {
  const cutoff = Date.now() - windowDays * 86400000;
  const inWindow = <T extends { date?: string; logged_date?: string }>(row: T) => {
    const d = (row as any).date ?? (row as any).logged_date;
    return ymdToTime(d) >= cutoff;
  };

  const windowNutrition = loggedDays(nutrition).filter(inWindow);
  const trend = computeWeightTrend(weights);
  const windowTrend = trend.filter((t) => ymdToTime(t.date) >= cutoff);

  const meanIntake = mean(windowNutrition.map((d) => d.energy_kcal as number));
  const currentTrendLbs = trend.length > 0 ? trend[trend.length - 1].value : null;

  const empty: TdeeResult = {
    tdee: null,
    meanIntake,
    weeklyRateLbs: 0,
    weeklyRatePct: 0,
    currentTrendLbs,
    daysLogged: windowNutrition.length,
    windowDays,
    coverage: 0,
    confidence: 'none',
    blockedReason: null,
  };

  if (windowTrend.length < 2) {
    return { ...empty, blockedReason: 'Needs body weight logged on at least two days in the window.' };
  }

  const windowWeights = weights.filter((w) => ymdToTime(w.date) >= cutoff);
  const first = windowTrend[0];
  const last = windowTrend[windowTrend.length - 1];
  const spanDays = daysBetween(first.date, last.date);

  if (spanDays < MIN_TDEE_WINDOW_DAYS) {
    return {
      ...empty,
      blockedReason: `Needs about ${MIN_TDEE_WINDOW_DAYS} days between your first and last weigh-in — currently ${spanDays}.`,
    };
  }

  const coverage = windowNutrition.length / spanDays;
  if (windowNutrition.length === 0) {
    return { ...empty, coverage: 0, blockedReason: 'No calories logged in this window yet.' };
  }
  if (coverage < MIN_TDEE_COVERAGE) {
    return {
      ...empty,
      coverage,
      blockedReason: `Only ${windowNutrition.length} of ${spanDays} days have calories logged. Consistent logging is what makes this number mean anything.`,
    };
  }

  const fit = weightSlopeLbsPerDay(windowWeights);
  if (!fit) {
    return { ...empty, coverage, blockedReason: 'Needs at least three weigh-ins in the window.' };
  }

  const weeklyRateLbs = fit.slope * 7;
  const trendNow = fit.interceptAtLast;
  const weeklyRatePct = trendNow > 0 ? (weeklyRateLbs / trendNow) * 100 : 0;

  // Energy banked as tissue (or drawn from it) per day, back in calories.
  const tdee = meanIntake - fit.slope * KCAL_PER_LB;

  const confidence: TdeeResult['confidence'] =
    spanDays >= 28 && coverage >= 0.85 ? 'good' : coverage >= 0.75 ? 'moderate' : 'low';

  return {
    tdee: Math.round(tdee),
    meanIntake: Math.round(meanIntake),
    weeklyRateLbs,
    weeklyRatePct,
    currentTrendLbs: trendNow,
    daysLogged: windowNutrition.length,
    windowDays: spanDays,
    coverage,
    confidence,
    blockedReason: null,
  };
}

/** Calorie change needed to hit a target weekly rate, given an estimated TDEE. */
export function calorieAdjustmentFor(
  tdee: TdeeResult,
  targetWeeklyRatePct: number
): { targetIntake: number; delta: number } | null {
  if (tdee.tdee == null || tdee.currentTrendLbs == null) return null;
  const targetLbsPerWeek = (targetWeeklyRatePct / 100) * tdee.currentTrendLbs;
  const targetIntake = Math.round(tdee.tdee + (targetLbsPerWeek * KCAL_PER_LB) / 7);
  return { targetIntake, delta: Math.round(targetIntake - tdee.meanIntake) };
}

// ─── Energy balance per day ───────────────────────────────────────────────────

/** Daily surplus/deficit against estimated maintenance. */
export function computeDailyBalance(
  nutrition: NutritionDay[],
  tdee: number
): Map<string, number> {
  const map = new Map<string, number>();
  for (const day of loggedDays(nutrition)) {
    map.set(day.logged_date, (day.energy_kcal as number) - tdee);
  }
  return map;
}

// ─── Training performance vs energy balance ───────────────────────────────────

export interface PerformanceVsBalance {
  /** Sessions bucketed by the energy balance of the surrounding days. */
  buckets: {
    label: string;
    /** Mean daily balance across the sessions in this bucket. */
    meanBalance: number;
    sessions: number;
    /** Mean best estimated 1RM. */
    meanE1rm: number;
    /** Mean session volume. */
    meanVolume: number;
    /** Percent change in e1RM versus the same exercise's earlier baseline. */
    meanE1rmDeltaPct: number;
  }[];
  /** Sessions with both training and intake data. */
  totalSessions: number;
  insufficientReason: string | null;
}

const BALANCE_BUCKETS = [
  { min: -Infinity, max: -400, label: 'Deficit >400' },
  { min: -400, max: -150, label: 'Deficit 150–400' },
  { min: -150, max: 150, label: 'Maintenance' },
  { min: 150, max: 400, label: 'Surplus 150–400' },
  { min: 400, max: Infinity, label: 'Surplus >400' },
];

/**
 * Relate how a session went to the energy balance around it.
 *
 * A session is scored against the trailing average balance (including the day
 * itself), because performance reflects the days of fuelling that preceded it,
 * not just that morning's breakfast.
 */
export function computePerformanceVsBalance(
  days = 180,
  trailingDays = 3
): PerformanceVsBalance {
  const nutrition = getNutritionDays(days);
  const weights = getBodyWeightEntries(days);
  const tdeeResult = computeAdaptiveTdee(nutrition, weights, days);
  const sessions = getSessionTrainingSummaries(days);

  const empty: PerformanceVsBalance = {
    buckets: [],
    totalSessions: 0,
    insufficientReason: null,
  };

  if (tdeeResult.tdee == null) {
    return { ...empty, insufficientReason: tdeeResult.blockedReason ?? 'Not enough data yet.' };
  }

  const byDate = new Map<string, number>();
  for (const d of loggedDays(nutrition)) byDate.set(d.logged_date, d.energy_kcal as number);

  // Baseline e1RM = mean of the earliest third of sessions, so later sessions
  // are compared against where the lifter started rather than against zero.
  const withData: { balance: number; e1rm: number; volume: number }[] = [];

  for (const session of sessions) {
    const intakes: number[] = [];
    for (let back = 0; back < trailingDays; back++) {
      const d = new Date(ymdToTime(session.date) - back * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
      const kcal = byDate.get(key);
      if (kcal != null) intakes.push(kcal);
    }
    // Require most of the trailing window, or the balance figure is guesswork.
    if (intakes.length < Math.ceil(trailingDays / 2)) continue;
    if (session.best_e1rm <= 0) continue;

    withData.push({
      balance: mean(intakes) - tdeeResult.tdee,
      e1rm: session.best_e1rm,
      volume: session.volume,
    });
  }

  if (withData.length < 6) {
    return {
      ...empty,
      totalSessions: withData.length,
      insufficientReason:
        'Needs more sessions with calories logged around them before the comparison means anything.',
    };
  }

  const baselineCount = Math.max(1, Math.floor(withData.length / 3));
  const baselineE1rm = mean(withData.slice(0, baselineCount).map((s) => s.e1rm));

  const buckets = BALANCE_BUCKETS.map((bucket) => {
    const inBucket = withData.filter((s) => s.balance >= bucket.min && s.balance < bucket.max);
    return {
      label: bucket.label,
      meanBalance: inBucket.length ? Math.round(mean(inBucket.map((s) => s.balance))) : 0,
      sessions: inBucket.length,
      meanE1rm: inBucket.length ? Math.round(mean(inBucket.map((s) => s.e1rm)) * 10) / 10 : 0,
      meanVolume: inBucket.length ? Math.round(mean(inBucket.map((s) => s.volume))) : 0,
      meanE1rmDeltaPct:
        inBucket.length && baselineE1rm > 0
          ? ((mean(inBucket.map((s) => s.e1rm)) - baselineE1rm) / baselineE1rm) * 100
          : 0,
    };
  }).filter((b) => b.sessions > 0);

  return { buckets, totalSessions: withData.length, insufficientReason: null };
}

// ─── Rest response vs energy balance ──────────────────────────────────────────

export interface RestVsBalance {
  /** Mean rest actually taken and how the next set went, split by energy state. */
  groups: {
    label: string;
    pairs: number;
    meanRestSeconds: number;
    meanDeltaPct: number;
  }[];
  insufficientReason: string | null;
  /** Set when both groups qualify: how much worse retention is in a deficit. */
  deficitPenaltyPct: number | null;
}

/**
 * Does inter-set recovery degrade when under-fuelled?
 *
 * Uses the same rest→next-set pairing as the rest analysis, but splits the
 * pairs by the energy balance of the day they were performed on. If retention
 * really is worse in a deficit, that argues for resting longer while cutting.
 */
export function computeRestVsBalance(days = 180): RestVsBalance {
  const nutrition = getNutritionDays(days);
  const weights = getBodyWeightEntries(days);
  const tdeeResult = computeAdaptiveTdee(nutrition, weights, days);

  if (tdeeResult.tdee == null) {
    return {
      groups: [],
      deficitPenaltyPct: null,
      insufficientReason: tdeeResult.blockedReason ?? 'Not enough data yet.',
    };
  }

  const balanceByDate = computeDailyBalance(nutrition, tdeeResult.tdee);
  const rows = getDatedRestSetRows(days);

  // Pair within a single exercise within a single session, as rest analysis does.
  const byExercise = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.session_id}:${row.exercise_id}`;
    if (!byExercise.has(key)) byExercise.set(key, []);
    byExercise.get(key)!.push(row);
  }

  const deficit: { restSeconds: number; deltaPct: number }[] = [];
  const surplus: { restSeconds: number; deltaPct: number }[] = [];

  for (const [, group] of byExercise) {
    const balance = balanceByDate.get(group[0].date);
    if (balance == null) continue;
    for (const pair of buildRestPairs(group.map((r) => ({ ...r, session_id: r.session_id })))) {
      (balance < 0 ? deficit : surplus).push(pair);
    }
  }

  const MIN_PAIRS = 8;
  const groups = [
    { label: 'In a deficit', data: deficit },
    { label: 'At or above maintenance', data: surplus },
  ]
    .filter((g) => g.data.length > 0)
    .map((g) => ({
      label: g.label,
      pairs: g.data.length,
      meanRestSeconds: Math.round(mean(g.data.map((p) => p.restSeconds))),
      meanDeltaPct: mean(g.data.map((p) => p.deltaPct)),
    }));

  const bothQualify = deficit.length >= MIN_PAIRS && surplus.length >= MIN_PAIRS;

  return {
    groups,
    deficitPenaltyPct: bothQualify
      ? mean(surplus.map((p) => p.deltaPct)) - mean(deficit.map((p) => p.deltaPct))
      : null,
    insufficientReason: bothQualify
      ? null
      : 'Needs more timed sets logged both in a deficit and at maintenance before the two can be compared.',
  };
}

// ─── Protein adequacy ─────────────────────────────────────────────────────────

export interface ProteinSummary {
  meanProteinG: number;
  /** Grams per pound of current trend body weight. */
  gramsPerLb: number;
  currentWeightLbs: number | null;
  /** Days meeting 0.7 g/lb, a common floor for lifters. */
  daysMeetingTarget: number;
  daysLogged: number;
  /** Per-day series for charting. */
  series: DatedValue[];
  insufficientReason: string | null;
}

const PROTEIN_TARGET_G_PER_LB = 0.7;

export function computeProteinSummary(days = 90): ProteinSummary {
  const nutrition = loggedDays(getNutritionDays(days)).filter((d) => d.protein_g != null);
  const trend = computeWeightTrend(getBodyWeightEntries(days));
  const currentWeightLbs = trend.length > 0 ? trend[trend.length - 1].value : null;

  if (nutrition.length === 0) {
    return {
      meanProteinG: 0,
      gramsPerLb: 0,
      currentWeightLbs,
      daysMeetingTarget: 0,
      daysLogged: 0,
      series: [],
      insufficientReason: 'No protein data imported yet.',
    };
  }

  const meanProteinG = mean(nutrition.map((d) => d.protein_g as number));
  const target = currentWeightLbs != null ? currentWeightLbs * PROTEIN_TARGET_G_PER_LB : null;

  return {
    meanProteinG: Math.round(meanProteinG),
    gramsPerLb: currentWeightLbs ? meanProteinG / currentWeightLbs : 0,
    currentWeightLbs,
    daysMeetingTarget:
      target == null ? 0 : nutrition.filter((d) => (d.protein_g as number) >= target).length,
    daysLogged: nutrition.length,
    series: nutrition.map((d) => ({ date: d.logged_date, value: d.protein_g as number })),
    insufficientReason: null,
  };
}

// ─── Training day vs rest day intake ──────────────────────────────────────────

export interface TrainingDayIntake {
  trainingDayKcal: number;
  restDayKcal: number;
  trainingDays: number;
  restDays: number;
  /** Positive when you eat more on days you train. */
  differenceKcal: number;
  insufficientReason: string | null;
}

export function computeTrainingDayIntake(days = 90): TrainingDayIntake {
  const nutrition = loggedDays(getNutritionDays(days));
  const sessionDates = new Set(getSessionTrainingSummaries(days).map((s) => s.date));

  const training = nutrition.filter((d) => sessionDates.has(d.logged_date));
  const rest = nutrition.filter((d) => !sessionDates.has(d.logged_date));

  const empty = {
    trainingDayKcal: 0,
    restDayKcal: 0,
    trainingDays: training.length,
    restDays: rest.length,
    differenceKcal: 0,
  };

  if (training.length < 3 || rest.length < 3) {
    return {
      ...empty,
      insufficientReason:
        'Needs at least three logged training days and three rest days to compare.',
    };
  }

  const trainingDayKcal = Math.round(mean(training.map((d) => d.energy_kcal as number)));
  const restDayKcal = Math.round(mean(rest.map((d) => d.energy_kcal as number)));

  return {
    trainingDayKcal,
    restDayKcal,
    trainingDays: training.length,
    restDays: rest.length,
    differenceKcal: trainingDayKcal - restDayKcal,
    insufficientReason: null,
  };
}

// ─── Pre-workout fuelling ─────────────────────────────────────────────────────

export interface FuellingAnalysis {
  /** Sessions split by whether anything was eaten in the hours before. */
  groups: {
    label: string;
    sessions: number;
    meanE1rm: number;
    meanVolume: number;
    /** Mean calories in the pre-workout window. */
    meanPreKcal: number;
  }[];
  /** Hours before a session counted as "pre-workout". */
  windowHours: number;
  insufficientReason: string | null;
}

/**
 * Did eating before training change how the session went?
 *
 * Only possible because meal records carry timestamps and sessions carry start
 * times — neither app can answer this alone.
 */
export function computeFuellingAnalysis(days = 180, windowHours = 4): FuellingAnalysis {
  const meals = getNutritionMeals(days);
  const sessions = getSessionTrainingSummaries(days);

  const empty: FuellingAnalysis = { groups: [], windowHours, insufficientReason: null };
  if (meals.length === 0) {
    return { ...empty, insufficientReason: 'No meal timing data imported yet.' };
  }

  const mealTimes = meals
    .map((m) => ({ t: new Date(m.start_time).getTime(), kcal: m.energy_kcal ?? 0 }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t);

  const scored: { preKcal: number; e1rm: number; volume: number }[] = [];
  const windowMs = windowHours * 3600000;

  for (const session of sessions) {
    const startedAt = new Date(session.started_at).getTime();
    if (!Number.isFinite(startedAt) || session.best_e1rm <= 0) continue;
    // Only score sessions on days we actually have meal data for, otherwise an
    // unlogged day looks identical to genuinely training fasted.
    const dayHasMeals = meals.some((m) => m.logged_date === session.date);
    if (!dayHasMeals) continue;

    const preKcal = mealTimes
      .filter((m) => m.t <= startedAt && m.t >= startedAt - windowMs)
      .reduce((sum, m) => sum + m.kcal, 0);

    scored.push({ preKcal, e1rm: session.best_e1rm, volume: session.volume });
  }

  if (scored.length < 6) {
    return {
      ...empty,
      insufficientReason:
        'Needs more sessions with meals logged on the same day before fuelling can be compared.',
    };
  }

  const definition = [
    { label: `Fasted (<50 kcal in ${windowHours}h before)`, test: (k: number) => k < 50 },
    { label: 'Light (50–300 kcal)', test: (k: number) => k >= 50 && k < 300 },
    { label: 'Fed (300+ kcal)', test: (k: number) => k >= 300 },
  ];

  const groups = definition
    .map((d) => {
      const inGroup = scored.filter((s) => d.test(s.preKcal));
      return {
        label: d.label,
        sessions: inGroup.length,
        meanE1rm: inGroup.length ? Math.round(mean(inGroup.map((s) => s.e1rm)) * 10) / 10 : 0,
        meanVolume: inGroup.length ? Math.round(mean(inGroup.map((s) => s.volume))) : 0,
        meanPreKcal: inGroup.length ? Math.round(mean(inGroup.map((s) => s.preKcal))) : 0,
      };
    })
    .filter((g) => g.sessions > 0);

  return { groups, windowHours, insufficientReason: null };
}

// ─── Screen-level rollup ──────────────────────────────────────────────────────

export interface NutritionOverview {
  hasNutritionData: boolean;
  daysStored: number;
  nutrition: NutritionDay[];
  tdee: TdeeResult;
  trend: DatedValue[];
}

export function getNutritionOverview(days: number): NutritionOverview {
  const nutrition = getNutritionDays(days);
  const weights = getBodyWeightEntries(days);
  return {
    hasNutritionData: loggedDays(nutrition).length > 0,
    daysStored: loggedDays(nutrition).length,
    nutrition,
    tdee: computeAdaptiveTdee(nutrition, weights, days),
    trend: computeWeightTrend(weights),
  };
}
