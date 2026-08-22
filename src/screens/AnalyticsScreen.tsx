import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { colors } from '../theme/colors';
import { WEIGHT_UNIT } from '../constants/weightUnits';
import { toLocalDateYmd } from '../utils/dateLocal';
import {
  getLifetimeStats,
  getSessionDates,
  getSessionVolumes,
  getMuscleGroupVolume,
  getRecentPRs,
  getRecentBodyWeights,
  getTop1RMs,
  getWorkoutDatesInRange,
  getAvgSessionDurationMins,
  get1RMHistoryInRange,
  getBodyWeightEntries,
  getTotalVolumeForDays,
  getSetting,
  setSetting,
} from '../db/database';
import {
  getNutritionOverview,
  calorieAdjustmentFor,
  computePerformanceVsBalance,
  computeRestVsBalance,
  computeProteinSummary,
  computeTrainingDayIntake,
  computeFuellingAnalysis,
  loggedDays,
} from '../utils/nutritionAnalysis';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 64;

// gifted-charts renders y-axis labels OUTSIDE the `width` prop, so we must
// reserve space for them or the rightmost bars get clipped.
const Y_AXIS_LABEL_WIDTH = 40;
// The actual plot area passed to BarChart / LineChart.
const PLOT_WIDTH = CHART_WIDTH - Y_AXIS_LABEL_WIDTH;

// ─── Types ────────────────────────────────────────────────────────────────────

type RangeDays = 30 | 90 | 180 | 365;

const RANGES: { label: string; days: RangeDays }[] = [
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
];

interface LifetimeStats {
  totalSessions: number;
  totalVolume: number;
  currentStreak: number;
  longestStreak: number;
}

interface HeatmapCell {
  date: string;
  hasWorkout: boolean;
  isFuture: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MUSCLE_COLORS: Record<string, string> = {
  chest: colors.orange,
  back: colors.blue,
  shoulders: '#A78BFA',
  legs: '#34D399',
  biceps: '#F472B6',
  triceps: '#FB923C',
  core: '#FBBF24',
  glutes: '#34D399',
  hamstrings: '#34D399',
  quads: '#34D399',
  calves: '#6EE7B7',
  'upper back': colors.blue,
  'lower back': '#60A5FA',
  abs: '#FBBF24',
};

function muscleColor(name: string): string {
  return MUSCLE_COLORS[name.toLowerCase()] ?? colors.accent;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return String(Math.round(v));
}

function formatDuration(mins: number): string {
  if (mins <= 0) return '--';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

// ─── Adaptive bucketing ───────────────────────────────────────────────────────
// 30D → weekly (~4 buckets)
// 90D → bi-weekly (~7 buckets)
// 180D → monthly (6 buckets)
// 365D → monthly (12 buckets)
// This keeps all charts within ~12 bins so they never need horizontal scrolling.

type BinType = 'weekly' | 'biweekly' | 'monthly';

interface Bucket { key: string; label: string; startYmd: string; endYmd: string }

function getBinType(rangeDays: RangeDays): BinType {
  if (rangeDays <= 30) return 'weekly';
  if (rangeDays <= 90) return 'biweekly';
  return 'monthly';
}

function buildBuckets(rangeDays: RangeDays): Bucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayYmd = toLocalDateYmd(today);
  const binType = getBinType(rangeDays);

  if (binType === 'monthly') {
    const numMonths = rangeDays >= 300 ? 12 : 6;
    const result: Bucket[] = [];
    for (let i = numMonths - 1; i >= 0; i--) {
      const first = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const last = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
      const key = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
      const label = first.toLocaleString('default', { month: 'short' });
      result.push({ key, label, startYmd: toLocalDateYmd(first), endYmd: toLocalDateYmd(last) });
    }
    return result;
  }

  if (binType === 'biweekly') {
    const numBiweeks = Math.ceil(rangeDays / 14);
    const result: Bucket[] = [];
    for (let i = numBiweeks - 1; i >= 0; i--) {
      const endD = new Date(today);
      endD.setDate(today.getDate() - i * 14);
      const startD = new Date(endD);
      startD.setDate(endD.getDate() - 13);
      const startYmd = toLocalDateYmd(startD);
      const endYmd = i === 0 ? todayYmd : toLocalDateYmd(endD);
      result.push({
        key: startYmd,
        label: `${startD.getMonth() + 1}/${startD.getDate()}`,
        startYmd,
        endYmd,
      });
    }
    return result;
  }

  // Weekly
  const numWeeks = Math.ceil(rangeDays / 7);
  const result: Bucket[] = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i * 7);
    const monday = getMondayOfWeek(d);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const startYmd = toLocalDateYmd(monday);
    const endYmd = i === 0 ? todayYmd : toLocalDateYmd(sunday);
    result.push({
      key: startYmd,
      label: `${monday.getMonth() + 1}/${monday.getDate()}`,
      startYmd,
      endYmd,
    });
  }
  return result;
}

/** Map a YYYY-MM-DD date string to the key of whichever bucket it falls into. */
function dateToBucketKey(ymd: string, buckets: Bucket[]): string | null {
  for (const b of buckets) {
    if (ymd >= b.startYmd && ymd <= b.endYmd) return b.key;
  }
  return null;
}

/** Compute spacing so N line-chart points fit exactly within PLOT_WIDTH (no scroll). */
function lineSpacingForN(n: number): number {
  const usable = PLOT_WIDTH - 24; // 12px initialSpacing + 12px endSpacing
  if (n <= 1) return usable;
  return Math.max(2, Math.floor(usable / (n - 1)));
}

/**
 * Down-sample an array to at most maxPoints entries, keeping first and last,
 * so line charts stay readable and always fit within PLOT_WIDTH.
 */
function thinDataPoints<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data;
  const result: T[] = [];
  const step = (data.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    result.push(data[Math.round(i * step)]);
  }
  return result;
}

