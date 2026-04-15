import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LineChart, BarChart } from 'react-native-gifted-charts';
import { colors } from '../theme/colors';
import {
  getExerciseVolumeHistory,
  getExerciseWeightHistory,
  getExercisePR,
  getEstimated1RMHistory,
  getAllExercises,
  getExerciseById,
  findExerciseIdByProgramName,
  getPhaseSubstitutionsForPhase,
  getOrCreateSubstitutionExercise,
} from '../db/database';
import { getProgramSubstitutions } from '../data/exerciseProgramSubstitutions';
import { useWorkoutStore } from '../store/useWorkoutStore';
import type { ExerciseDetailParams } from '../navigation/AppNavigator';
import { WEIGHT_UNIT, WEIGHT_UNIT_HEADER } from '../constants/weightUnits';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 64;

function toFiniteExerciseId(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : -1;
}

/** When several program slots map to the same replacement, pick the template whose subs list includes it. */
function disambiguateSubstitutionTemplates(
  templateIds: number[],
  replacementExerciseId: number
): number {
  if (templateIds.length === 1) return templateIds[0];
  const explained = templateIds.filter((tid) => {
    const tname = getExerciseById(tid)?.name;
    if (!tname) return false;
    const subs = getProgramSubstitutions(tname);
    if (!subs) return false;
    const o1 = subs.option1 ? findExerciseIdByProgramName(subs.option1) : null;
    const o2 = subs.option2 ? findExerciseIdByProgramName(subs.option2) : null;
    return o1 === replacementExerciseId || o2 === replacementExerciseId;
  });
  if (explained.length === 1) return explained[0];
  if (explained.length > 1) return Math.min(...explained);
  return Math.min(...templateIds);
}

