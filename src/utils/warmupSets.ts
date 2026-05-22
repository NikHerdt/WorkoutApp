import type { ActiveSet } from '../types';
import type { WarmupPreset } from '../db/database';

/**
 * Warm-up presets from working-set targets (percentages and rep pyramids).
 * 1 warmup: 60% weight, same reps as working.
 * 2 warmups: 50% / 70% weight; first same reps, second fewer reps.
 * 3 warmups: 45% / 65% / 85% weight; rep steps down each tier.
 */

function warmupWeightPercents(warmupCount: number): number[] {
  if (warmupCount === 1) return [0.6];
  if (warmupCount === 2) return [0.5, 0.7];
  if (warmupCount === 3) return [0.45, 0.65, 0.85];
  if (warmupCount > 3) {
    return Array.from({ length: warmupCount }, (_, i) =>
      0.45 + (0.85 - 0.45) * (i / Math.max(1, warmupCount - 1))
    );
  }
  return [];
}

function warmupRepAtIndex(index: number, warmupCount: number, workingReps: number): number {
  if (workingReps <= 0) return 0;
  if (warmupCount === 1) return workingReps;
  if (warmupCount === 2) {
    if (index === 0) return workingReps;
    return Math.max(1, workingReps - Math.ceil(workingReps / 3));
  }
  if (index === 0) return workingReps;
  if (index === 1) {
    return Math.max(1, workingReps - Math.ceil(0.3 * workingReps));
  }
  const secondTier = Math.max(1, workingReps - Math.ceil(0.3 * workingReps));
  return Math.max(1, Math.min(secondTier - 1, Math.floor(workingReps * 0.5)));
}

/** Parse a rep target string for pyramid math (upper end of ranges, max of listed numbers). */
export function parseWorkingRepsFromTarget(targetReps: string): number {
  const s = String(targetReps ?? '').trim();
  if (!s || /AMRAP/i.test(s)) return 0;
  if (/HOLD/i.test(s)) {
    const m = s.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }
  const rangeMatch = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    const b = parseInt(rangeMatch[2], 10);
    return Math.max(a, b);
  }
  const nums = s.match(/\d+/g)?.map((x) => parseInt(x, 10)) ?? [];
  if (!nums.length) return 0;
  return Math.max(...nums);
}

export function buildWarmupPresets(
  workingWeight: number,
  workingReps: number,
  warmupCount: number,
  isTimed: boolean
): WarmupPreset[] {
  if (warmupCount <= 0) return [];
  const pcts = warmupWeightPercents(warmupCount);
  const out: WarmupPreset[] = [];
  for (let i = 0; i < warmupCount; i++) {
    const w =
      workingWeight > 0 && pcts[i] != null ? String(Math.round(workingWeight * pcts[i])) : '';
    let r = '';
    if (isTimed) {
      r = workingReps > 0 ? String(workingReps) : '';
    } else {
      const n = warmupRepAtIndex(i, warmupCount, workingReps);
      r = n > 0 ? String(n) : '';
    }
    out.push({ weight: w, reps: r });
  }
  return out;
}

function presetsHaveWeight(presets: WarmupPreset[]): boolean {
  return presets.some((p) => String(p.weight ?? '').trim() !== '');
}

function warmupPresetsFromHistory(
  prevWarmup: { weight?: number; reps?: number }[],
  warmupCount: number
): WarmupPreset[] {
  return Array.from({ length: warmupCount }, (_, i) => {
    const h = prevWarmup[i] ?? prevWarmup[prevWarmup.length - 1];
    const wNum = Number(h?.weight) || 0;
    const rNum = Number(h?.reps) || 0;
    return {
      weight: wNum > 0 ? String(Math.round(wNum)) : '',
      reps: rNum > 0 ? String(rNum) : '',
    };
  });
}

/** Merge saved presets with calculated fallbacks when warmup count changes. */
function mergeSavedWithCalculated(
  saved: WarmupPreset[],
  calculated: WarmupPreset[],
  warmupCount: number
): WarmupPreset[] {
  return Array.from({ length: warmupCount }, (_, i) => {
    const s = saved[i];
    const c = calculated[i] ?? { weight: '', reps: '' };
    if (s && String(s.weight ?? '').trim() !== '') {
      return {
        weight: s.weight,
        reps: String(s.reps ?? '').trim() !== '' ? s.reps : c.reps,
      };
    }
    return c;
  });
}

/**
 * Presets for a new session: saved values first, then last session warmups, then % of working weight.
 */
export function resolveInitialWarmupPresets(
  saved: WarmupPreset[] | null,
  prevWarmupHistory: { weight?: number; reps?: number }[],
  workingWeight: number,
  workingReps: number,
  warmupCount: number,
  isTimed: boolean
): WarmupPreset[] {
  if (warmupCount <= 0) return [];

  const calculated = buildWarmupPresets(workingWeight, workingReps, warmupCount, isTimed);

  if (saved && presetsHaveWeight(saved)) {
    return mergeSavedWithCalculated(saved, calculated, warmupCount);
  }

  const histHasWeight = prevWarmupHistory.some((s) => Number(s.weight) > 0);
  if (histHasWeight) {
    const fromHist = warmupPresetsFromHistory(prevWarmupHistory, warmupCount);
    return mergeSavedWithCalculated(fromHist, calculated, warmupCount);
  }

  return calculated;
}

/** Fill only incomplete warmup sets that still have empty weight or reps. */
export function applyWarmupPresetsToIncompleteWarmups(
  sets: ActiveSet[],
  exerciseTargetReps: string,
  isTimed: boolean
): ActiveSet[] {
  const warmupCount = sets.filter((s) => s.setType === 'warmup').length;
  if (warmupCount === 0) return sets;

  const firstWorking = sets.find((s) => s.setType === 'working');
  const w = parseFloat(String(firstWorking?.weight ?? '')) || 0;
  let r = parseInt(String(firstWorking?.reps ?? ''), 10);
  if (!Number.isFinite(r) || r <= 0) {
    r = parseWorkingRepsFromTarget(exerciseTargetReps);
  }

  const presets = buildWarmupPresets(w, r, warmupCount, isTimed);
  let wi = 0;
  return sets.map((s) => {
    if (s.setType !== 'warmup') return s;
    const idx = wi++;
    if (s.completed) return s;
    const p = presets[idx];
    if (!p) return s;
    const weightEmpty = String(s.weight ?? '').trim() === '';
    const repsEmpty = String(s.reps ?? '').trim() === '';
    if (!weightEmpty && !repsEmpty) return s;
    return {
      ...s,
      weight: weightEmpty ? p.weight : s.weight,
      reps: repsEmpty ? p.reps : s.reps,
    };
  });
}

export function extractWarmupPresetsFromSets(sets: ActiveSet[]): WarmupPreset[] {
  return sets
    .filter((s) => s.setType === 'warmup')
    .map((s) => ({ weight: s.weight, reps: s.reps }));
}
