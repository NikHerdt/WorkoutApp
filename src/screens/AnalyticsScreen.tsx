import React, { useCallback, useState } from 'react';
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
import {
  getLifetimeStats,
  getWeeklySessionCounts,
  getWeeklyVolumeTotals,
  getMuscleGroupVolume,
  getRecentPRs,
  getRecentBodyWeights,
  getTop1RMs,
} from '../db/database';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 64;

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
  const key = name.toLowerCase();
  return MUSCLE_COLORS[key] ?? colors.accent;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return String(Math.round(v));
}

/**
 * Generates the SQLite %W-compatible week number for a given date.
 * SQLite %W: week starts Monday, week 00 is days before first Monday.
 */
function sqliteWeekNum(date: Date): number {
  const year = date.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const startDay = startOfYear.getDay();
  const daysToFirstMonday = startDay === 0 ? 1 : startDay === 1 ? 0 : 8 - startDay;
  const firstMonday = new Date(year, 0, 1 + daysToFirstMonday);
  if (date < firstMonday) return 0;
  return Math.floor((date.getTime() - firstMonday.getTime()) / 86400000 / 7) + 1;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

interface WeekBucket {
  key: string;
  label: string;
}

function buildWeekBuckets(weeks: number): WeekBucket[] {
  const today = new Date();
  const result: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 7);
    const monday = getMondayOfWeek(d);
    const year = monday.getFullYear();
    const weekNum = sqliteWeekNum(monday);
    const key = `${year}-W${String(weekNum).padStart(2, '0')}`;
    const label = `${monday.getMonth() + 1}/${monday.getDate()}`;
    result.push({ key, label });
  }
  return result;
}

interface LifetimeStats {
  totalSessions: number;
  totalVolume: number;
  currentStreak: number;
  longestStreak: number;
}

