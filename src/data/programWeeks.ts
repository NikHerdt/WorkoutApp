/**
 * Weeks per phase from Jeff Nippard Ultimate PPL 5x/week spreadsheet
 * ("The_Ultimate_Push_Pull_Legs_System_-_5x copy.xlsx"): sheets 5x - Phase 1/2/3.
 * Phase order matches SEED_DATA / DB phase ids (1, 2, 3).
 */
export const PHASE_WEEK_COUNTS: readonly number[] = [6, 4, 3];

export function getWeekCountForPhase(phaseId: number): number {
  const idx = phaseId - 1;
  if (idx >= 0 && idx < PHASE_WEEK_COUNTS.length) {
    return PHASE_WEEK_COUNTS[idx];
  }
  return PHASE_WEEK_COUNTS[0] ?? 6;
}

export function getPhaseCount(): number {
  return PHASE_WEEK_COUNTS.length;
}

/** One completed 7-day template cycle (day 6 -> day 0) advances program week / phase. */
export function resolveWeekRollover(
  currentPhaseId: number,
  phaseWeek: number
): { currentPhaseId: number; phaseWeek: number } {
  let phaseId = currentPhaseId;
  let week = phaseWeek + 1;
  const maxWeeks = getWeekCountForPhase(phaseId);
  if (week > maxWeeks) {
    if (phaseId >= getPhaseCount()) {
      phaseId = 1;
    } else {
      phaseId = phaseId + 1;
    }
    week = 1;
  }
  return { currentPhaseId: phaseId, phaseWeek: week };
}

/**
 * Phase/week after N additional completed program weeks (each = one 6->0 schedule rollover).
 * Used by the weekly schedule "Next week" preview, not calendar dates.
 */
export function projectPhaseAfterProgramWeeks(
  phaseId: number,
  phaseWeek: number,
  programWeeksAhead: number
): { phaseId: number; phaseWeek: number } {
  let pid = phaseId;
  let pw = phaseWeek;
  const n = Math.max(0, Math.floor(programWeeksAhead));
  for (let i = 0; i < n; i++) {
    const r = resolveWeekRollover(pid, pw);
    pid = r.currentPhaseId;
    pw = r.phaseWeek;
  }
  return { phaseId: pid, phaseWeek: pw };
}
