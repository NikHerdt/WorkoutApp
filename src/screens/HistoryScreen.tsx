import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { getRecentSessions, getSessionDetail } from '../db/database';

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

  return (
    <View style={styles.container}>
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
            <Text style={styles.emptyIcon}>📋</Text>
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
              <View>
                <Text style={styles.modalTitle}>{selectedSession?.workout_name}</Text>
                <Text style={styles.modalDate}>{selectedSession?.completed_at?.slice(0, 10)}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowDetail(false)} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

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
                        {set.weight} kg × {set.reps} reps
                      </Text>
                      {set.set_type === 'working' && (
                        <Text style={styles.modalVolume}>
                          = {Math.round(set.weight * set.reps)} kg vol
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

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
  emptyIcon: { fontSize: 36, marginBottom: 12 },
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
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  modalDate: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: { color: colors.textSecondary, fontSize: 14 },
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