function CollapsibleSection({
  title,
  subtitle,
  children,
  defaultExpanded = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.collapsibleHeader}
        onPress={() => setExpanded((v) => !v)}
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

export default function AnalyticsScreen() {
  const [stats, setStats] = useState<LifetimeStats>({
    totalSessions: 0,
    totalVolume: 0,
    currentStreak: 0,
    longestStreak: 0,
  });
  const [weeklyFreq, setWeeklyFreq] = useState<{ value: number; label: string; frontColor: string }[]>([]);
  const [weeklyVol, setWeeklyVol] = useState<{ value: number; label: string; frontColor: string }[]>([]);
  const [muscleVolume, setMuscleVolume] = useState<{ name: string; volume: number; pct: number }[]>([]);
  const [bodyWeight, setBodyWeight] = useState<{ value: number; label: string }[]>([]);
  const [recentPRs, setRecentPRs] = useState<any[]>([]);
  const [top1RMs, setTop1RMs] = useState<any[]>([]);
  const [hasAnyData, setHasAnyData] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const lifetime = getLifetimeStats();
      setStats(lifetime);
      setHasAnyData(lifetime.totalSessions > 0);

      const buckets = buildWeekBuckets(12);
      const freqMap: Record<string, number> = {};
      for (const row of getWeeklySessionCounts(12)) freqMap[row.week] = row.count;
      setWeeklyFreq(
        buckets.map((b) => ({
          value: freqMap[b.key] ?? 0,
          label: b.label,
          frontColor: colors.accent,
        }))
      );

      const volMap: Record<string, number> = {};
      for (const row of getWeeklyVolumeTotals(12)) volMap[row.week] = row.total_volume;
      setWeeklyVol(
        buckets.map((b) => ({
          value: volMap[b.key] ?? 0,
          label: b.label,
          frontColor: colors.blue,
        }))
      );

      const mgRows = getMuscleGroupVolume(30);
      const maxVol = mgRows.length > 0 ? mgRows[0].total_volume : 1;
      setMuscleVolume(
        mgRows.map((r) => ({
          name: r.muscle_group,
          volume: r.total_volume,
          pct: r.total_volume / maxVol,
        }))
      );

      const bwRows = getRecentBodyWeights(30).reverse();
      setBodyWeight(
        bwRows.map((r) => ({
          value: r.weight_lbs,
          label: r.logged_date.slice(5),
        }))
      );

      setRecentPRs(getRecentPRs(10));
      setTop1RMs(getTop1RMs(15));
    }, [])
  );

  const hasWeeklyData = weeklyFreq.some((d) => d.value > 0);
  const hasMuscleData = muscleVolume.length > 0;
  const hasBodyWeight = bodyWeight.length > 0;
  const hasPRs = recentPRs.length > 0;
  const has1RMs = top1RMs.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Lifetime Stats — always visible, not collapsible */}
      <Text style={styles.sectionTitle}>Lifetime</Text>
      <View style={styles.statsGrid}>
        <StatCard label="Sessions" value={String(stats.totalSessions)} />
        <StatCard label={`Volume (${WEIGHT_UNIT})`} value={formatVolume(stats.totalVolume)} />
        <StatCard label="Current Streak" value={`${stats.currentStreak}d`} highlight />
        <StatCard label="Best Streak" value={`${stats.longestStreak}d`} />
      </View>

      {!hasAnyData && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No workout data yet</Text>
          <Text style={styles.emptyText}>
            Complete your first workout to start seeing analytics here.
          </Text>
        </View>
      )}

      {/* Weekly Training Frequency */}
      {hasWeeklyData && (
        <CollapsibleSection
          title="Weekly Frequency"
          subtitle="Sessions per week — last 12 weeks"
        >
          <View style={styles.chartCard}>
            <BarChart
              data={weeklyFreq}
              width={CHART_WIDTH}
              height={160}
              barWidth={Math.max(14, Math.min(28, CHART_WIDTH / 14))}
              roundedTop
              xAxisColor={colors.border}
              yAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
              xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
              rulesColor={colors.border}
              backgroundColor={colors.surface}
              noOfSections={4}
              initialSpacing={12}
              endSpacing={8}
              showFractionalValues={false}
            />
          </View>
        </CollapsibleSection>
      )}

      {/* Weekly Volume Trend */}
      {hasWeeklyData && (
        <CollapsibleSection
          title="Weekly Volume"
          subtitle={`Total ${WEIGHT_UNIT} lifted per week — last 12 weeks`}
        >
          <View style={styles.chartCard}>
            <BarChart
              data={weeklyVol}
              width={CHART_WIDTH}
              height={160}
              barWidth={Math.max(14, Math.min(28, CHART_WIDTH / 14))}
              roundedTop
              xAxisColor={colors.border}
              yAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
              xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
              rulesColor={colors.border}
              backgroundColor={colors.surface}
              noOfSections={4}
              initialSpacing={12}
              endSpacing={8}
              showFractionalValues={false}
              formatYLabel={(v) => formatVolume(Number(v))}
            />
          </View>
        </CollapsibleSection>
      )}

      {/* Volume by Muscle Group */}
      {hasMuscleData && (
        <CollapsibleSection title="Muscle Group Volume" subtitle="Last 30 days">
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
                      {
                        width: `${Math.round(item.pct * 100)}%`,
                        backgroundColor: muscleColor(item.name),
                      },
                    ]}
                  />
                </View>
                <Text style={styles.muscleValue}>{formatVolume(item.volume)}</Text>
              </View>
            ))}
          </View>
        </CollapsibleSection>
      )}

      {/* Body Weight Trend — line chart, no fill */}
      {hasBodyWeight && (
        <CollapsibleSection
          title="Body Weight"
          subtitle={`Last ${bodyWeight.length} entries (${WEIGHT_UNIT})`}
        >
          <View style={styles.chartCard}>
            <LineChart
              data={bodyWeight}
              width={CHART_WIDTH}
              height={160}
              color={colors.orange}
              thickness={2}
              dataPointsColor={colors.orange}
              dataPointsRadius={3}
              curved
              xAxisColor={colors.border}
              yAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
              xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
              rulesColor={colors.border}
              rulesType="dashed"
              backgroundColor={colors.surface}
              noOfSections={4}
              initialSpacing={16}
              endSpacing={16}
              hideDataPoints={bodyWeight.length > 20}
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

      {/* Recent PRs */}
      {hasPRs && (
        <CollapsibleSection
          title="Recent PRs"
          subtitle="Best set per exercise — last 60 days"
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

      {/* Strength Overview — all-time estimated 1RMs via Epley formula */}
      {has1RMs && (
        <CollapsibleSection
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

      <View style={{ height: 40 }} />
    </ScrollView>
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
  section: {
    marginBottom: 28,
  },

  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginBottom: 2,
  },
  collapsibleHeaderText: {
    flex: 1,
  },
  chevron: {
    color: colors.textTertiary,
    fontSize: 16,
    marginLeft: 8,
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 28,
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
  statValueHighlight: {
    color: colors.accent,
  },
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
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

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

  muscleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  muscleLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    width: 90,
    fontWeight: '500',
  },
  muscleBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4,
    overflow: 'hidden',
  },
  muscleBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  muscleValue: {
    color: colors.textSecondary,
    fontSize: 12,
    width: 40,
    textAlign: 'right',
    fontWeight: '600',
  },

  tooltip: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
  },
  tooltipValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  tooltipDate: {
    color: colors.textTertiary,
    fontSize: 10,
  },

  prRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  prRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prLeft: {
    flex: 1,
    marginRight: 12,
  },
  prExercise: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  prDate: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  prRight: {
    alignItems: 'flex-end',
  },
  prWeight: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  pr1rm: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
});