export default function ExerciseDetailScreen() {
  const route = useRoute<RouteProp<{ ExerciseDetail: ExerciseDetailParams }, 'ExerciseDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const p = route.params;
  const exerciseId = toFiniteExerciseId(p.exerciseId);
  const exerciseName = p.exerciseName;
  let programSlotTemplateExerciseId: number | undefined;
  if (p.programSlotTemplateExerciseId != null) {
    const slot = toFiniteExerciseId(p.programSlotTemplateExerciseId);
    programSlotTemplateExerciseId = slot >= 0 ? slot : undefined;
  }

  const activeSessionId = useWorkoutStore((s) => s.activeSessionId);
  const activeExercises = useWorkoutStore((s) => s.activeExercises);
  const currentPhaseId = useWorkoutStore((s) => s.currentPhaseId);
  const pendingSubstitutions = useWorkoutStore((s) => s.pendingSubstitutions);
  const setPendingSubstitution = useWorkoutStore((s) => s.setPendingSubstitution);
  const replaceActiveExercise = useWorkoutStore((s) => s.replaceActiveExercise);

  useFocusEffect(
    useCallback(() => {
      useWorkoutStore.getState().loadSettings();
    }, [])
  );

  const phaseSubstitutionMap = useMemo(() => {
    const fromDb = getPhaseSubstitutionsForPhase(currentPhaseId);
    return { ...fromDb, ...pendingSubstitutions };
  }, [currentPhaseId, pendingSubstitutions]);

  const activeRowForExercise = useMemo(
    () => activeExercises.find((e) => e.exerciseId === exerciseId),
    [activeExercises, exerciseId]
  );

  const resolvedSlotTemplateExerciseId = useMemo(() => {
    if (programSlotTemplateExerciseId != null && programSlotTemplateExerciseId !== exerciseId) {
      return programSlotTemplateExerciseId;
    }
    const fromSession = activeRowForExercise?.slotTemplateExerciseId;
    if (fromSession != null && fromSession !== exerciseId) {
      return fromSession;
    }
    const reverseMatches: number[] = [];
    for (const [tid, rid] of Object.entries(phaseSubstitutionMap)) {
      if (Number(rid) === Number(exerciseId)) {
        const t = parseInt(tid, 10);
        if (!Number.isNaN(t)) reverseMatches.push(t);
      }
    }
    if (reverseMatches.length > 0) {
      return disambiguateSubstitutionTemplates(reverseMatches, exerciseId);
    }
    return programSlotTemplateExerciseId ?? exerciseId;
  }, [
    programSlotTemplateExerciseId,
    exerciseId,
    phaseSubstitutionMap,
    activeRowForExercise?.slotTemplateExerciseId,
  ]);

  const [weightHistory, setWeightHistory] = useState<any[]>([]);
  const [volumeHistory, setVolumeHistory] = useState<any[]>([]);
  const [estimated1RMHistory, setEstimated1RMHistory] = useState<any[]>([]);
  const [pr, setPr] = useState<any>(null);
  const [exerciseDetail, setExerciseDetail] = useState<any>(null);

  useEffect(() => {
    const weightData = getExerciseWeightHistory(exerciseId);
    const volumeData = getExerciseVolumeHistory(exerciseId);
    const prData = getExercisePR(exerciseId);
    const e1rmData = getEstimated1RMHistory(exerciseId);
    const allExs = getAllExercises();
    const detail = allExs.find((e: any) => e.id === exerciseId);

    setWeightHistory(weightData);
    setVolumeHistory(volumeData);
    setEstimated1RMHistory(e1rmData);
    setPr(prData);
    setExerciseDetail(detail);
  }, [exerciseId]);

  const templateExerciseNameForSubs = useMemo(() => {
    return (
      getExerciseById(resolvedSlotTemplateExerciseId)?.name ?? exerciseDetail?.name ?? exerciseName
    );
  }, [resolvedSlotTemplateExerciseId, exerciseDetail?.name, exerciseName]);

  const programSubs = useMemo(
    () => getProgramSubstitutions(templateExerciseNameForSubs),
    [templateExerciseNameForSubs]
  );

  const programSubOptionIds = useMemo(() => {
    if (!programSubs) return { o1: null as number | null, o2: null as number | null };
    return {
      o1: programSubs.option1 ? findExerciseIdByProgramName(programSubs.option1) : null,
      o2: programSubs.option2 ? findExerciseIdByProgramName(programSubs.option2) : null,
    };
  }, [programSubs]);

  /**
   * When the user has already applied a substitution and is now viewing the replacement exercise,
   * swap out the option that matches the current exercise and replace it with the template
   * exercise name so they can revert or pick a different option.
   */
  const effectiveProgramSubs = useMemo(() => {
    if (!programSubs) return null;
    const isSubstituted = resolvedSlotTemplateExerciseId !== exerciseId;
    if (!isSubstituted) return programSubs;
    const templateName = getExerciseById(resolvedSlotTemplateExerciseId)?.name;
    if (!templateName) return programSubs;
    let option1 = programSubs.option1;
    let option2 = programSubs.option2;
    if (option1 && programSubOptionIds.o1 === exerciseId) {
      option1 = templateName;
    }
    if (option2 && programSubOptionIds.o2 === exerciseId) {
      option2 = templateName;
    }
    return { option1, option2 };
  }, [programSubs, resolvedSlotTemplateExerciseId, exerciseId, programSubOptionIds]);

  const effectiveProgramSubOptionIds = useMemo(() => {
    if (!effectiveProgramSubs) return { o1: null as number | null, o2: null as number | null };
    return {
      o1: effectiveProgramSubs.option1 ? findExerciseIdByProgramName(effectiveProgramSubs.option1) : null,
      o2: effectiveProgramSubs.option2 ? findExerciseIdByProgramName(effectiveProgramSubs.option2) : null,
    };
  }, [effectiveProgramSubs]);

  function applyProgramSubstitution(optionLabel: string) {
    const replacementId = getOrCreateSubstitutionExercise(
      optionLabel,
      resolvedSlotTemplateExerciseId
    );
    if (replacementId === exerciseId) {
      return;
    }

    if (activeSessionId) {
      const idx = activeExercises.findIndex((e) => e.exerciseId === exerciseId);
      if (idx < 0) {
        Alert.alert(
          'Not in current workout',
          'Open this exercise from the workout screen to swap it during an active session.'
        );
        return;
      }
      const hadCompleted = activeExercises[idx].sets.some((s) => s.completed);
      const run = () => {
        replaceActiveExercise(idx, replacementId);
        navigation.goBack();
      };
      if (hadCompleted) {
        Alert.alert('Replace exercise?', 'Completed sets for this exercise will be cleared.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: run },
        ]);
      } else {
        run();
      }
    } else {
      setPendingSubstitution(resolvedSlotTemplateExerciseId, replacementId);
      navigation.goBack();
    }
  }

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

  const e1rmChartData = estimated1RMHistory.map((row) => ({
    value: row.estimated_1rm,
    label: row.date.slice(5),
    dataPointText: String(row.estimated_1rm),
  }));

  const hasData = weightHistory.length > 0;

  if (exerciseId < 0) {
    return (
      <View style={[styles.container, { justifyContent: 'center', padding: 24 }]}>
        <Text style={{ color: colors.text }}>Invalid exercise.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {/* PR card */}
      {pr ? (
        <View style={styles.prCard}>
          <Text style={styles.prLabel}>ALL-TIME PR</Text>
          <Text style={styles.prWeight}>{pr.max_weight} {WEIGHT_UNIT}</Text>
          <Text style={styles.prReps}>× {pr.reps} reps · {pr.date}</Text>
        </View>
      ) : (
        <View style={styles.emptyCard}>
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
          {effectiveProgramSubs ? (
            <View style={styles.substitutionBlock}>
              <Text style={styles.substitutionHeading}>Program substitutions</Text>
              <Text style={styles.substitutionSource}>
                From Jeff Nippard Ultimate PPL 5x spreadsheet (Substitution Option 1 / Option 2).
              </Text>
              {!(effectiveProgramSubs.option1 || effectiveProgramSubs.option2) ? (
                <Text style={styles.substitutionNone}>
                  No equipment substitutes listed for this movement (e.g. prescribed stretch).
                </Text>
              ) : (
                <>
                  {effectiveProgramSubs.option1 ? (
                    <View style={styles.substitutionOptionRow}>
                      <View style={styles.substitutionOptionText}>
                        <Text style={styles.substitutionOptionLabel}>Option 1</Text>
                        <Text style={styles.notesText}>{effectiveProgramSubs.option1}</Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.useSubButton,
                          effectiveProgramSubOptionIds.o1 === exerciseId &&
                            styles.useSubButtonDisabled,
                        ]}
                        disabled={effectiveProgramSubOptionIds.o1 === exerciseId}
                        onPress={() => applyProgramSubstitution(effectiveProgramSubs.option1!)}
                      >
                        <Text style={styles.useSubButtonText}>Use</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  {effectiveProgramSubs.option2 ? (
                    <View style={styles.substitutionOptionRow}>
                      <View style={styles.substitutionOptionText}>
                        <Text style={styles.substitutionOptionLabel}>Option 2</Text>
                        <Text style={styles.notesText}>{effectiveProgramSubs.option2}</Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.useSubButton,
                          effectiveProgramSubOptionIds.o2 === exerciseId &&
                            styles.useSubButtonDisabled,
                        ]}
                        disabled={effectiveProgramSubOptionIds.o2 === exerciseId}
                        onPress={() => applyProgramSubstitution(effectiveProgramSubs.option2!)}
                      >
                        <Text style={styles.useSubButtonText}>Use</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          ) : null}
        </View>
      )}

      {/* Weight over time */}
      {hasData && (
        <View style={styles.chartSection}>
          <Text style={styles.chartTitle}>Weight Over Time ({WEIGHT_UNIT})</Text>
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
                    <Text style={styles.tooltipText}>{items[0]?.value} {WEIGHT_UNIT}</Text>
                    <Text style={styles.tooltipDate}>{items[0]?.label}</Text>
                  </View>
                ),
              }}
            />
          </View>
        </View>
      )}

      {/* Estimated 1RM over time */}
      {e1rmChartData.length > 0 && (
        <View style={styles.chartSection}>
          <Text style={styles.chartTitle}>Estimated 1RM ({WEIGHT_UNIT})</Text>
          <Text style={styles.chartSubtitle}>Epley formula: weight × (1 + reps / 30)</Text>
          <View style={styles.chartContainer}>
            <LineChart
              data={e1rmChartData}
              width={CHART_WIDTH}
              height={180}
              color={'#A78BFA'}
              thickness={2}
              dataPointsColor={'#A78BFA'}
              dataPointsRadius={4}
              startFillColor={'#A78BFA30'}
              endFillColor={'#A78BFA00'}
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
              hideDataPoints={e1rmChartData.length > 15}
              initialSpacing={16}
              endSpacing={16}
              pointerConfig={{
                pointerStripColor: '#A78BFA',
                pointerStripWidth: 1,
                pointerColor: '#A78BFA',
                radius: 5,
                pointerLabelWidth: 80,
                pointerLabelHeight: 40,
                activatePointersDelay: 300,
                autoAdjustPointerLabelPosition: true,
                pointerLabelComponent: (items: any[]) => (
                  <View style={[styles.tooltip, { borderColor: '#A78BFA44' }]}>
                    <Text style={[styles.tooltipText, { color: '#A78BFA' }]}>
                      {items[0]?.value} {WEIGHT_UNIT}
                    </Text>
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
          <Text style={styles.chartTitle}>Volume Over Time ({WEIGHT_UNIT})</Text>
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
            <Text style={[styles.tableCell, styles.tableHeaderText]}>MAX {WEIGHT_UNIT_HEADER}</Text>
            <Text style={[styles.tableCell, styles.tableHeaderText]}>VOLUME</Text>
          </View>
          {volumeHistory.slice(-8).reverse().map((row, idx) => (
            <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
              <Text style={[styles.tableCell, { flex: 1.2, color: colors.textSecondary }]}>{row.date}</Text>
              <Text style={[styles.tableCell, { color: colors.text, fontWeight: '600' }]}>
                {weightHistory.find((w) => w.date === row.date)?.max_weight ?? '—'} {WEIGHT_UNIT}
              </Text>
              <Text style={[styles.tableCell, { color: colors.accent }]}>
                {Math.round(row.total_volume)} {WEIGHT_UNIT}
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

  substitutionBlock: {
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  substitutionHeading: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  substitutionSource: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 4,
  },
  substitutionNone: {
    color: colors.textTertiary,
    fontSize: 13,
    lineHeight: 18,
  },
  substitutionOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  substitutionOptionText: { flex: 1, minWidth: 0 },
  substitutionOptionLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  useSubButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  useSubButtonDisabled: {
    opacity: 0.35,
  },
  useSubButtonText: { color: '#000', fontSize: 13, fontWeight: '700' },

  chartSection: { marginBottom: 16 },
  section: { marginBottom: 16 },
  chartTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  chartSubtitle: {
    color: colors.textTertiary,
    fontSize: 11,
    marginBottom: 8,
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
