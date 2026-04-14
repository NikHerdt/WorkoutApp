import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import {
  getRecentSessions,
  getSessionDetail,
  deleteCompletedWorkoutSession,
  upsertBodyWeightForDate,
  getBodyWeightForDate,
} from '../db/database';
import BodyWeightLogModal from '../components/BodyWeightLogModal';
import { WEIGHT_UNIT } from '../constants/weightUnits';
import { toLocalDateYmd } from '../utils/dateLocal';

const DAY_COLORS: Record<string, string> = {
  push: '#FF6B35',
  pull: '#4A9EFF',
  legs: '#E8F05C',
  upper: '#A78BFA',
  lower: '#34D399',
};

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [markedDates, setMarkedDates] = useState<any>({});
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [sessionSets, setSessionSets] = useState<any[]>([]);
  const [showDetail, setShowDetail] = useState(false);
  const [weightModalOpen, setWeightModalOpen] = useState(false);
  const [weightModalDate, setWeightModalDate] = useState(toLocalDateYmd());

  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [])
  );

  function loadSessions() {
    const recent = getRecentSessions(60);
    setSessions(recent);

    const marked: any = {};
    for (const session of recent) {
      const date = session.completed_at.slice(0, 10);
      const color = DAY_COLORS[session.day_type] ?? '#888';
      marked[date] = {
        marked: true,
        dotColor: color,
        selectedColor: color,
      };
    }
    setMarkedDates(marked);
  }

  function handleDayPress(day: any) {
    const date = day.dateString;
    const session = sessions.find((s) => s.completed_at.startsWith(date));
    if (session) {
      setSelectedSession(session);
      const sets = getSessionDetail(session.id);
      setSessionSets(sets);
      setShowDetail(true);
    }
  }

  // Group sets by exercise
  const groupedSets = sessionSets.reduce((acc: any, set: any) => {
    const key = set.exercise_name;
    if (!acc[key]) acc[key] = { name: key, muscle_group: set.muscle_group, sets: [] };
    acc[key].sets.push(set);
    return acc;
  }, {});

  function formatDuration(start: string, end: string) {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const minutes = Math.round((endMs - startMs) / 60000);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function openWeightModal(dateYmd: string) {
    setWeightModalDate(dateYmd);
    setWeightModalOpen(true);
  }

  function handleDeleteSession() {
    const id = selectedSession?.id;
    if (id == null) return;
    Alert.alert(
      'Delete workout?',
      'This removes this session and all logged sets. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (deleteCompletedWorkoutSession(id)) {
              setShowDetail(false);
              setSelectedSession(null);
              setSessionSets([]);
              loadSessions();
            }
          },
        },
      ]
    );
  }

  const sessionDateYmd = selectedSession?.completed_at?.slice(0, 10) ?? '';
  const sessionBodyWeightLbs =
    sessionDateYmd.length >= 10 ? getBodyWeightForDate(sessionDateYmd) : null;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.logWeightBanner} onPress={() => openWeightModal(toLocalDateYmd())}>
        <Text style={styles.logWeightBannerText}>Log body weight</Text>
        <Text style={styles.logWeightBannerHint}>Tap to add or update an entry ({WEIGHT_UNIT})</Text>
      </TouchableOpacity>

      <Calendar
        style={styles.calendar}
        theme={{
          backgroundColor: colors.background,
          calendarBackground: colors.surface,
          textSectionTitleColor: colors.textSecondary,
          selectedDayBackgroundColor: colors.accent,
          selectedDayTextColor: '#000',
          todayTextColor: colors.accent,
          dayTextColor: colors.text,
          textDisabledColor: colors.textTertiary,
          dotColor: colors.accent,
          selectedDotColor: '#000',
          arrowColor: colors.accent,
          monthTextColor: colors.text,
          indicatorColor: colors.accent,
          textDayFontWeight: '500',
          textMonthFontWeight: '700',
          textDayHeaderFontWeight: '600',
        }}
        markedDates={markedDates}
        onDayPress={handleDayPress}
        enableSwipeMonths
      />

      {/* Recent sessions list */}
      <ScrollView style={styles.sessionList} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Recent Workouts</Text>
        {sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No workouts logged yet.</Text>
            <Text style={styles.emptySubText}>Complete your first workout to see history here.</Text>
          </View>
        ) : (
          sessions.slice(0, 20).map((session) => {
            const date = session.completed_at.slice(0, 10);
            const color = DAY_COLORS[session.day_type] ?? colors.textSecondary;
            return (
              <TouchableOpacity
                key={session.id}
                style={styles.sessionRow}
                onPress={() => {
                  setSelectedSession(session);
                  const sets = getSessionDetail(session.id);
                  setSessionSets(sets);
                  setShowDetail(true);
                }}
              >
                <View style={[styles.sessionDot, { backgroundColor: color }]} />
                <View style={styles.sessionInfo}>
                  <Text style={styles.sessionName}>{session.workout_name}</Text>
                  <Text style={styles.sessionDate}>{date}</Text>
                </View>
                <View style={styles.sessionDuration}>
                  <Text style={styles.sessionDurationText}>
                    {formatDuration(session.started_at, session.completed_at)}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Session detail modal */}
      <Modal visible={showDetail} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{selectedSession?.workout_name}</Text>
                <Text style={styles.modalDate}>{selectedSession?.completed_at?.slice(0, 10)}</Text>
              </View>
              <View style={styles.modalHeaderActions}>
                <TouchableOpacity
                  onPress={() => openWeightModal(sessionDateYmd || toLocalDateYmd())}
                  style={styles.logWeightHeaderBtn}
                >
                  <Text style={styles.logWeightHeaderBtnText}>Weight</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDeleteSession} style={styles.deleteSessionButton}>
                  <Text style={styles.deleteSessionButtonText}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowDetail(false)} style={styles.closeButton}>
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
            {sessionBodyWeightLbs != null ? (
              <Text style={styles.sessionWeightNote}>
                Body weight this day: {sessionBodyWeightLbs} {WEIGHT_UNIT}
              </Text>
            ) : null}

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {Object.values(groupedSets).map((exercise: any, idx) => (
                <View key={idx} style={styles.modalExercise}>
                  <View style={styles.modalExerciseHeader}>
                    <Text style={styles.modalExerciseName}>{exercise.name}</Text>
                    <Text style={styles.modalMuscle}>{exercise.muscle_group}</Text>
                  </View>
                  {exercise.sets.map((set: any, setIdx: number) => (
                    <View key={setIdx} style={[styles.modalSetRow, set.set_type === 'warmup' && styles.modalWarmupRow]}>
                      <Text style={[styles.modalSetType, set.set_type === 'warmup' && styles.modalWarmupText]}>
                        {set.set_type === 'warmup' ? 'W' : set.set_number}
                      </Text>
                      <Text style={[styles.modalSetData, set.set_type === 'warmup' && styles.modalWarmupText]}>
                        {set.weight} {WEIGHT_UNIT} × {set.reps} reps
                      </Text>
                      {set.set_type === 'working' && (
                        <Text style={styles.modalVolume}>
                          = {Math.round(set.weight * set.reps)} {WEIGHT_UNIT} vol
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              ))}
              <View style={{ height: 32 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <BodyWeightLogModal
        visible={weightModalOpen}
        title="Log body weight"
        initialDateYmd={weightModalDate}
        lockDate={false}
        showSkip={false}
        onClose={() => setWeightModalOpen(false)}
        onSave={(dateYmd, lbs) => {
          upsertBodyWeightForDate(dateYmd, lbs);
          setWeightModalOpen(false);
          loadSessions();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  logWeightBanner: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logWeightBannerText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  logWeightBannerHint: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },

  calendar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  sessionList: { flex: 1, padding: 16 },

  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },

  emptyState: {
    alignItems: 'center',
    paddingTop: 40,
  },
  emptyText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600', marginBottom: 6 },
  emptySubText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center' },

  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  sessionDot: { width: 10, height: 10, borderRadius: 5 },
  sessionInfo: { flex: 1 },
  sessionName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sessionDate: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  sessionDuration: {},
  sessionDurationText: { color: colors.textSecondary, fontSize: 12 },
  chevron: { color: colors.textTertiary, fontSize: 18 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  modalHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  modalDate: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  sessionWeightNote: {
    color: colors.textSecondary,
    fontSize: 13,
    paddingHorizontal: 20,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logWeightHeaderBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.accent + '22',
    borderWidth: 1,
    borderColor: colors.accent + '44',
  },
  logWeightHeaderBtnText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  deleteSessionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.danger + '22',
    borderWidth: 1,
    borderColor: colors.danger + '55',
  },
  deleteSessionButtonText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  modalScroll: { padding: 16 },

  modalExercise: { marginBottom: 20 },
  modalExerciseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalExerciseName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  modalMuscle: {
    color: colors.textTertiary,
    fontSize: 11,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modalSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalWarmupRow: { opacity: 0.6 },
  modalSetType: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    width: 20,
  },
  modalSetData: { color: colors.text, fontSize: 14, flex: 1 },
  modalWarmupText: { color: colors.warmupText },
  modalVolume: { color: colors.textTertiary, fontSize: 12 },
});
