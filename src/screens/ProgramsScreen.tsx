import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { HomeStackParamList } from '../navigation/AppNavigator';
import { useWorkoutStore } from '../store/useWorkoutStore';
import {
  getAllPrograms,
  getProgramDays,
  createCustomProgram,
  deleteCustomProgram,
  ProgramRow,
} from '../db/database';
import { AppConfirmModal, AppInputModal, AppNoticeModal } from '../components/AppModalDialogs';

type Nav = NativeStackNavigationProp<HomeStackParamList, 'Programs'>;

interface ProgramListItem extends ProgramRow {
  trainingDayCount: number;
}

export default function ProgramsScreen() {
  const navigation = useNavigation<Nav>();
  const activeProgramId = useWorkoutStore((s) => s.activeProgramId);
  const activeSessionId = useWorkoutStore((s) => s.activeSessionId);
  const setActiveProgram = useWorkoutStore((s) => s.setActiveProgram);
  const [programs, setPrograms] = useState<ProgramListItem[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [programToDelete, setProgramToDelete] = useState<ProgramListItem | null>(null);
  const [activeWorkoutNotice, setActiveWorkoutNotice] = useState(false);

  const refresh = useCallback(() => {
    const rows = getAllPrograms().map((p) => ({
      ...p,
      trainingDayCount: p.is_builtin
        ? 5
        : getProgramDays(p.id).filter((d) => d.workout_id != null).length,
    }));
    setPrograms(rows);
  }, []);

  useFocusEffect(refresh);

  function handleActivate(programId: number) {
    if (!setActiveProgram(programId)) {
      setActiveWorkoutNotice(true);
      return;
    }
    refresh();
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.hint}>
          The program controls what each day of your 7-day cycle looks like. The built-in
          PPL × UL plan keeps its phases and week progression; custom programs repeat the
          same 7-day cycle.
        </Text>

        {programs.map((program) => {
          const isActive = program.id === activeProgramId;
          return (
            <View key={program.id} style={[styles.card, isActive && styles.cardActive]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.cardTitle}>{program.name}</Text>
                  <Text style={styles.cardMeta}>
                    {program.is_builtin
                      ? '3 phases · 5 training days / week'
                      : `${program.trainingDayCount} training day${program.trainingDayCount === 1 ? '' : 's'} / week`}
                  </Text>
                </View>
                {isActive ? (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>Active</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.cardActions}>
                {!isActive ? (
                  <TouchableOpacity style={styles.primaryBtn} onPress={() => handleActivate(program.id)}>
                    <Text style={styles.primaryBtnText}>Use this program</Text>
                  </TouchableOpacity>
                ) : null}
                {!program.is_builtin ? (
                  <>
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => navigation.navigate('ProgramEdit', { programId: program.id, programName: program.name })}
                    >
                      <Text style={styles.secondaryBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.dangerBtn} onPress={() => setProgramToDelete(program)}>
                      <Text style={styles.dangerBtnText}>Delete</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>
            </View>
          );
        })}

        <TouchableOpacity style={styles.newBtn} onPress={() => setCreateModalOpen(true)}>
          <Text style={styles.newBtnText}>+ New program</Text>
        </TouchableOpacity>
      </ScrollView>

      <AppInputModal
        visible={createModalOpen}
        title="New program"
        message="Name your program, then lay out its 7-day cycle."
        placeholder="e.g. Upper/Lower 4-day"
        submitText="Create"
        onCancel={() => setCreateModalOpen(false)}
        onSubmit={(name) => {
          setCreateModalOpen(false);
          const programId = createCustomProgram(name);
          refresh();
          navigation.navigate('ProgramEdit', { programId, programName: name });
        }}
      />

      <AppConfirmModal
        visible={programToDelete !== null}
        title="Delete program?"
        message={`Delete ${programToDelete?.name ?? 'this program'}? Workout history logged under it is kept.${
          programToDelete?.id === activeProgramId ? ' You will be switched back to the built-in plan.' : ''
        }`}
        cancelText="Cancel"
        confirmText="Delete"
        confirmVariant="danger"
        onCancel={() => setProgramToDelete(null)}
        onConfirm={() => {
          if (!programToDelete) return;
          if (programToDelete.id === activeProgramId && activeSessionId) {
            setProgramToDelete(null);
            setActiveWorkoutNotice(true);
            return;
          }
          deleteCustomProgram(programToDelete.id);
          setProgramToDelete(null);
          useWorkoutStore.getState().loadSettings();
          refresh();
        }}
      />

      <AppNoticeModal
        visible={activeWorkoutNotice}
        title="Workout in progress"
        message="Finish or discard your current workout before changing programs."
        onClose={() => setActiveWorkoutNotice(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, paddingBottom: 32 },
  hint: { color: colors.textTertiary, fontSize: 12, lineHeight: 17, marginBottom: 16 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  cardActive: { borderColor: colors.accent + '88' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitleWrap: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cardMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 3 },
  activeBadge: {
    backgroundColor: colors.accent + '22',
    borderColor: colors.accent + '55',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  activeBadgeText: { color: colors.accent, fontSize: 11, fontWeight: '700' },

  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryBtnText: { color: '#000', fontSize: 13, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  secondaryBtnText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  dangerBtn: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  dangerBtnText: { color: '#D97777', fontSize: 13, fontWeight: '600' },

  newBtn: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  newBtnText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
