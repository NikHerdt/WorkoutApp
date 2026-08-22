import { getRestSetRowsForExercise } from '../db/database';

/**
 * How rest between sets relates to the set that follows it.
 *
 * The raw signal is `set_logs.rest_before_seconds`: the wall-clock gap between
 * two consecutive log taps on the same exercise. That interval covers the rest
 * *and* the set itself, so it runs a little long versus a stopwatch — but it is
 * measured the same way every time, which is what matters for comparing one
 * rest length against another.
 */

/** Gaps outside this range are interruptions (phone call, bathroom), not rest. */
const MIN_PLAUSIBLE_REST = 20;
const MAX_PLAUSIBLE_REST = 900;

/** A bucket needs this many observations before it can be compared or suggested. */
const MIN_PAIRS_PER_BUCKET = 4;
/** Total observations needed across all buckets before any suggestion is made. */
const MIN_TOTAL_PAIRS = 10;
/** At least this many buckets must qualify, so "best" is a comparison and not a default. */
const MIN_QUALIFYING_BUCKETS = 2;
/** Below this edge, one bucket isn't meaningfully better than another. */
const MEANINGFUL_EDGE_PCT = 1.5;

export interface RestBucket {
  /** Inclusive lower bound in seconds. */
  min: number;
  /** Exclusive upper bound in seconds; Infinity for the open-ended top bucket. */
  max: number;
  label: string;
}

export const REST_BUCKETS: RestBucket[] = [
  { min: 0, max: 60, label: 'under 1:00' },
  { min: 60, max: 90, label: '1:00–1:30' },
  { min: 90, max: 120, label: '1:30–2:00' },
  { min: 120, max: 180, label: '2:00–3:00' },
  { min: 180, max: 240, label: '3:00–4:00' },
  { min: 240, max: Infinity, label: '4:00+' },
];

/** One rest → next-set observation. */
export interface RestPair {
  restSeconds: number;
  /**
   * Performance change from the previous set to the next one, in percent.
   * Loaded sets compare estimated 1RM; bodyweight sets compare reps.
   */
  deltaPct: number;
  /** Reps gained or lost at the same weight, or null when the weight changed. */
  repDeltaAtSameWeight: number | null;
}

export interface RestBucketStats {
  label: string;
  min: number;
  max: number;
  /** Observations in this bucket. */
  n: number;
  /** Mean rest actually taken within the bucket, seconds. */
  meanRestSeconds: number;
  /** Mean performance change of the following set, percent. */
  meanDeltaPct: number;
  /** Mean rep change at unchanged weight, or null when no such observations. */
  meanRepDelta: number | null;
  /** Share of following sets that held or improved, 0–1. */
  holdRate: number;
  /** True when this bucket has enough data to be compared against the others. */
  qualifies: boolean;
}

export interface RestSuggestion {
  /** Recommended rest, seconds, rounded to a usable value. */
  seconds: number;
  /** The bucket the recommendation came from. */
  bucketLabel: string;
  /** Observations backing the winning bucket. */
  n: number;
  /** Percentage-point edge over the next-best qualifying bucket. */
  edgePct: number;
  confidence: 'low' | 'moderate' | 'good';
  /** One-line plain-English rationale. */
  reason: string;
}

export interface RestInsights {
  /** Total usable rest → next-set observations. */
  totalPairs: number;
  buckets: RestBucketStats[];
  /** Median rest actually taken, seconds; null when there is no data. */
  medianRestSeconds: number | null;
  /** Null when the data can't yet support a recommendation. */
  suggestion: RestSuggestion | null;
  /** Set when there is no suggestion, explaining what's missing. */
  insufficientReason: string | null;
}

/** Epley estimate; falls back to reps for bodyweight/unloaded work. */
function performanceScore(weight: number, reps: number): number | null {
  if (reps <= 0) return null;
  if (weight > 0) return weight * (1 + reps / 30);
  return reps;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Pair each working set with the one before it, keeping only pairs where the
 * gap was actually measured and looks like rest rather than an interruption.
 */
export function buildRestPairs(
  rows: {
    session_id: number;
    set_type: string;
    weight: number;
    reps: number;
    rest_before_seconds: number | null;
  }[]
): RestPair[] {
  const pairs: RestPair[] = [];

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const next = rows[i];

    // Adjacency only holds within one session, and only working sets carry a
    // comparable effort level.
    if (prev.session_id !== next.session_id) continue;
    if (prev.set_type !== 'working' || next.set_type !== 'working') continue;

    const rest = next.rest_before_seconds;
    if (rest == null || rest < MIN_PLAUSIBLE_REST || rest > MAX_PLAUSIBLE_REST) continue;

    const prevScore = performanceScore(Number(prev.weight) || 0, Number(prev.reps) || 0);
    const nextScore = performanceScore(Number(next.weight) || 0, Number(next.reps) || 0);
    if (prevScore == null || nextScore == null || prevScore <= 0) continue;

    const sameWeight = (Number(prev.weight) || 0) === (Number(next.weight) || 0);
    pairs.push({
      restSeconds: rest,
      deltaPct: ((nextScore - prevScore) / prevScore) * 100,
      repDeltaAtSameWeight: sameWeight
        ? (Number(next.reps) || 0) - (Number(prev.reps) || 0)
        : null,
    });
  }

  return pairs;
}