/** Build a grid of [week][dayIndex 0=Mon..6=Sun] cells for the heatmap. */
function buildHeatmapGrid(workoutDates: Set<string>, days: number): HeatmapCell[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toLocalDateYmd(today);

  // Start from the Monday of the week that contains (today - days + 1)
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - days + 1);
  const startDow = startDate.getDay();
  startDate.setDate(startDate.getDate() + (startDow === 0 ? -6 : 1 - startDow));

  const weeks: HeatmapCell[][] = [];
  const cursor = new Date(startDate);
  while (cursor <= today) {
    const week: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = toLocalDateYmd(cursor);
      week.push({
        date,
        hasWorkout: workoutDates.has(date),
        isFuture: date > todayStr,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * Compute bar width so all N bars fit exactly inside PLOT_WIDTH.
 * gifted-charts packs bars with ~3 px of implicit spacing between them, so
 * we solve: N * (barW + 3) + initialSpacing + endSpacing = PLOT_WIDTH
 */
function barWidthForN(numBars: number): number {
  const spacing = 16; // initialSpacing + endSpacing
  const available = PLOT_WIDTH - spacing;
  const bw = Math.floor(available / numBars) - 3;
  return Math.max(2, Math.min(28, bw));
}

/**
 * Build a tighter Y-axis domain so small changes remain visible.
 * Uses yAxisOffset + maxValue to zoom into the data range.
 */
function buildAdaptiveYAxis(
  points: { value: number }[],
  options?: { minRange?: number; minPadding?: number }
): { yAxisOffset?: number; maxValue?: number } {
  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length === 0) return {};

  const min = Math.min(...values);
  const max = Math.max(...values);
  const minRange = options?.minRange ?? 1;
  const minPadding = options?.minPadding ?? 0.25;
  const range = Math.max(max - min, minRange);
  const pad = Math.max(range * 0.12, minPadding);

  const offset = Math.max(0, min - pad);
  const axisMax = Math.max(max + pad - offset, minRange);
  return { yAxisOffset: offset, maxValue: axisMax };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Which sections the user has collapsed, persisted so the choice survives
 * leaving the tab. Only collapsed ids are stored, so a section added later
 * defaults to open without needing a migration.
 */
const COLLAPSED_SECTIONS_KEY = 'analytics_collapsed_sections';

/** Target body-weight change per week, as a percent. 0 = maintain. */
const GOAL_RATE_KEY = 'nutrition_goal_rate_pct';

const GOAL_RATES: { label: string; pct: number }[] = [
  { label: 'Cut 1%', pct: -1 },
  { label: 'Cut 0.5%', pct: -0.5 },
  { label: 'Maintain', pct: 0 },
  { label: 'Bulk 0.25%', pct: 0.25 },
  { label: 'Bulk 0.5%', pct: 0.5 },
];

function loadCollapsedSections(): Set<string> {
  try {
    const raw = getSetting(COLLAPSED_SECTIONS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

const CollapsedSectionsContext = createContext<{
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
}>({ isCollapsed: () => false, toggle: () => {} });

function CollapsibleSection({
  id,
  title,
  subtitle,
  children,
}: {
  /** Stable key for persisting the collapsed state. Never reuse across sections. */
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { isCollapsed, toggle } = useContext(CollapsedSectionsContext);
  const expanded = !isCollapsed(id);
  const setExpanded = () => toggle(id);
  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.collapsibleHeader}
        onPress={setExpanded}
        activeOpacity={0.7}
      >
        <View style={styles.collapsibleHeaderText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle && !expanded ? (
            <Text style={styles.sectionSubtitleInline}>{subtitle}</Text>
          ) : null}
        </View>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {expanded && subtitle ? (
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      ) : null}
      {expanded ? children : null}
    </View>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.statCard, highlight && styles.statCardHighlight]}>
      <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const HEATMAP_GAP = 2;
const DAY_LABELS = ['M', '', 'W', '', 'F', '', ''];
// card horizontal padding (14) × 2 + day-label column (10) + gap (2)
const HEATMAP_OVERHEAD = 14 * 2 + 12;

function heatmapCellSize(numWeeks: number): number {
  const available = SCREEN_WIDTH - 32 - HEATMAP_OVERHEAD; // 32 = screen content padding
  const size = Math.floor((available - numWeeks * HEATMAP_GAP) / numWeeks);
  return Math.max(4, Math.min(13, size));
}

function WorkoutHeatmap({ grid }: { grid: HeatmapCell[][] }) {
  if (grid.length === 0) return null;
  const cellSize = heatmapCellSize(grid.length);
  return (
    <View style={styles.heatmapScroll}>
      <View style={styles.heatmapContainer}>
        {/* Day-of-week labels */}
        <View style={[styles.heatmapDayLabels, { gap: HEATMAP_GAP }]}>
          {DAY_LABELS.map((label, i) => (
            <Text
              key={i}
              style={[styles.heatmapDayLabel, { height: cellSize, lineHeight: cellSize }]}
            >
              {label}
            </Text>
          ))}
        </View>
        {/* Week columns */}
        {grid.map((week, wi) => (
          <View key={wi} style={[styles.heatmapWeek, { gap: HEATMAP_GAP }]}>
            {week.map((cell, di) => (
              <View
                key={di}
                style={[
                  styles.heatmapCell,
                  { width: cellSize, height: cellSize },
                  cell.isFuture && styles.heatmapCellFuture,
                  cell.hasWorkout && styles.heatmapCellActive,
                ]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(90);
  const [autoScaleCharts, setAutoScaleCharts] = useState(true);

  // ── Lifetime (always all-time) ──
  const [stats, setStats] = useState<LifetimeStats>({
    totalSessions: 0,
    totalVolume: 0,
    currentStreak: 0,
    longestStreak: 0,
  });
  const [hasAnyData, setHasAnyData] = useState(false);

  // ── Range-dependent state ──
  const [avgDuration, setAvgDuration] = useState(0);
  const [weeklyFreq, setWeeklyFreq] = useState<{ value: number; label: string; frontColor: string }[]>([]);
  const [weeklyVol, setWeeklyVol] = useState<{ value: number; label: string; frontColor: string }[]>([]);
  const [muscleVolume, setMuscleVolume] = useState<{ name: string; volume: number; pct: number }[]>([]);
  const [bodyWeight, setBodyWeight] = useState<{ value: number; label: string }[]>([]);
  const [volBodyWeightData, setVolBodyWeightData] = useState<{
    volPoints: { value: number; label: string }[];
    bwPoints: { value: number; label: string }[];
  }>({ volPoints: [], bwPoints: [] });
  const [recentPRs, setRecentPRs] = useState<any[]>([]);
  const [top1RMs, setTop1RMs] = useState<any[]>([]);
  const [heatmapGrid, setHeatmapGrid] = useState<HeatmapCell[][]>([]);
  const [topExercise1RMs, setTopExercise1RMs] = useState<
    { name: string; data: { value: number; label: string }[]; color: string }[]
  >([]);
  const [fatigueIndex, setFatigueIndex] = useState<number | null>(null);
  const [relStrengthScores, setRelStrengthScores] = useState<
    { name: string; estimated_1rm: number; ratio: number }[]
  >([]);
  // ── Nutrition-derived state (empty until Health Connect imports something) ──
  const [nutrition, setNutrition] = useState<ReturnType<typeof getNutritionOverview> | null>(null);
  const [perfVsBalance, setPerfVsBalance] = useState<ReturnType<typeof computePerformanceVsBalance> | null>(null);
  const [restVsBalance, setRestVsBalance] = useState<ReturnType<typeof computeRestVsBalance> | null>(null);
  const [protein, setProtein] = useState<ReturnType<typeof computeProteinSummary> | null>(null);
  const [dayIntake, setDayIntake] = useState<ReturnType<typeof computeTrainingDayIntake> | null>(null);
  const [fuelling, setFuelling] = useState<ReturnType<typeof computeFuellingAnalysis> | null>(null);
  const [goalRatePct, setGoalRatePct] = useState<number>(() => {
    const raw = getSetting(GOAL_RATE_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  });

  const [strengthWeightRatio, setStrengthWeightRatio] = useState<{
    strengthChangePct: number;
    weightChangePct: number;
    ratio: number | null;
    topExerciseName: string;
  } | null>(null);

  const TREND_COLORS = [colors.accent, colors.orange, '#A78BFA'];

  useFocusEffect(
    useCallback(() => {
      // ── Lifetime stats (range-independent) ──
      const lifetime = getLifetimeStats();
      setStats(lifetime);
      setHasAnyData(lifetime.totalSessions > 0);

      // ── Average session duration for selected range ──
      setAvgDuration(getAvgSessionDurationMins(rangeDays));

      // ── Frequency & volume — adaptive bin size ──
      const buckets = buildBuckets(rangeDays);

      const freqMap: Record<string, number> = {};
      for (const d of getSessionDates(rangeDays)) {
        const k = dateToBucketKey(d, buckets);
        if (k) freqMap[k] = (freqMap[k] ?? 0) + 1;
      }
      setWeeklyFreq(
        buckets.map((b) => ({
          value: freqMap[b.key] ?? 0,
          label: b.label,
          frontColor: colors.accent,
        }))
      );

      const volMap: Record<string, number> = {};
      for (const row of getSessionVolumes(rangeDays)) {
        const k = dateToBucketKey(row.date, buckets);
        if (k) volMap[k] = (volMap[k] ?? 0) + row.volume;
      }
      setWeeklyVol(
        buckets.map((b) => ({
          value: volMap[b.key] ?? 0,
          label: b.label,
          frontColor: colors.blue,
        }))
      );

      // ── Muscle group volume ──
      const mgRows = getMuscleGroupVolume(rangeDays);
      const maxVol = mgRows.length > 0 ? mgRows[0].total_volume : 1;
      setMuscleVolume(
        mgRows.map((r) => ({
          name: r.muscle_group,
          volume: r.total_volume,
          pct: r.total_volume / maxVol,
        }))
      );

      // ── Body weight (thinned to 30 points so chart always fits) ──
      const bwLimit = Math.min(rangeDays, 30);
      const bwRows = getRecentBodyWeights(bwLimit).reverse();
      setBodyWeight(bwRows.map((r) => ({ value: r.weight_lbs, label: r.logged_date.slice(5) })));

      // ── Volume vs body weight overlay ──
      const bwBucketMap: Record<string, { sum: number; count: number }> = {};
      for (const row of getBodyWeightEntries(rangeDays)) {
        const k = dateToBucketKey(row.date, buckets);
        if (!k) continue;
        const entry = bwBucketMap[k] ?? { sum: 0, count: 0 };
        entry.sum += row.lbs;
        entry.count += 1;
        bwBucketMap[k] = entry;
      }
      const volPoints: { value: number; label: string }[] = [];
      const bwPoints: { value: number; label: string }[] = [];
      buckets.forEach((b) => {
        volPoints.push({ value: volMap[b.key] ?? 0, label: b.label });
        const bwEntry = bwBucketMap[b.key];
        bwPoints.push({ value: bwEntry ? Math.round(bwEntry.sum / bwEntry.count) : 0, label: b.label });
      });
      setVolBodyWeightData({ volPoints, bwPoints });

      // ── Recent PRs (range-aware) ──
      setRecentPRs(getRecentPRs(10, rangeDays));

      // ── All-time strength overview ──
      setTop1RMs(getTop1RMs(15));

      // ── Heatmap ──
      const workoutDates = new Set(getWorkoutDatesInRange(rangeDays));
      setHeatmapGrid(buildHeatmapGrid(workoutDates, rangeDays));

      // ── Top-3 exercise 1RM trends (thinned to 20 points so chart fits) ──
      const top3 = getTop1RMs(3);
      const trends = top3.map((ex, idx) => {
        const history = get1RMHistoryInRange(ex.exercise_id, rangeDays);
        const raw = history.map((h) => ({ value: h.estimated_1rm, label: h.date.slice(5) }));
        const thinned = thinDataPoints(raw, 20);
        const data = thinned.map((p, pi) => ({
          value: p.value,
          label: pi === 0 || pi === thinned.length - 1 ? p.label : '',
        }));
        return { name: ex.exercise_name, data, color: TREND_COLORS[idx] ?? colors.accent };
      });
      setTopExercise1RMs(trends.filter((t) => t.data.length > 1));

      // ── Nutrition & energy balance ──
      // All of these no-op cheaply when nothing has been imported, so they can
      // run unconditionally alongside the training queries.
      const overview = getNutritionOverview(rangeDays);
      setNutrition(overview);
      if (overview.hasNutritionData) {
        setPerfVsBalance(computePerformanceVsBalance(Math.max(rangeDays, 90)));
        setRestVsBalance(computeRestVsBalance(Math.max(rangeDays, 90)));
        setProtein(computeProteinSummary(rangeDays));
        setDayIntake(computeTrainingDayIntake(rangeDays));
        setFuelling(computeFuellingAnalysis(Math.max(rangeDays, 90)));
      } else {
        setPerfVsBalance(null);
        setRestVsBalance(null);
        setProtein(null);
        setDayIntake(null);
        setFuelling(null);
      }

      // ── Fatigue Index (Acute:Chronic Workload Ratio) ──
      // AL = total volume last 7 days; CL = avg weekly volume over last 28 days
      const vol7 = getTotalVolumeForDays(7);
      const vol28 = getTotalVolumeForDays(28);
      const chronicLoad = vol28 / 4;
      setFatigueIndex(chronicLoad > 0 ? parseFloat((vol7 / chronicLoad).toFixed(2)) : null);

      // ── Relative Strength Score (top lift 1RM / body weight) ──
      const latestBW = getRecentBodyWeights(1);
      const currentBW = latestBW[0]?.weight_lbs ?? 0;
      if (currentBW > 0) {
        const top5 = getTop1RMs(5);
        setRelStrengthScores(
          top5
            .filter((ex) => ex.estimated_1rm > 0)
            .map((ex) => ({
              name: ex.exercise_name,
              estimated_1rm: ex.estimated_1rm,
              ratio: parseFloat((ex.estimated_1rm / currentBW).toFixed(2)),
            }))
        );
      } else {
        setRelStrengthScores([]);
      }

      // ── Strength Gain vs Weight Gain ──
      const top1 = getTop1RMs(1)[0];
      if (top1) {
        const rmHistory = get1RMHistoryInRange(top1.exercise_id, rangeDays);
        const bwHistory = getBodyWeightEntries(rangeDays);
        if (rmHistory.length >= 2 && bwHistory.length >= 2) {
          const start1RM = rmHistory[0].estimated_1rm;
          const end1RM = rmHistory[rmHistory.length - 1].estimated_1rm;
          const startBW = bwHistory[0].lbs;
          const endBW = bwHistory[bwHistory.length - 1].lbs;
          const strengthChangePct = ((end1RM - start1RM) / start1RM) * 100;
          const weightChangePct = ((endBW - startBW) / startBW) * 100;
          const ratio = Math.abs(weightChangePct) > 0.1
            ? parseFloat((strengthChangePct / weightChangePct).toFixed(1))
            : null;
          setStrengthWeightRatio({
            strengthChangePct: parseFloat(strengthChangePct.toFixed(1)),
            weightChangePct: parseFloat(weightChangePct.toFixed(1)),
            ratio,
            topExerciseName: top1.exercise_name,
          });
        } else {
          setStrengthWeightRatio(null);
        }
      } else {
        setStrengthWeightRatio(null);
      }
    }, [rangeDays])
  );

  const hasWeeklyData = weeklyFreq.some((d) => d.value > 0);
  const hasMuscleData = muscleVolume.length > 0;
  const hasBodyWeight = bodyWeight.length > 0;
  const hasPRs = recentPRs.length > 0;
  const has1RMs = top1RMs.length > 0;
  const hasHeatmap = heatmapGrid.some((w) => w.some((c) => c.hasWorkout));
  const hasOverlayBW = volBodyWeightData.bwPoints.some((p) => p.value > 0);
  const overlayBWChartData = volBodyWeightData.bwPoints.filter((p) => p.value > 0);
  const has1RMTrends = topExercise1RMs.length > 0;
  const hasFatigueIndex = fatigueIndex !== null;
  const hasRelStrength = relStrengthScores.length > 0;
  const hasStrengthWeightRatio = strengthWeightRatio !== null;

  const fatigueColor =
    fatigueIndex === null ? colors.textSecondary
    : fatigueIndex < 0.8 ? colors.blue
    : fatigueIndex <= 1.3 ? '#34D399'
    : colors.orange;
  const fatigueStatusLabel =
    fatigueIndex === null ? ''
    : fatigueIndex < 0.8 ? 'Under-training — consider increasing volume'
    : fatigueIndex <= 1.3 ? 'Optimal training zone'
    : 'Overreaching — consider a rest day';

  // Persisted collapse state: kept in React state for immediate feedback and
  // mirrored to settings so it survives leaving the tab.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(loadCollapsedSections);
  const collapsedApi = useMemo(
    () => ({
      isCollapsed: (id: string) => collapsedSections.has(id),
      toggle: (id: string) => {
        setCollapsedSections((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          setSetting(COLLAPSED_SECTIONS_KEY, JSON.stringify([...next]));
          return next;
        });
      },
    }),
    [collapsedSections]
  );

  const rangeLabel = RANGES.find((r) => r.days === rangeDays)?.label ?? '';
  const binLabel = (() => {
    const t = getBinType(rangeDays);
    if (t === 'monthly') return 'monthly';
    if (t === 'biweekly') return 'bi-weekly';
    return 'weekly';
  })();
  const bodyWeightAxis = buildAdaptiveYAxis(bodyWeight, { minRange: 1, minPadding: 0.2 });
  const overlayVolAxis = buildAdaptiveYAxis(volBodyWeightData.volPoints, {
    minRange: 500,
    minPadding: 100,
  });
  const overlayBWAxis = buildAdaptiveYAxis(overlayBWChartData, {
    minRange: 1,
    minPadding: 0.2,
  });

  return (
    <CollapsedSectionsContext.Provider value={collapsedApi}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Lifetime Stats — always all-time, not collapsible */}
      <Text style={styles.sectionTitle}>Lifetime</Text>
      <View style={styles.statsGrid}>
        <StatCard label="Sessions" value={String(stats.totalSessions)} />
        <StatCard label={`Volume (${WEIGHT_UNIT})`} value={formatVolume(stats.totalVolume)} />
        <StatCard label="Current Streak" value={`${stats.currentStreak}d`} highlight />
        <StatCard label="Best Streak" value={`${stats.longestStreak}d`} />
        <StatCard label={`Avg Duration (${rangeLabel})`} value={formatDuration(avgDuration)} />
      </View>

      {!hasAnyData && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No workout data yet</Text>
          <Text style={styles.emptyText}>
            Complete your first workout to start seeing analytics here.
          </Text>
        </View>
      )}

      {/* Range Selector */}
      {hasAnyData && (
        <>
          <View style={styles.rangeRow}>
            {RANGES.map((r) => (
              <TouchableOpacity
                key={r.days}
                style={[styles.rangeBtn, rangeDays === r.days && styles.rangeBtnActive]}
                onPress={() => setRangeDays(r.days)}
                activeOpacity={0.7}
              >
                <Text style={[styles.rangeBtnText, rangeDays === r.days && styles.rangeBtnTextActive]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.chartScaleRow}>
            <Text style={styles.chartScaleLabel}>Y-axis scaling</Text>
            <TouchableOpacity
              style={[styles.chartScaleBtn, autoScaleCharts && styles.chartScaleBtnActive]}
              onPress={() => setAutoScaleCharts((v) => !v)}
              activeOpacity={0.75}
            >
              <Text style={[styles.chartScaleBtnText, autoScaleCharts && styles.chartScaleBtnTextActive]}>
                {autoScaleCharts ? 'Auto scale: ON' : 'Auto scale: OFF'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Workout Heatmap */}
      {hasHeatmap && (
        <CollapsibleSection
          id="heatmap"
          title="Workout Heatmap"
          subtitle={`Daily workout log — last ${rangeDays} days`}
        >
          <View style={styles.card}>
            <WorkoutHeatmap grid={heatmapGrid} />
            <View style={styles.heatmapLegend}>
              <View style={[styles.heatmapCell, { width: 10, height: 10, marginRight: 4 }]} />
              <Text style={styles.heatmapLegendText}>Rest</Text>
              <View style={[styles.heatmapCell, styles.heatmapCellActive, { width: 10, height: 10, marginLeft: 12, marginRight: 4 }]} />
              <Text style={styles.heatmapLegendText}>Trained</Text>
            </View>
          </View>
        </CollapsibleSection>
      )}

      {/* Body Weight Trend */}
      {hasBodyWeight && (
        <CollapsibleSection
          id="body-weight"
          title="Body Weight"
          subtitle={`Last ${bodyWeight.length} entries (${WEIGHT_UNIT})`}
        >
          <View style={styles.chartCard}>
            <LineChart
              data={bodyWeight}
              width={PLOT_WIDTH}
              height={160}
              color={colors.orange}
              thickness={2}
              dataPointsColor={colors.orange}
              dataPointsRadius={3}
              curved
              xAxisColor={colors.border}
              yAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
              yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
              xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
              rulesColor={colors.border}
              rulesType="dashed"
              backgroundColor={colors.surface}
              noOfSections={4}
              yAxisOffset={autoScaleCharts ? bodyWeightAxis.yAxisOffset : undefined}
              maxValue={autoScaleCharts ? bodyWeightAxis.maxValue : undefined}
              spacing={lineSpacingForN(bodyWeight.length)}
              initialSpacing={12}
              endSpacing={12}
              hideDataPoints={bodyWeight.length > 20}
              scrollToEnd
              pointerConfig={{
                pointerStripColor: colors.orange,
                pointerStripWidth: 1,
                pointerColor: colors.orange,
                radius: 5,
                pointerLabelWidth: 80,
                pointerLabelHeight: 40,
                activatePointersDelay: 300,
                autoAdjustPointerLabelPosition: true,
                pointerLabelComponent: (items: any[]) => (
                  <View style={[styles.tooltip, { borderColor: colors.orange + '44' }]}>
                    <Text style={[styles.tooltipValue, { color: colors.orange }]}>
                      {items[0]?.value} {WEIGHT_UNIT}
                    </Text>
                    <Text style={styles.tooltipDate}>{items[0]?.label}</Text>
                  </View>
                ),
              }}
            />
          </View>
        </CollapsibleSection>
      )}

      {/* Fatigue Index */}
      {hasFatigueIndex && (
        <CollapsibleSection
          id="fatigue"
          title="Fatigue Index"
          subtitle="Acute vs chronic training load (ACWR) — this week vs 4-week avg"
        >
          <View style={styles.card}>
            <View style={styles.fatigueRow}>
              <Text style={[styles.fatigueValue, { color: fatigueColor }]}>
                {fatigueIndex!.toFixed(2)}
              </Text>
              <View style={styles.fatigueRight}>
                <Text style={[styles.fatigueStatus, { color: fatigueColor }]}>
                  {fatigueStatusLabel}
                </Text>
                <Text style={styles.fatigueZoneHint}>
                  {'< 0.8 under  •  0.8 – 1.3 optimal  •  > 1.3 overreaching'}
                </Text>
              </View>
            </View>
          </View>
        </CollapsibleSection>
      )}

      {/* Volume by Muscle Group */}
      {hasMuscleData && (
        <CollapsibleSection
          id="muscle-volume"
          title="Muscle Group Volume"
          subtitle={`Last ${rangeDays} days`}
        >
          <View style={styles.card}>
            {muscleVolume.map((item) => (
              <View key={item.name} style={styles.muscleRow}>
                <Text style={styles.muscleLabel} numberOfLines={1}>
                  {item.name.charAt(0).toUpperCase() + item.name.slice(1)}
                </Text>
                <View style={styles.muscleBarTrack}>
                  <View
                    style={[
                      styles.muscleBarFill,
                      { width: `${Math.round(item.pct * 100)}%`, backgroundColor: muscleColor(item.name) },
                    ]}
                  />
                </View>
                <Text style={styles.muscleValue}>{formatVolume(item.volume)}</Text>
              </View>
            ))}
          </View>
        </CollapsibleSection>
      )}

      {/* Strength Gain vs Weight Gain */}
      {hasStrengthWeightRatio && (
        <CollapsibleSection
          id="strength-vs-weight"
          title="Strength vs Weight Gain"
          subtitle={`${strengthWeightRatio!.topExerciseName} — last ${rangeDays} days`}
        >
          <View style={styles.card}>
            <View style={styles.swRow}>
              <View style={styles.swStat}>
                <Text style={styles.swLabel}>Strength</Text>
                <Text style={[
                  styles.swValue,
                  { color: strengthWeightRatio!.strengthChangePct >= 0 ? '#34D399' : colors.orange },
                ]}>
                  {strengthWeightRatio!.strengthChangePct >= 0 ? '+' : ''}
                  {strengthWeightRatio!.strengthChangePct}%
                </Text>
              </View>
              <View style={styles.swDivider} />
              <View style={styles.swStat}>
                <Text style={styles.swLabel}>Body Weight</Text>
                <Text style={[
                  styles.swValue,
                  { color: colors.textSecondary },
                ]}>
                  {strengthWeightRatio!.weightChangePct >= 0 ? '+' : ''}
                  {strengthWeightRatio!.weightChangePct}%
                </Text>
              </View>
              {strengthWeightRatio!.ratio !== null && (
                <>
                  <View style={styles.swDivider} />
                  <View style={styles.swStat}>
                    <Text style={styles.swLabel}>Ratio</Text>
                    <Text style={[styles.swValue, { color: colors.accent }]}>
                      {strengthWeightRatio!.ratio > 0 ? '+' : ''}
                      {strengthWeightRatio!.ratio}x
                    </Text>
                  </View>
                </>
              )}
            </View>
            {strengthWeightRatio!.ratio !== null && (
              <Text style={styles.swCaption}>
                {strengthWeightRatio!.ratio > 1
                  ? `Strength improving ${strengthWeightRatio!.ratio}x faster than weight is changing`
                  : strengthWeightRatio!.ratio < 0
                  ? 'Losing strength while body weight changes — consider adjusting training'
                  : 'Weight changing faster than strength — monitor recovery'}
              </Text>
            )}
          </View>
        </CollapsibleSection>
      )}

      {/* Volume vs Body Weight — two stacked charts */}
      {hasAnyData && (
        <CollapsibleSection
          id="volume-vs-weight"
          title="Volume vs Body Weight"
          subtitle={`${binLabel.charAt(0).toUpperCase() + binLabel.slice(1)} — last ${rangeDays} days`}
        >
          {/* Weekly Volume */}
          <Text style={styles.overlayChartLabel}>
            Weekly Volume ({WEIGHT_UNIT})
          </Text>
          <View style={[styles.chartCard, { marginBottom: 10 }]}>
            {volBodyWeightData.volPoints.length > 0 ? (
              <LineChart
                data={volBodyWeightData.volPoints}
                width={PLOT_WIDTH}
                height={130}
                spacing={lineSpacingForN(volBodyWeightData.volPoints.length)}
                initialSpacing={12}
                endSpacing={12}
                scrollToEnd
                color={colors.blue}
                thickness={2}
                dataPointsColor={colors.blue}
                dataPointsRadius={3}
                xAxisColor={colors.border}
                yAxisColor={colors.border}
                yAxisTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
                yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
                xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
                rulesColor={colors.border}
                rulesType="dashed"
                backgroundColor={colors.surface}
                noOfSections={3}
                yAxisOffset={autoScaleCharts ? overlayVolAxis.yAxisOffset : undefined}
                maxValue={autoScaleCharts ? overlayVolAxis.maxValue : undefined}
                hideDataPoints={volBodyWeightData.volPoints.length > 20}
                formatYLabel={(v) => formatVolume(Number(v))}
              />
            ) : (
              <View style={styles.chartPlaceholder}>
                <Text style={styles.chartPlaceholderText}>No volume data yet</Text>
              </View>
            )}
          </View>

          {/* Weekly Body Weight */}
          <Text style={styles.overlayChartLabel}>
            Avg Body Weight ({WEIGHT_UNIT})
          </Text>
          <View style={styles.chartCard}>
            {hasOverlayBW ? (
              <LineChart
                data={overlayBWChartData}
                width={PLOT_WIDTH}
                height={130}
                spacing={lineSpacingForN(overlayBWChartData.length)}
                initialSpacing={12}
                endSpacing={12}
                scrollToEnd
                color={colors.orange}
                thickness={2}
                dataPointsColor={colors.orange}
                dataPointsRadius={3}
                xAxisColor={colors.border}
                yAxisColor={colors.border}
                yAxisTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
                yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
                xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
                rulesColor={colors.border}
                rulesType="dashed"
                backgroundColor={colors.surface}
                noOfSections={3}
                yAxisOffset={autoScaleCharts ? overlayBWAxis.yAxisOffset : undefined}
                maxValue={autoScaleCharts ? overlayBWAxis.maxValue : undefined}
                hideDataPoints={overlayBWChartData.length > 20}
              />
            ) : (
              <View style={styles.chartPlaceholder}>
                <Text style={styles.chartPlaceholderText}>
                  Log body weight after workouts to see this chart
                </Text>
              </View>
            )}
          </View>
        </CollapsibleSection>
      )}

      {/* Strength Overview — all-time, range-independent */}
      {has1RMs && (
        <CollapsibleSection
          id="strength-overview"
          title="Strength Overview"
          subtitle="All-time estimated 1RM per exercise"
        >
          <View style={styles.card}>
            {top1RMs.map((item, idx) => (
              <View
                key={idx}
                style={[styles.prRow, idx < top1RMs.length - 1 && styles.prRowBorder]}
              >
                <View style={styles.prLeft}>
                  <Text style={styles.prExercise} numberOfLines={1}>{item.exercise_name}</Text>
                  <Text style={styles.prDate}>
                    {item.best_weight} {WEIGHT_UNIT} x {item.best_reps} reps — {item.last_date}
                  </Text>
                </View>
                <View style={styles.prRight}>
                  <Text style={styles.prWeight}>~{item.estimated_1rm} {WEIGHT_UNIT}</Text>
                  <Text style={styles.pr1rm}>est. 1RM</Text>
                </View>
              </View>
            ))}
          </View>
        </CollapsibleSection>
      )}

      {/* Relative Strength */}
      {hasRelStrength && (
        <CollapsibleSection
          id="relative-strength"
          title="Relative Strength"
          subtitle="Estimated 1RM as a multiple of current body weight"
        >
          <View style={styles.card}>
            {relStrengthScores.map((ex, idx) => (
              <View
                key={ex.name}
                style={[styles.relRow, idx < relStrengthScores.length - 1 && styles.prRowBorder]}
              >
                <Text style={styles.relName} numberOfLines={1}>{ex.name}</Text>
                <View style={styles.relRight}>
                  <Text style={styles.relRatio}>{ex.ratio.toFixed(2)}x BW</Text>
                  <Text style={styles.relWeight}>{ex.estimated_1rm} {WEIGHT_UNIT}</Text>
                </View>
              </View>
            ))}
          </View>
        </CollapsibleSection>
      )}

      {/* Training Frequency */}
      {hasWeeklyData && (
        <CollapsibleSection
          id="frequency"
          title="Training Frequency"
          subtitle={`Sessions per ${binLabel === 'bi-weekly' ? '2 weeks' : binLabel.replace('ly', '')} — last ${rangeDays} days`}
        >
          <View style={styles.chartCard}>
            <BarChart
              data={weeklyFreq}
              width={PLOT_WIDTH}
              height={160}
              barWidth={barWidthForN(weeklyFreq.length)}
              yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
              roundedTop
              xAxisColor={colors.border}
              yAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
              xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
              rulesColor={colors.border}
              backgroundColor={colors.surface}
              noOfSections={4}
              initialSpacing={8}
              endSpacing={8}
              showFractionalValues={false}
              scrollToEnd
            />
          </View>
        </CollapsibleSection>
      )}

      {/* Recent PRs */}
      {hasPRs && (
        <CollapsibleSection
          id="recent-prs"
          title="Recent PRs"
          subtitle={`Best set per exercise — last ${rangeDays} days`}
        >
          <View style={styles.card}>
            {recentPRs.map((pr, idx) => (
              <View
                key={idx}
                style={[styles.prRow, idx < recentPRs.length - 1 && styles.prRowBorder]}
              >
                <View style={styles.prLeft}>
                  <Text style={styles.prExercise} numberOfLines={1}>{pr.exercise_name}</Text>
                  <Text style={styles.prDate}>{pr.date}</Text>
                </View>
                <View style={styles.prRight}>
                  <Text style={styles.prWeight}>
                    {pr.max_weight} {WEIGHT_UNIT} x {pr.reps}
                  </Text>
                  <Text style={styles.pr1rm}>~{pr.estimated_1rm} {WEIGHT_UNIT} 1RM</Text>
                </View>
              </View>
            ))}
          </View>
        </CollapsibleSection>
      )}

      {/* Volume Trend */}
      {hasWeeklyData && (
        <CollapsibleSection
          id="volume"
          title="Volume Trend"
          subtitle={`Total ${WEIGHT_UNIT} lifted per ${binLabel === 'bi-weekly' ? '2 weeks' : binLabel.replace('ly', '')} — last ${rangeDays} days`}
        >
          <View style={styles.chartCard}>
            <BarChart
              data={weeklyVol}
              width={PLOT_WIDTH}
              height={160}
              barWidth={barWidthForN(weeklyVol.length)}
              yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
              roundedTop
              xAxisColor={colors.border}
              yAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
              xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
              rulesColor={colors.border}
              backgroundColor={colors.surface}
              noOfSections={4}
              initialSpacing={8}
              endSpacing={8}
              showFractionalValues={false}
              formatYLabel={(v) => formatVolume(Number(v))}
              scrollToEnd
            />
          </View>
        </CollapsibleSection>
      )}

      {/* 1RM Trends for top exercises */}
      {has1RMTrends && (
        <CollapsibleSection
          id="1rm-trends"
          title="1RM Trends"
          subtitle={`Estimated 1RM over time — last ${rangeDays} days`}
        >
          {topExercise1RMs.map((ex) => (
            <View key={ex.name} style={styles.trendBlock}>
              <Text style={[styles.trendExerciseName, { color: ex.color }]}>{ex.name}</Text>
              <View style={styles.chartCard}>
                {(() => {
                  const trendAxis = buildAdaptiveYAxis(ex.data, { minRange: 1, minPadding: 0.25 });
                  return (
                <LineChart
                  data={ex.data}
                  width={PLOT_WIDTH}
                  height={120}
                  color={ex.color}
                  thickness={2}
                  dataPointsColor={ex.color}
                  dataPointsRadius={3}
                  curved
                  xAxisColor={colors.border}
                  yAxisColor={colors.border}
                  yAxisTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
                  yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
                  xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
                  rulesColor={colors.border}
                  rulesType="dashed"
                  backgroundColor={colors.surface}
                  noOfSections={3}
                  yAxisOffset={autoScaleCharts ? trendAxis.yAxisOffset : undefined}
                  maxValue={autoScaleCharts ? trendAxis.maxValue : undefined}
                  spacing={lineSpacingForN(ex.data.length)}
                  initialSpacing={12}
                  endSpacing={12}
                  hideDataPoints={ex.data.length > 15}
                  scrollToEnd
                />
                  );
                })()}
              </View>
            </View>
          ))}
        </CollapsibleSection>
      )}

      {/* Energy Balance & TDEE — the headline number when nutrition is available */}
      {nutrition?.hasNutritionData && (
        <CollapsibleSection
          id="energy-balance"
          title="Energy Balance"
          subtitle="Maintenance calories measured from your own intake and weight trend"
        >
          <View style={styles.card}>
            {nutrition.tdee.tdee != null ? (
              <>
                <View style={styles.tdeeHeader}>
                  <View>
                    <Text style={styles.tdeeValue}>{nutrition.tdee.tdee.toLocaleString()}</Text>
                    <Text style={styles.tdeeUnit}>kcal/day maintenance</Text>
                  </View>
                  <Text style={styles.tdeeConfidence}>{nutrition.tdee.confidence} confidence</Text>
                </View>

                <View style={styles.swRow}>
                  <View style={styles.swStat}>
                    <Text style={styles.swLabel}>Eating</Text>
                    <Text style={styles.swValue}>{nutrition.tdee.meanIntake.toLocaleString()}</Text>
                  </View>
                  <View style={styles.swDivider} />
                  <View style={styles.swStat}>
                    <Text style={styles.swLabel}>Trend weight</Text>
                    <Text style={styles.swValue}>
                      {nutrition.tdee.currentTrendLbs?.toFixed(1)} {WEIGHT_UNIT}
                    </Text>
                  </View>
                  <View style={styles.swDivider} />
                  <View style={styles.swStat}>
                    <Text style={styles.swLabel}>Per week</Text>
                    <Text
                      style={[
                        styles.swValue,
                        {
                          color:
                            Math.abs(nutrition.tdee.weeklyRatePct) < 0.05
                              ? colors.textSecondary
                              : nutrition.tdee.weeklyRateLbs > 0
                                ? colors.blue
                                : colors.orange,
                        },
                      ]}
                    >
                      {nutrition.tdee.weeklyRateLbs >= 0 ? '+' : ''}
                      {nutrition.tdee.weeklyRateLbs.toFixed(2)}
                    </Text>
                  </View>
                </View>

                <Text style={styles.goalLabel}>GOAL RATE</Text>
                <View style={styles.goalRow}>
                  {GOAL_RATES.map((g) => {
                    const active = Math.abs(goalRatePct - g.pct) < 0.001;
                    return (
                      <TouchableOpacity
                        key={g.label}
                        style={[styles.goalChip, active && styles.goalChipActive]}
                        onPress={() => {
                          setGoalRatePct(g.pct);
                          setSetting(GOAL_RATE_KEY, String(g.pct));
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.goalChipText, active && styles.goalChipTextActive]}>
                          {g.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {(() => {
                  const adj = calorieAdjustmentFor(nutrition.tdee, goalRatePct);
                  if (!adj) return null;
                  const onTarget = Math.abs(adj.delta) < 75;
                  return (
                    <View style={styles.adviceBox}>
                      <Text style={styles.adviceTarget}>
                        Target {adj.targetIntake.toLocaleString()} kcal/day
                      </Text>
                      <Text style={styles.adviceText}>
                        {onTarget
                          ? 'You are on target — keep intake where it is.'
                          : `${adj.delta > 0 ? 'Add' : 'Remove'} about ${Math.abs(adj.delta)} kcal/day from your current average.`}
                      </Text>
                    </View>
                  );
                })()}

                <Text style={styles.coverageNote}>
                  Based on {nutrition.tdee.daysLogged} logged days over {nutrition.tdee.windowDays}.
                  Rate comes from a regression on your weigh-ins, so single heavy days don\u2019t skew it.
                </Text>
              </>
            ) : (
              <Text style={styles.blockedText}>{nutrition.tdee.blockedReason}</Text>
            )}
          </View>
        </CollapsibleSection>
      )}

      {/* Calories & macros */}
      {nutrition?.hasNutritionData && (
        <CollapsibleSection
          id="nutrition-trend"
          title="Calories & Macros"
          subtitle={`Imported from Cronometer \u2014 ${nutrition.daysStored} logged days`}
        >
          <View style={styles.card}>
            {(() => {
              const days = loggedDays(nutrition.nutrition);
              const avg = (pick: (d: (typeof days)[number]) => number | null) => {
                const vals = days.map(pick).filter((v): v is number => v != null);
                return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
              };
              return (
                <View style={styles.statsGrid}>
                  <StatCard label="Avg kcal" value={avg((d) => d.energy_kcal).toLocaleString()} highlight />
                  <StatCard label="Protein (g)" value={String(avg((d) => d.protein_g))} />
                  <StatCard label="Carbs (g)" value={String(avg((d) => d.carbs_g))} />
                  <StatCard label="Fat (g)" value={String(avg((d) => d.fat_g))} />
                  <StatCard label="Fiber (g)" value={String(avg((d) => d.fiber_g))} />
                </View>
              );
            })()}
          </View>
        </CollapsibleSection>
      )}

      {/* Strength vs energy balance */}
      {perfVsBalance && (
        <CollapsibleSection
          id="strength-vs-balance"
          title="Strength vs Energy Balance"
          subtitle="How sessions went depending on how you were eating around them"
        >
          <View style={styles.card}>
            {perfVsBalance.insufficientReason ? (
              <Text style={styles.blockedText}>{perfVsBalance.insufficientReason}</Text>
            ) : (
              <>
                {perfVsBalance.buckets.map((b, idx) => (
                  <View
                    key={b.label}
                    style={[styles.relRow, idx < perfVsBalance.buckets.length - 1 && styles.prRowBorder]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.relName}>{b.label}</Text>
                      <Text style={styles.subtleNote}>
                        {b.sessions} session{b.sessions === 1 ? '' : 's'} \u00b7 avg {b.meanBalance >= 0 ? '+' : ''}
                        {b.meanBalance} kcal
                      </Text>
                    </View>
                    <View style={styles.relRight}>
                      <Text
                        style={[
                          styles.relRatio,
                          {
                            color:
                              b.meanE1rmDeltaPct >= 1
                                ? colors.success
                                : b.meanE1rmDeltaPct <= -1
                                  ? colors.danger
                                  : colors.textSecondary,
                          },
                        ]}
                      >
                        {b.meanE1rmDeltaPct >= 0 ? '+' : ''}
                        {b.meanE1rmDeltaPct.toFixed(1)}%
                      </Text>
                      <Text style={styles.relWeight}>{b.meanE1rm} {WEIGHT_UNIT} e1RM</Text>
                    </View>
                  </View>
                ))}
                <Text style={styles.coverageNote}>
                  Change in best estimated 1RM against your earliest sessions in this window. Strength
                  holding through a deficit is the sign the cut is going well.
                </Text>
              </>
            )}
          </View>
        </CollapsibleSection>
      )}

      {/* Rest response vs energy balance */}
      {restVsBalance && (
        <CollapsibleSection
          id="rest-vs-balance"
          title="Recovery vs Energy Balance"
          subtitle="Whether inter-set recovery suffers when under-fuelled"
        >
          <View style={styles.card}>
            {restVsBalance.insufficientReason ? (
              <Text style={styles.blockedText}>{restVsBalance.insufficientReason}</Text>
            ) : (
              <>
                {restVsBalance.groups.map((g, idx) => (
                  <View
                    key={g.label}
                    style={[styles.relRow, idx < restVsBalance.groups.length - 1 && styles.prRowBorder]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.relName}>{g.label}</Text>
                      <Text style={styles.subtleNote}>
                        {g.pairs} timed sets \u00b7 avg rest {Math.floor(g.meanRestSeconds / 60)}:
                        {String(g.meanRestSeconds % 60).padStart(2, '0')}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.relRatio,
                        { color: g.meanDeltaPct >= 0 ? colors.success : colors.danger },
                      ]}
                    >
                      {g.meanDeltaPct >= 0 ? '+' : ''}
                      {g.meanDeltaPct.toFixed(1)}%
                    </Text>
                  </View>
                ))}
                {restVsBalance.deficitPenaltyPct != null && (
                  <Text style={styles.coverageNote}>
                    {restVsBalance.deficitPenaltyPct > 1
                      ? `You hold ${restVsBalance.deficitPenaltyPct.toFixed(1)}% more of a set when eating at or above maintenance. Consider resting longer while cutting.`
                      : 'No meaningful recovery penalty from your deficit so far.'}
                  </Text>
                )}
              </>
            )}
          </View>
        </CollapsibleSection>
      )}

      {/* Protein adequacy */}
      {protein && !protein.insufficientReason && (
        <CollapsibleSection
          id="protein"
          title="Protein"
          subtitle="Intake relative to body weight"
        >
          <View style={styles.card}>
            <View style={styles.swRow}>
              <View style={styles.swStat}>
                <Text style={styles.swLabel}>Avg per day</Text>
                <Text style={styles.swValue}>{protein.meanProteinG} g</Text>
              </View>
              <View style={styles.swDivider} />
              <View style={styles.swStat}>
                <Text style={styles.swLabel}>Per {WEIGHT_UNIT}</Text>
                <Text
                  style={[
                    styles.swValue,
                    { color: protein.gramsPerLb >= 0.7 ? colors.success : colors.orange },
                  ]}
                >
                  {protein.gramsPerLb.toFixed(2)}
                </Text>
              </View>
              <View style={styles.swDivider} />
              <View style={styles.swStat}>
                <Text style={styles.swLabel}>Days on target</Text>
                <Text style={styles.swValue}>
                  {protein.daysMeetingTarget}/{protein.daysLogged}
                </Text>
              </View>
            </View>
            <Text style={styles.coverageNote}>
              Target line is 0.7 g per {WEIGHT_UNIT} of body weight \u2014 a common floor for lifters
              holding muscle in a deficit.
            </Text>
          </View>
        </CollapsibleSection>
      )}

      {/* Pre-workout fuelling */}
      {fuelling && (
        <CollapsibleSection
          id="fuelling"
          title="Workout Fuelling"
          subtitle={`Performance by what you ate in the ${fuelling.windowHours}h before training`}
        >
          <View style={styles.card}>
            {fuelling.insufficientReason ? (
              <Text style={styles.blockedText}>{fuelling.insufficientReason}</Text>
            ) : (
              <>
                {fuelling.groups.map((g, idx) => (
                  <View
                    key={g.label}
                    style={[styles.relRow, idx < fuelling.groups.length - 1 && styles.prRowBorder]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.relName}>{g.label}</Text>
                      <Text style={styles.subtleNote}>
                        {g.sessions} session{g.sessions === 1 ? '' : 's'} \u00b7 avg {g.meanPreKcal} kcal before
                      </Text>
                    </View>
                    <View style={styles.relRight}>
                      <Text style={styles.relRatio}>{g.meanE1rm} {WEIGHT_UNIT}</Text>
                      <Text style={styles.relWeight}>{formatVolume(g.meanVolume)} vol</Text>
                    </View>
                  </View>
                ))}
                <Text style={styles.coverageNote}>
                  Only sessions on days with meals logged are counted, so an untracked day isn\u2019t
                  mistaken for training fasted.
                </Text>
              </>
            )}
          </View>
        </CollapsibleSection>
      )}

      {/* Training day vs rest day intake */}
      {dayIntake && !dayIntake.insufficientReason && (
        <CollapsibleSection
          id="training-day-intake"
          title="Training vs Rest Day Intake"
          subtitle="Whether you actually eat more on the days you train"
        >
          <View style={styles.card}>
            <View style={styles.swRow}>
              <View style={styles.swStat}>
                <Text style={styles.swLabel}>Training days</Text>
                <Text style={styles.swValue}>{dayIntake.trainingDayKcal.toLocaleString()}</Text>
              </View>
              <View style={styles.swDivider} />
              <View style={styles.swStat}>
                <Text style={styles.swLabel}>Rest days</Text>
                <Text style={styles.swValue}>{dayIntake.restDayKcal.toLocaleString()}</Text>
              </View>
              <View style={styles.swDivider} />
              <View style={styles.swStat}>
                <Text style={styles.swLabel}>Difference</Text>
                <Text
                  style={[
                    styles.swValue,
                    { color: dayIntake.differenceKcal >= 0 ? colors.success : colors.orange },
                  ]}
                >
                  {dayIntake.differenceKcal >= 0 ? '+' : ''}
                  {dayIntake.differenceKcal}
                </Text>
              </View>
            </View>
            <Text style={styles.coverageNote}>
              {dayIntake.trainingDays} training days vs {dayIntake.restDays} rest days logged.
            </Text>
          </View>
        </CollapsibleSection>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
    </CollapsedSectionsContext.Provider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16 },

  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: colors.textTertiary,
    fontSize: 12,
    marginBottom: 12,
    marginTop: 2,
  },
  sectionSubtitleInline: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  section: { marginBottom: 28 },

  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginBottom: 2,
  },
  collapsibleHeaderText: { flex: 1 },
  chevron: { color: colors.textTertiary, fontSize: 16, marginLeft: 8 },

  // Range selector
  rangeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 28,
  },
  rangeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  rangeBtnActive: {
    backgroundColor: colors.accent + '20',
    borderColor: colors.accent,
  },
  rangeBtnText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  rangeBtnTextActive: {
    color: colors.accent,
  },
  chartScaleRow: {
    marginTop: -18,
    marginBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartScaleLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
  },
  chartScaleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chartScaleBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '14',
  },
  chartScaleBtnText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  chartScaleBtnTextActive: {
    color: colors.accent,
  },

  // Lifetime stats
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
    marginTop: 8,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  statCardHighlight: {
    backgroundColor: colors.accent + '18',
    borderColor: colors.accent + '44',
  },
  statValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statValueHighlight: { color: colors.accent },
  statLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 32,
    alignItems: 'center',
    marginBottom: 28,
  },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    paddingVertical: 12,
    paddingRight: 16,
  },
  chartPlaceholder: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartPlaceholderText: {
    color: colors.textTertiary,
    fontSize: 13,
  },

  // Heatmap
  heatmapScroll: { paddingVertical: 12, paddingHorizontal: 14 },
  heatmapContainer: { flexDirection: 'row', gap: HEATMAP_GAP },
  heatmapDayLabels: { justifyContent: 'space-between' },
  heatmapDayLabel: {
    color: colors.textTertiary,
    fontSize: 7,
    width: 10,
  },
  heatmapWeek: {},
  heatmapCell: {
    borderRadius: 2,
    backgroundColor: colors.surfaceElevated,
  },
  heatmapCellActive: { backgroundColor: colors.accent },
  heatmapCellFuture: { backgroundColor: 'transparent' },
  heatmapLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  heatmapLegendText: { color: colors.textTertiary, fontSize: 11 },

  // Muscle group bars
  muscleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  muscleLabel: { color: colors.textSecondary, fontSize: 13, width: 90, fontWeight: '500' },
  muscleBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4,
    overflow: 'hidden',
  },
  muscleBarFill: { height: '100%', borderRadius: 4 },
  muscleValue: {
    color: colors.textSecondary,
    fontSize: 12,
    width: 40,
    textAlign: 'right',
    fontWeight: '600',
  },

  // Tooltip
  tooltip: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
  },
  tooltipValue: { fontSize: 13, fontWeight: '700' },
  tooltipDate: { color: colors.textTertiary, fontSize: 10 },

  overlayChartLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
    paddingHorizontal: 2,
  },

  // 1RM Trends
  trendBlock: { marginBottom: 16 },
  trendExerciseName: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
    paddingHorizontal: 2,
  },

  // PR rows
  prRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  prRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  prLeft: { flex: 1, marginRight: 12 },
  prExercise: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  prDate: { color: colors.textTertiary, fontSize: 11 },
  prRight: { alignItems: 'flex-end' },
  prWeight: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  pr1rm: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },

  // Fatigue Index
  fatigueRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 16 },
  fatigueValue: { fontSize: 36, fontWeight: '800', minWidth: 72 },
  fatigueRight: { flex: 1 },
  fatigueStatus: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  fatigueZoneHint: { color: colors.textTertiary, fontSize: 11 },

  // Relative Strength
  relRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  relName: { color: colors.text, fontSize: 14, fontWeight: '500', flex: 1, marginRight: 8 },
  relRight: { alignItems: 'flex-end' },
  relRatio: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  relWeight: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },

  // Strength vs Weight Gain
  swRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  swStat: { flex: 1, alignItems: 'center' },
  swLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', marginBottom: 4 },
  swValue: { fontSize: 22, fontWeight: '800' },
  swDivider: { width: 1, backgroundColor: colors.border, marginHorizontal: 4 },
  // ── Nutrition / energy balance ──
  tdeeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  tdeeValue: { color: colors.accent, fontSize: 36, fontWeight: '700', lineHeight: 40 },
  tdeeUnit: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  tdeeConfidence: {
    color: colors.textTertiary,
    fontSize: 11,
    textTransform: 'capitalize',
    marginTop: 6,
  },
  goalLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 8,
  },
  goalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  goalChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  goalChipActive: { borderColor: colors.accent, backgroundColor: colors.accent + '20' },
  goalChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  goalChipTextActive: { color: colors.accent },
  adviceBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.accent + '14',
    borderWidth: 1,
    borderColor: colors.accent + '3A',
  },
  adviceTarget: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  adviceText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  coverageNote: { color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 12 },
  blockedText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
  },
  subtleNote: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },

  swCaption: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
    lineHeight: 17,
  },
});
