import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { HomeStackParamList } from '../navigation/AppNavigator';
import {
  getAllPhases,
  getWorkoutByPhaseAndType,
  getExercisesByWorkout,
  getExerciseById,
} from '../db/database';
import ExerciseSubstituteModal from '../components/ExerciseSubstituteModal';
import { SCHEDULE, DAY_LABELS, DayType } from '../types';

type Nav = NativeStackNavigationProp<HomeStackParamList, 'Home'>;

const MAX_SCHEDULE_WEEK_OFFSET = 52;

function weekCalendarLabel(weekOffset: number): string {
  const now = new Date();
  const dow = now.getDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${monday.toLocaleDateString(undefined, opts)} – ${sunday.toLocaleDateString(undefined, opts)}`;
}

const DAY_COLORS: Record<DayType, string> = {
  push: '#FF6B35',
  pull: '#4A9EFF',
  legs: '#E8F05C',
  upper: '#A78BFA',
  lower: '#34D399',
  rest: '#555555',
};

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const pendingSubstitutions = useWorkoutStore((s) => s.pendingSubstitutions);
  const setPendingSubstitution = useWorkoutStore((s) => s.setPendingSubstitution);
  const {
    scheduleDay,
    currentPhaseId,
    getCurrentDayType,
    skipRestDay,
    setPhase,
    setScheduleDay,
    loadSettings,
    activeSessionId,
    abortWorkout,
  } = useWorkoutStore();
  const [phases, setPhases] = useState<any[]>([]);
  const [todaysExercises, setTodaysExercises] = useState<any[]>([]);
  const [showPhaseSelect, setShowPhaseSelect] = useState(false);
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);
  const [schedulePreviewDayIndex, setSchedulePreviewDayIndex] = useState<number | null>(null);
  const [swapTemplateId, setSwapTemplateId] = useState<number | null>(null);
  const [scheduleDayModal, setScheduleDayModal] = useState(false);

  useEffect(() => {
    loadSettings();
    setPhases(getAllPhases());
  }, []);

  useEffect(() => {
    const dayType = getCurrentDayType();
    if (dayType !== 'rest') {
      const workout = getWorkoutByPhaseAndType(currentPhaseId, dayType);
      if (workout) {
        setTodaysExercises(getExercisesByWorkout(workout.id));
      }
    } else {
      setTodaysExercises([]);
    }
  }, [scheduleDay, currentPhaseId]);

  useEffect(() => {
    setSchedulePreviewDayIndex(null);
  }, [currentPhaseId, scheduleWeekOffset]);

  const previewDayType: DayType | null =
    schedulePreviewDayIndex !== null ? SCHEDULE[schedulePreviewDayIndex] : null;

  const previewExercises = useMemo(() => {
    if (previewDayType === null || previewDayType === 'rest') return [];
    const workout = getWorkoutByPhaseAndType(currentPhaseId, previewDayType);
    return workout ? getExercisesByWorkout(workout.id) : [];
  }, [previewDayType, currentPhaseId]);

  const dayType = getCurrentDayType();
  const isRest = dayType === 'rest';
  const currentPhase = phases.find((p) => p.id === currentPhaseId);
  const accentColor = DAY_COLORS[dayType];

  function handleStartWorkout() {
    navigation.navigate('Workout');
  }

  function handleDiscardWorkout() {
    Alert.alert(
      'Discard workout?',
      'This removes your in-progress session. Sets you logged this session are not saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => abortWorkout(),
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Phase selector */}
        <TouchableOpacity
          style={styles.phaseChip}
          onPress={() => setShowPhaseSelect(!showPhaseSelect)}
        >
          <Text style={styles.phaseChipText}>
            {currentPhase?.name ?? 'Phase 1'} · {currentPhase?.description?.split('(')[1]?.replace(')', '') ?? ''}
          </Text>
          <Text style={styles.chevron}>{showPhaseSelect ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showPhaseSelect && (
          <View style={styles.phaseDropdown}>
            {phases.map((phase) => (
              <TouchableOpacity
                key={phase.id}
                style={[styles.phaseOption, phase.id === currentPhaseId && styles.phaseOptionActive]}
                onPress={() => {
                  setPhase(phase.id);
                  setShowPhaseSelect(false);
                }}
              >
                <Text style={[styles.phaseOptionText, phase.id === currentPhaseId && styles.phaseOptionTextActive]}>
                  {phase.name}
                </Text>
                <Text style={styles.phaseOptionDesc}>{phase.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Today's card */}
        <View style={[styles.todayCard, { borderLeftColor: accentColor }]}>
          <View style={styles.todayHeader}>
            <View>
              <Text style={styles.todayLabel}>TODAY</Text>
              <Text style={[styles.dayType, { color: accentColor }]}>
                {DAY_LABELS[dayType]}
                {!isRest ? ' Day' : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.dayBadge, { backgroundColor: accentColor + '22', borderColor: accentColor + '44' }]}
              onPress={() => {
                if (activeSessionId) {
                  Alert.alert(
                    'Workout in progress',
                    'Finish or discard your workout before changing the program day.'
                  );
                  return;
                }
                setScheduleDayModal(true);
              }}
              activeOpacity={0.75}
            >
              <Text style={[styles.dayBadgeText, { color: accentColor }]}>
                Day {(scheduleDay % 7) + 1}/7
              </Text>
              <Text style={[styles.dayBadgeHint, { color: accentColor }]}>Tap to change</Text>
            </TouchableOpacity>
          </View>

          {isRest ? (
            <View style={styles.restContent}>
              <Text style={styles.restText}>Rest and recover.</Text>
              <TouchableOpacity style={styles.skipButton} onPress={skipRestDay}>
                <Text style={styles.skipButtonText}>Skip to next day</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.exerciseCount}>
                {todaysExercises.length} exercises
              </Text>
              <View style={styles.workoutActionsRow}>
                <TouchableOpacity
                  style={[styles.startButton, styles.startButtonFlex, { backgroundColor: accentColor }]}
                  onPress={handleStartWorkout}
                >
                  <Text style={styles.startButtonText}>
                    {activeSessionId ? 'Resume workout' : 'Start workout'}
                  </Text>
                </TouchableOpacity>
                {activeSessionId ? (
                  <TouchableOpacity style={styles.discardButton} onPress={handleDiscardWorkout}>
                    <Text style={styles.discardButtonText}>Discard</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          )}
        </View>

        {/* Exercise preview */}
        {!isRest && todaysExercises.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today's exercises</Text>
            <Text style={styles.sectionHint}>
              Swap applies for the whole current phase (every week and day that uses this slot). To revert, swap
              again and choose the original exercise. In-workout Swap only affects the current session.
            </Text>
            {todaysExercises.map((ex, index) => {
              const subId = pendingSubstitutions[ex.id];
              const sub = subId ? getExerciseById(subId) : null;
              const display = sub ?? ex;
              const detailId = sub?.id ?? ex.id;
              const detailName = sub?.name ?? ex.name;
              return (
                <View key={ex.id} style={styles.exercisePreview}>
                  <TouchableOpacity
                    style={styles.exercisePreviewMain}
                    onPress={() =>
                      navigation.navigate('ExerciseDetail', {
                        exerciseId: detailId,
                        exerciseName: detailName,
                        programSlotTemplateExerciseId: ex.id,
                      })
                    }
                    activeOpacity={0.7}
                  >
                    <View style={styles.exercisePreviewLeft}>
                      <Text style={styles.exerciseNumber}>{index + 1}</Text>
                    </View>
                    <View style={styles.exercisePreviewInfo}>
                      <Text style={styles.exerciseName}>{display.name}</Text>
                      {sub ? (
                        <Text style={styles.substitutionNote}>Replaces: {ex.name}</Text>
                      ) : null}
                      <Text style={styles.exerciseMeta}>
                        {display.warmup_sets > 0 ? `${display.warmup_sets}W + ` : ''}
                        {display.working_sets} sets · {display.target_reps} reps
                        {display.target_rpe ? ` · RPE ${display.target_rpe}` : ''}
                      </Text>
                    </View>
                    <View style={styles.muscleTag}>
                      <Text style={styles.muscleTagText}>{display.muscle_group}</Text>
                    </View>
                  </TouchableOpacity>
                  {!activeSessionId ? (
                    <View style={styles.exercisePreviewActions}>
                      <TouchableOpacity style={styles.swapMiniBtn} onPress={() => setSwapTemplateId(ex.id)}>
                        <Text style={styles.swapMiniText}>Swap</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {/* Weekly schedule */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weekly schedule</Text>
          <Text style={styles.weekCalendarHint}>{weekCalendarLabel(scheduleWeekOffset)}</Text>
          <View style={styles.weekNavRow}>
            <TouchableOpacity
              style={[styles.weekNavBtn, scheduleWeekOffset <= 0 && styles.weekNavBtnDisabled]}
              disabled={scheduleWeekOffset <= 0}
              onPress={() => {
                setScheduleWeekOffset((o) => Math.max(0, o - 1));
              }}
            >
              <Text style={styles.weekNavBtnText}>Previous week</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.weekNavBtn, scheduleWeekOffset >= MAX_SCHEDULE_WEEK_OFFSET && styles.weekNavBtnDisabled]}
              disabled={scheduleWeekOffset >= MAX_SCHEDULE_WEEK_OFFSET}
              onPress={() => {
                setScheduleWeekOffset((o) => Math.min(MAX_SCHEDULE_WEEK_OFFSET, o + 1));
              }}
            >
              <Text style={styles.weekNavBtnText}>Next week</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.weekTapHint}>Tap a day to preview exercises for your phase.</Text>
          <View style={styles.weekGrid}>
            {SCHEDULE.map((type, index) => {
              const isProgramToday = index === scheduleDay % 7 && scheduleWeekOffset === 0;
              const isPast = scheduleWeekOffset === 0 && index < scheduleDay % 7;
              const isSelected = schedulePreviewDayIndex === index;
              const dayColor = DAY_COLORS[type];
              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.weekDay,
                    isProgramToday && styles.weekDayCurrent,
                    isSelected && styles.weekDaySelected,
                    { borderColor: isSelected ? colors.accent : isProgramToday ? dayColor : colors.border },
                  ]}
                  onPress={() => {
                    setSchedulePreviewDayIndex((prev) => (prev === index ? null : index));
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.weekDayLabel,
                      isProgramToday && { color: dayColor },
                      isPast && styles.weekDayPast,
                      type === 'rest' && styles.weekDayRest,
                    ]}
                  >
                    {DAY_LABELS[type]}
                  </Text>
                  <View
                    style={[
                      styles.weekDayDot,
                      {
                        backgroundColor: isProgramToday
                          ? dayColor
                          : isPast
                            ? dayColor + '44'
                            : colors.border,
                      },
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
          {previewDayType !== null ? (
            <View style={styles.schedulePreview}>
              <Text style={styles.schedulePreviewTitle}>
                {DAY_LABELS[previewDayType]}
                {previewDayType === 'rest' ? ' (no workout)' : ` · ${previewExercises.length} exercises`}
              </Text>
              {previewDayType === 'rest' ? (
                <Text style={styles.schedulePreviewEmpty}>Scheduled rest.</Text>
              ) : previewExercises.length === 0 ? (
                <Text style={styles.schedulePreviewEmpty}>No exercises for this day in the current phase.</Text>
              ) : (
                previewExercises.map((ex, index) => {
                  const subId = pendingSubstitutions[ex.id];
                  const sub = subId ? getExerciseById(subId) : null;
                  const display = sub ?? ex;
                  const detailId = sub?.id ?? ex.id;
                  const detailName = sub?.name ?? ex.name;
                  return (
                    <View key={ex.id} style={styles.previewExerciseRowWrap}>
                      <TouchableOpacity
                        style={styles.previewExerciseRow}
                        onPress={() =>
                          navigation.navigate('ExerciseDetail', {
                            exerciseId: detailId,
                            exerciseName: detailName,
                            programSlotTemplateExerciseId: ex.id,
                          })
                        }
                        activeOpacity={0.7}
                      >
                        <Text style={styles.previewExerciseIndex}>{index + 1}</Text>
                        <View style={styles.previewExerciseBody}>
                          <Text style={styles.previewExerciseName}>{display.name}</Text>
                          {sub ? (
                            <Text style={styles.substitutionNoteSmall}>Replaces: {ex.name}</Text>
                          ) : null}
                          <Text style={styles.previewExerciseMeta}>
                            {display.warmup_sets > 0 ? `${display.warmup_sets}W + ` : ''}
                            {display.working_sets} sets · {display.target_reps}
                          </Text>
                        </View>
                        <Text style={styles.previewExerciseChevron}>›</Text>
                      </TouchableOpacity>
                      {!activeSessionId ? (
                        <View style={styles.previewRowActions}>
                          <TouchableOpacity style={styles.swapMiniBtnSmall} onPress={() => setSwapTemplateId(ex.id)}>
                            <Text style={styles.swapMiniTextSmall}>Swap</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>
          ) : null}
        </View>

      </ScrollView>

      <Modal visible={scheduleDayModal} animationType="fade" transparent onRequestClose={() => setScheduleDayModal(false)}>
        <View style={styles.scheduleModalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setScheduleDayModal(false)} />
          <View style={styles.scheduleModalSheet}>
            <Text style={styles.scheduleModalTitle}>Program day</Text>
            <Text style={styles.scheduleModalHint}>
              Choose which day of your 7-day split is active today. Finishing a workout advances this automatically
              (for example, use this if you deleted a session and want to repeat that day).
            </Text>
            {SCHEDULE.map((type, i) => {
              const active = (scheduleDay % 7) === i;
              const c = DAY_COLORS[type];
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.scheduleDayRow, active && { borderColor: c, backgroundColor: c + '18' }]}
                  onPress={() => {
                    setScheduleDay(i);
                    setScheduleDayModal(false);
                  }}
                >
                  <Text style={styles.scheduleDayRowMain}>
                    Day {i + 1} · {DAY_LABELS[type]}
                  </Text>
                  {active ? (
                    <Text style={[styles.scheduleDayRowBadge, { color: c }]}>Current</Text>
                  ) : (
                    <Text style={styles.scheduleDayRowChevron}>Select</Text>
                  )}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.scheduleModalCancel} onPress={() => setScheduleDayModal(false)}>
              <Text style={styles.scheduleModalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ExerciseSubstituteModal
        visible={swapTemplateId !== null}
        title="Substitute exercise"
        excludeExerciseId={
          swapTemplateId !== null ? pendingSubstitutions[swapTemplateId] : undefined
        }
        onClose={() => setSwapTemplateId(null)}
        onSelect={(replacementId) => {
          if (swapTemplateId !== null) {
            setPendingSubstitution(swapTemplateId, replacementId);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 32 },

  phaseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phaseChipText: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  chevron: { color: colors.textTertiary, fontSize: 11 },

  phaseDropdown: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  phaseOption: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  phaseOptionActive: { backgroundColor: colors.accent + '15' },
  phaseOptionText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  phaseOptionTextActive: { color: colors.accent },
  phaseOptionDesc: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

  todayCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  todayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  todayLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  dayType: {
    fontSize: 28,
    fontWeight: '700',
  },
  dayBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    alignItems: 'flex-end',
  },
  dayBadgeText: { fontSize: 12, fontWeight: '600' },
  dayBadgeHint: { fontSize: 10, fontWeight: '500', marginTop: 2, opacity: 0.85 },

  scheduleModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  scheduleModalSheet: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    maxHeight: '88%',
    zIndex: 1,
  },
  scheduleModalTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  scheduleModalHint: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  scheduleDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    backgroundColor: colors.surfaceElevated,
  },
  scheduleDayRowMain: { color: colors.text, fontSize: 15, fontWeight: '600' },
  scheduleDayRowBadge: { fontSize: 12, fontWeight: '700' },
  scheduleDayRowChevron: { color: colors.textTertiary, fontSize: 13 },
  scheduleModalCancel: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  scheduleModalCancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },

  exerciseCount: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: 16,
  },
  workoutActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  startButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startButtonFlex: { flex: 1 },
  startButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  discardButton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  discardButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },

  restContent: { alignItems: 'center', paddingVertical: 8 },
  restText: { color: colors.textSecondary, fontSize: 15, marginBottom: 16 },
  skipButton: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skipButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },

  section: { marginBottom: 20 },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  sectionHint: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10,
  },

  exercisePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  exercisePreviewMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exercisePreviewActions: { alignItems: 'flex-end', gap: 6, paddingVertical: 4 },
  swapMiniBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  swapMiniText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  substitutionNote: {
    color: colors.textTertiary,
    fontSize: 11,
    marginBottom: 2,
    fontStyle: 'italic',
  },
  substitutionNoteSmall: {
    color: colors.textTertiary,
    fontSize: 10,
    marginBottom: 2,
    fontStyle: 'italic',
  },
  exercisePreviewLeft: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseNumber: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' },
  exercisePreviewInfo: { flex: 1 },
  exerciseName: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  exerciseMeta: { color: colors.textTertiary, fontSize: 12 },
  muscleTag: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  muscleTagText: { color: colors.textTertiary, fontSize: 11 },

  weekCalendarHint: {
    color: colors.textTertiary,
    fontSize: 12,
    marginBottom: 8,
  },
  weekNavRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  weekNavBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  weekNavBtnDisabled: { opacity: 0.35 },
  weekNavBtnText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  weekTapHint: {
    color: colors.textTertiary,
    fontSize: 11,
    marginBottom: 10,
  },
  weekGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  weekDay: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  weekDayCurrent: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1.5,
  },
  weekDaySelected: {
    backgroundColor: colors.accent + '12',
  },
  weekDayLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 6,
  },
  weekDayPast: { color: colors.textTertiary },
  weekDayRest: { color: colors.textTertiary },
  weekDayDot: { width: 6, height: 6, borderRadius: 3 },

  schedulePreview: {
    marginTop: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  schedulePreviewTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  schedulePreviewEmpty: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  previewExerciseRowWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    gap: 4,
  },
  previewExerciseRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 4,
    gap: 10,
  },
  previewRowActions: { alignItems: 'flex-end', gap: 4, paddingVertical: 4 },
  swapMiniBtnSmall: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  swapMiniTextSmall: { fontSize: 10, fontWeight: '600', color: colors.textSecondary },
  previewExerciseBody: { flex: 1 },
  previewExerciseIndex: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
    width: 22,
    textAlign: 'center',
  },
  previewExerciseName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  previewExerciseMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  previewExerciseChevron: { color: colors.textTertiary, fontSize: 18, paddingLeft: 4 },
});
