import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Switch,
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
  getExerciseTracksBrand,
  setExerciseTracksBrand,
  getExerciseLoggedBrands,
  getExerciseSelectedBrand,
  getExerciseAggregateStats,
  updateExercise,
} from '../db/database';
import { getProgramSubstitutions } from '../data/exerciseProgramSubstitutions';
import { useWorkoutStore } from '../store/useWorkoutStore';
import type { ExerciseDetailParams } from '../navigation/AppNavigator';
import { WEIGHT_UNIT, WEIGHT_UNIT_HEADER } from '../constants/weightUnits';
import { AppConfirmModal, AppNoticeModal } from '../components/AppModalDialogs';
import ExerciseEditModal from '../components/ExerciseEditModal';

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
  const [tracksBrand, setTracksBrandState] = useState(false);
  const [brandSilos, setBrandSilos] = useState<{ label: string; value: string | null }[]>([]);
  /** Which machine's data the charts show. undefined = aggregate ("All machines"). */
  const [statsBrand, setStatsBrand] = useState<string | null | undefined>(undefined);
  const [aggStats, setAggStats] = useState<{
    sessions: number;
    total_reps: number;
    total_volume: number;
    best_e1rm: number;
  } | null>(null);
  const [inactiveExerciseNoticeOpen, setInactiveExerciseNoticeOpen] = useState(false);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [replacePendingId, setReplacePendingId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const reloadDetail = useCallback(() => {
    const found = getAllExercises().find((e: any) => e.id === exerciseId);
    setExerciseDetail(found);
    return found;
  }, [exerciseId]);

  // Exercise metadata + which machine silos have data (drives the brand selector).
  useEffect(() => {
    const detail = reloadDetail();

    const tracks = getExerciseTracksBrand(exerciseId, detail?.name);
    setTracksBrandState(tracks);
    setAggStats(getExerciseAggregateStats(exerciseId));

    if (!tracks) {
      setBrandSilos([]);
      setStatsBrand(undefined);
      return;
    }
    const { brands, hasNoBrand } = getExerciseLoggedBrands(exerciseId);
    const silos: { label: string; value: string | null }[] = [
      ...brands.map((b) => ({ label: b, value: b as string | null })),
      ...(hasNoBrand ? [{ label: 'No brand', value: null as string | null }] : []),
    ];
    setBrandSilos(silos);
    const values = silos.map((s) => s.value);
    const selected = getExerciseSelectedBrand(exerciseId);
    setStatsBrand(
      values.length === 0 ? undefined : values.includes(selected) ? selected : values[0]
    );
  }, [exerciseId]);

  // Chart/PR data, siloed to the selected machine for brand-tracked exercises.
  useEffect(() => {
    setWeightHistory(getExerciseWeightHistory(exerciseId, statsBrand));
    setVolumeHistory(getExerciseVolumeHistory(exerciseId, statsBrand));
    setPr(getExercisePR(exerciseId, statsBrand));
    setEstimated1RMHistory(getEstimated1RMHistory(exerciseId, statsBrand));
  }, [exerciseId, statsBrand]);

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
        setInactiveExerciseNoticeOpen(true);
        return;
      }
      const hadCompleted = activeExercises[idx].sets.some((s) => s.completed);
      const run = () => {
        replaceActiveExercise(idx, replacementId);
        navigation.goBack();
      };
      if (hadCompleted) {
        setReplacePendingId(replacementId);
        setReplaceConfirmOpen(true);
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

      {/* Machine brand tracking */}
      <View style={styles.brandToggleCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brandToggleTitle}>Track machine brand</Text>
          <Text style={styles.brandToggleHint}>
            {tracksBrand
              ? 'During workouts you can pick a manufacturer; weights are saved separately per brand.'
              : 'Turn on for machines/cables to log and prefill weights per manufacturer.'}
          </Text>
        </View>
        <Switch
          value={tracksBrand}
          onValueChange={(v) => {
            setExerciseTracksBrand(exerciseId, v);
            setTracksBrandState(v);
            // Apply to an in-progress workout so the chip appears without restarting it.
            useWorkoutStore.getState().refreshBrandTrackingForSession();
            // Re-derive silos/selector for the new mode.
            if (v) {
              const { brands, hasNoBrand } = getExerciseLoggedBrands(exerciseId);
              const silos: { label: string; value: string | null }[] = [
                ...brands.map((b) => ({ label: b, value: b as string | null })),
                ...(hasNoBrand ? [{ label: 'No brand', value: null as string | null }] : []),
              ];
              setBrandSilos(silos);
              const values = silos.map((s) => s.value);
              const selected = getExerciseSelectedBrand(exerciseId);
              setStatsBrand(
                values.length === 0 ? undefined : values.includes(selected) ? selected : values[0]
              );
            } else {
              setBrandSilos([]);
              setStatsBrand(undefined);
            }
          }}
          trackColor={{ false: colors.border, true: colors.accent + '88' }}
          thumbColor={tracksBrand ? colors.accent : colors.textTertiary}
        />
      </View>

      {/* Whole-history rollup across every machine */}
      {tracksBrand && aggStats && aggStats.sessions > 0 ? (
        <View style={styles.aggCard}>
          <Text style={styles.aggTitle}>ACROSS ALL MACHINES</Text>
          <View style={styles.aggGrid}>
            <View style={styles.aggItem}>
              <Text style={styles.aggValue}>{aggStats.sessions}</Text>
              <Text style={styles.aggLabel}>Sessions</Text>
            </View>
            <View style={styles.aggItem}>
              <Text style={styles.aggValue}>{aggStats.total_reps.toLocaleString()}</Text>
              <Text style={styles.aggLabel}>Total reps</Text>
            </View>
            <View style={styles.aggItem}>
              <Text style={styles.aggValue}>{aggStats.total_volume.toLocaleString()}</Text>
              <Text style={styles.aggLabel}>Volume ({WEIGHT_UNIT})</Text>
            </View>
            <View style={styles.aggItem}>
              <Text style={styles.aggValue}>{aggStats.best_e1rm || '—'}</Text>
              <Text style={styles.aggLabel}>Best est. 1RM</Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* Per-machine stats selector */}
      {tracksBrand && brandSilos.length > 0 ? (
        <View style={styles.brandStatsCard}>
          <Text style={styles.brandStatsLabel}>PROGRESS CHARTS</Text>
          <View style={styles.brandStatsChips}>
            <TouchableOpacity
              style={[styles.brandStatsChip, statsBrand === undefined && styles.brandStatsChipActive]}
              onPress={() => setStatsBrand(undefined)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.brandStatsChipText,
                  statsBrand === undefined && styles.brandStatsChipTextActive,
                ]}
              >
                All machines
              </Text>
            </TouchableOpacity>
            {brandSilos.map((s) => {
              const active = statsBrand === s.value;
              return (
                <TouchableOpacity
                  key={s.label}
                  style={[styles.brandStatsChip, active && styles.brandStatsChipActive]}
                  onPress={() => setStatsBrand(s.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.brandStatsChipText, active && styles.brandStatsChipTextActive]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.brandStatsHint}>
            {statsBrand === undefined
              ? "Combined across every machine — good for volume and rep trends, but raw weights aren't directly comparable between machines."
              : 'Charts and PR below are for this machine only, so different machines don’t mix.'}
          </Text>
        </View>
      ) : null}

      {/* Exercise info */}
      {exerciseDetail && (
        <View style={styles.infoCard}>
          <View style={styles.infoHeaderRow}>
            <Text style={styles.infoHeaderTitle}>Programming</Text>
            <TouchableOpacity onPress={() => setEditOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.infoEditBtn}>Edit</Text>
            </TouchableOpacity>
          </View>
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
          <View style={styles.oneRMStatRow}>
            <View>
              <Text style={styles.oneRMStatLabel}>MOST RECENT</Text>
              <Text style={styles.oneRMStatValue}>
                {e1rmChartData[e1rmChartData.length - 1].value} {WEIGHT_UNIT}
              </Text>
              <Text style={styles.oneRMStatDate}>
                {e1rmChartData[e1rmChartData.length - 1].label}
              </Text>
            </View>
            <Text style={styles.oneRMFormula}>weight × (1 + reps / 30)</Text>
          </View>
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

      <ExerciseEditModal
        visible={editOpen}
        usageCount={Number(exerciseDetail?.usage_count ?? 0)}
        initial={
          exerciseDetail
            ? {
                name: String(exerciseDetail.name ?? ''),
                muscleGroup: String(exerciseDetail.muscle_group ?? ''),
                warmupSets: Number(exerciseDetail.warmup_sets ?? 0),
                workingSets: Number(exerciseDetail.working_sets ?? 1),
                targetReps: String(exerciseDetail.target_reps ?? ''),
                targetRpe: String(exerciseDetail.target_rpe ?? ''),
                restSeconds: Number(exerciseDetail.rest_seconds ?? 90),
                notes: String(exerciseDetail.notes ?? ''),
              }
            : null
        }
        onCancel={() => setEditOpen(false)}
        onSave={(fields) => {
          updateExercise(exerciseId, fields);
          setEditOpen(false);
          reloadDetail();
        }}
      />

      <AppNoticeModal
        visible={inactiveExerciseNoticeOpen}
        title="Not in current workout"
        message="Open this exercise from the workout screen to swap it during an active session."
        onClose={() => setInactiveExerciseNoticeOpen(false)}
      />

      <AppConfirmModal
        visible={replaceConfirmOpen}
        title="Replace exercise?"
        message="Completed sets for this exercise will be cleared."
        cancelText="Cancel"
        confirmText="Replace"
        confirmVariant="danger"
        onCancel={() => {
          setReplaceConfirmOpen(false);
          setReplacePendingId(null);
        }}
        onConfirm={() => {
          const replacementId = replacePendingId;
          const idx = activeExercises.findIndex((e) => e.exerciseId === exerciseId);
          if (replacementId == null || idx < 0) {
            setReplaceConfirmOpen(false);
            setReplacePendingId(null);
            return;
          }
          replaceActiveExercise(idx, replacementId);
          setReplaceConfirmOpen(false);
          setReplacePendingId(null);
          navigation.goBack();
        }}
      />
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

  brandToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  infoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  infoHeaderTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  infoEditBtn: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  brandToggleTitle: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 3 },
  brandToggleHint: { color: colors.textTertiary, fontSize: 12, lineHeight: 16 },

  brandStatsCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
  },
  brandStatsLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  brandStatsChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  brandStatsChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.surfaceElevated,
  },
  brandStatsChipActive: { backgroundColor: colors.accent + '22', borderColor: colors.accent + '77' },
  brandStatsChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  brandStatsChipTextActive: { color: colors.accent },
  brandStatsHint: { color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 10 },

  aggCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
  },
  aggTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
  },
  aggGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  aggItem: { width: '50%', marginBottom: 10 },
  aggValue: { color: colors.text, fontSize: 20, fontWeight: '700' },
  aggLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

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

  oneRMStatRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    backgroundColor: '#A78BFA18',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A78BFA44',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  oneRMStatLabel: {
    color: '#A78BFA',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  oneRMStatValue: {
    color: '#A78BFA',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 36,
  },
  oneRMStatDate: {
    color: '#A78BFA99',
    fontSize: 12,
    marginTop: 2,
  },
  oneRMFormula: {
    color: colors.textTertiary,
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'right',
    maxWidth: 140,
  },

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