export function summarizeRestPairs(pairs: RestPair[]): RestBucketStats[] {
  return REST_BUCKETS.map((bucket) => {
    const inBucket = pairs.filter(
      (p) => p.restSeconds >= bucket.min && p.restSeconds < bucket.max
    );
    const repDeltas = inBucket
      .map((p) => p.repDeltaAtSameWeight)
      .filter((d): d is number => d != null);

    return {
      label: bucket.label,
      min: bucket.min,
      max: bucket.max,
      n: inBucket.length,
      meanRestSeconds: inBucket.length > 0 ? Math.round(mean(inBucket.map((p) => p.restSeconds))) : 0,
      meanDeltaPct: inBucket.length > 0 ? mean(inBucket.map((p) => p.deltaPct)) : 0,
      meanRepDelta: repDeltas.length > 0 ? mean(repDeltas) : null,
      holdRate:
        inBucket.length > 0
          ? inBucket.filter((p) => p.deltaPct >= 0).length / inBucket.length
          : 0,
      qualifies: inBucket.length >= MIN_PAIRS_PER_BUCKET,
    };
  });
}

function formatRest(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Round to the nearest 15s and keep it inside a rest range a person would actually use. */
function toUsableRest(seconds: number): number {
  return Math.min(300, Math.max(30, Math.round(seconds / 15) * 15));
}

export function suggestRest(
  buckets: RestBucketStats[],
  totalPairs: number
): { suggestion: RestSuggestion | null; insufficientReason: string | null } {
  const qualifying = buckets.filter((b) => b.qualifies);

  if (totalPairs < MIN_TOTAL_PAIRS) {
    return {
      suggestion: null,
      insufficientReason: `Needs ${MIN_TOTAL_PAIRS - totalPairs} more timed set${
        MIN_TOTAL_PAIRS - totalPairs === 1 ? '' : 's'
      } before a rest recommendation means anything.`,
    };
  }
  if (qualifying.length < MIN_QUALIFYING_BUCKETS) {
    return {
      suggestion: null,
      insufficientReason:
        'Your rest has been too consistent to compare — vary it across sessions and a recommendation will appear.',
    };
  }

  const ranked = [...qualifying].sort((a, b) => b.meanDeltaPct - a.meanDeltaPct);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const edgePct = best.meanDeltaPct - runnerUp.meanDeltaPct;

  if (edgePct < MEANINGFUL_EDGE_PCT) {
    return {
      suggestion: null,
      insufficientReason:
        'No rest length stands out yet — your next set performs about the same across the ranges you’ve tried.',
    };
  }

  const seconds = toUsableRest(best.meanRestSeconds);
  const confidence: RestSuggestion['confidence'] =
    best.n >= 12 ? 'good' : best.n >= 7 ? 'moderate' : 'low';

  const repPhrase =
    best.meanRepDelta != null
      ? ` At the same weight you get ${best.meanRepDelta >= 0 ? '+' : ''}${best.meanRepDelta.toFixed(
          1
        )} reps on the next set.`
      : '';

  return {
    suggestion: {
      seconds,
      bucketLabel: best.label,
      n: best.n,
      edgePct,
      confidence,
      reason:
        `Resting ${best.label} holds ${edgePct.toFixed(1)}% more of your previous set than ` +
        `${runnerUp.label} does, across ${best.n} sets.${repPhrase}`,
    },
    insufficientReason: null,
  };
}

/** Full rest picture for one exercise, optionally siloed to a single machine brand. */
export function getRestInsightsForExercise(
  exerciseId: number,
  brand?: string | null
): RestInsights {
  const pairs = buildRestPairs(getRestSetRowsForExercise(exerciseId, brand));
  const buckets = summarizeRestPairs(pairs);
  const { suggestion, insufficientReason } = suggestRest(buckets, pairs.length);

  return {
    totalPairs: pairs.length,
    buckets,
    medianRestSeconds: pairs.length > 0 ? Math.round(median(pairs.map((p) => p.restSeconds))) : null,
    suggestion,
    insufficientReason,
  };
}

export { formatRest };
