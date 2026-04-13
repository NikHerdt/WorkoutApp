import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { LineChart, BarChart } from 'react-native-gifted-charts';
import { colors } from '../theme/colors';
import {
  getExerciseVolumeHistory,
  getExerciseWeightHistory,
  getExercisePR,
  getAllExercises,
} from '../db/database';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 64;

export default function ExerciseDetailScreen() {
  const route = useRoute<RouteProp<any, 'ExerciseDetail'>>();
  const { exerciseId, exerciseName } = route.params as { exerciseId: number; exerciseName: string };

  const [weightHistory, setWeightHistory] = useState<any[]>([]);
  const [volumeHistory, setVolumeHistory] = useState<any[]>([]);
  const [pr, setPr] = useState<any>(null);
  const [exerciseDetail, setExerciseDetail] = useState<any>(null);

  useEffect(() => {
    const weightData = getExerciseWeightHistory(exerciseId);
    const volumeData = getExerciseVolumeHistory(exerciseId);
    const prData = getExercisePR(exerciseId);
    const allExs = getAllExercises();
    const detail = allExs.find((e: any) => e.id === exerciseId);

    setWeightHistory(weightData);
    setVolumeHistory(volumeData);
    setPr(prData);
    setExerciseDetail(detail);
  }, [exerciseId]);

  const weightChartData = weightHistory.map((row) => ({
    value: row.max_weight,
    label: row.date.slice(5), // MM-DD
    dataPointText: String(row.max_weight),
  }));

  const volumeChartData = volumeHistory.map((row) => ({
    value: Math.round(row.total_volume),
    label: row.date.slice(5),
    frontColor: colors.blue,
  }));

  const hasData = weightHistory.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {/* PR card */}
      {pr ? (
        <View style={styles.prCard}>
          <Text style={styles.prLabel}>ALL-TIME PR</Text>
          <Text style={styles.prWeight}>{pr.max_weight} kg</Text>
          <Text style={styles.prReps}>× {pr.reps} reps · {pr.date}</Text>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyTitle}>No data yet</Text>
          <Text style={styles.emptyText}>Complete this exercise in a workout to see your progress here.</Text>
        </View>
      )}

      {/* Exercise info */}
      {exerciseDetail && (
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Sets</Text>
            <Text style={styles.infoValue}>
              {exerciseDetail.warmup_sets > 0 ? `${exerciseDetail.warmup_sets}W + ` : ''}{exerciseDetail.working_sets} working
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Rep Target</Text>
            <Text style={styles.infoValue}>{exerciseDetail.target_reps}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>RPE</Text>
            <Text style={styles.infoValue}>{exerciseDetail.target_rpe}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Rest</Text>
            <Text style={styles.infoValue}>
              {exerciseDetail.rest_seconds > 0
                ? `${Math.floor(exerciseDetail.rest_seconds / 60)}:${String(exerciseDetail.rest_seconds % 60).padStart(2, '0')}`
                : 'Superset'}
            </Text>
          </View>
          {exerciseDetail.notes ? (
            <View style={[styles.infoRow, { alignItems: 'flex-start' }]}>
              <Text style={[styles.infoLabel, { paddingTop: 2 }]}>Cue</Text>
              <Text style={[styles.infoValue, styles.notesText]}>{exerciseDetail.notes}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Weight over time */}
      {hasData && (
        <View style={styles.chartSection}>
          <Text style={styles.chartTitle}>Weight Over Time (kg)</Text>
          <View style={styles.chartContainer}>
            <LineChart
              data={weightChartData}
              width={CHART_WIDTH}
              height={180}
              color={colors.accent}
              thickness={2}
              dataPointsColor={colors.accent}
              dataPointsRadius={4}
              startFillColor={colors.accent + '30'}
              endFillColor={colors.accent + '00'}
              areaChart
              curved
              xAxisColor={colors.border}
              yAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textTertiary, fontSize: 10 }}
              xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
              rulesColor={colors.border}
              rulesType="dashed"
              backgroundColor={colors.surface}
              noOfSections={4}
              showVerticalLines={false}
              hideDataPoints={weightChartData.length > 15}
              initialSpacing={16}
              endSpacing={16}
              pointerConfig={{
                pointerStripColor: colors.accent,
                pointerStripWidth: 1,
                pointerColor: colors.accent,
                radius: 5,
                pointerLabelWidth: 80,
                pointerLabelHeight: 40,
                activatePointersDelay: 300,
                autoAdjustPointerLabelPosition: true,
                pointerLabelComponent: (items: any[]) => (
                  <View style={styles.tooltip}>
                    <Text style={styles.tooltipText}>{items[0]?.value} kg</Text>
                    <Text style={styles.tooltipDate}>{items[0]?.label}</Text>
                  </View>
                ),
              }}
            />
          </View>
        </View>
      )}

      {/* Volume over time */}
      {volumeChartData.length > 0 && (
        <View style={styles.chartSection}>
          <Text style={styles.chartTitle}>Volume Over Time (kg)</Text>
          <View style={styles.chartContainer}>
            <BarChart
              data={volumeChartData}
              width={CHART_WIDTH}
              height={180}
              barWidth={Math.max(16, Math.min(32, CHART_WIDTH / (volumeChartData.length + 2)))}
              roundedTop
              xAxisColor={colors.border}
              yAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textTertiary, fontSize: 10 }}
              xAxisLabelTextStyle={{ color: colors.textTertiary, fontSize: 9 }}
              rulesColor={colors.border}
              backgroundColor={colors.surface}
              noOfSections={4}
              initialSpacing={16}
              endSpacing={8}
              showFractionalValues={false}
              hideRules={false}
              topLabelTextStyle={{ color: colors.textTertiary, fontSize: 8 }}
            />
          </View>
        </View>
      )}

      {/* Recent sets table */}
      {hasData && (
        <View style={styles.section}>
          <Text style={styles.chartTitle}>Recent Sessions</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableHeaderText, { flex: 1.2 }]}>DATE</Text>
            <Text style={[styles.tableCell, styles.tableHeaderText]}>MAX KG</Text>
            <Text style={[styles.tableCell, styles.tableHeaderText]}>VOLUME</Text>
          </View>
          {volumeHistory.slice(-8).reverse().map((row, idx) => (
            <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
              <Text style={[styles.tableCell, { flex: 1.2, color: colors.textSecondary }]}>{row.date}</Text>
              <Text style={[styles.tableCell, { color: colors.text, fontWeight: '600' }]}>
                {weightHistory.find((w) => w.date === row.date)?.max_weight ?? '—'} kg
              </Text>
              <Text style={[styles.tableCell, { color: colors.accent }]}>
                {Math.round(row.total_volume)} kg
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16 },

  prCard: {
    backgroundColor: colors.accent + '18',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent + '44',
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  prLabel: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
  prWeight: { color: colors.accent, fontSize: 40, fontWeight: '700' },
  prReps: { color: colors.textSecondary, fontSize: 14, marginTop: 4 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { color: colors.textTertiary, fontSize: 13, width: 80 },
  infoValue: { color: colors.text, fontSize: 13, fontWeight: '500', flex: 1, textAlign: 'right' },
  notesText: { textAlign: 'left', color: colors.textSecondary, lineHeight: 18 },

  chartSection: { marginBottom: 16 },
  section: { marginBottom: 16 },
  chartTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  chartContainer: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    paddingVertical: 12,
    paddingRight: 16,
  },

  tooltip: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.accent + '44',
  },
  tooltipText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  tooltipDate: { color: colors.textTertiary, fontSize: 10 },

  tableHeader: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  tableRowAlt: { backgroundColor: colors.surface },
  tableCell: { flex: 1, fontSize: 13 },
  tableHeaderText: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
