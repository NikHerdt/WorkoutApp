import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { getAllExercises } from '../db/database';
import { ExercisesStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<ExercisesStackParamList, 'ExercisesList'>;

const MUSCLE_COLORS: Record<string, string> = {
  Chest: '#FF6B35',
  Back: '#4A9EFF',
  Shoulders: '#A78BFA',
  Biceps: '#34D399',
  Triceps: '#F59E0B',
  Quads: '#E8F05C',
  Hamstrings: '#EC4899',
  Calves: '#06B6D4',
  Abs: '#6366F1',
  Glutes: '#EF4444',
  Traps: '#84CC16',
  'Rear Delts': '#F97316',
};

export default function ExercisesScreen() {
  const navigation = useNavigation<Nav>();
  const [exercises, setExercises] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setExercises(getAllExercises());
    }, [])
  );

  const muscleGroups = [...new Set(exercises.map((e) => e.muscle_group).filter(Boolean))].sort();

  const filtered = exercises.filter((ex) => {
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
    const matchesMuscle = !selectedMuscle || ex.muscle_group === selectedMuscle;
    return matchesSearch && matchesMuscle;
  });

  // Group by muscle group
  const grouped = filtered.reduce((acc: any, ex) => {
    const key = ex.muscle_group || 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(ex);
    return acc;
  }, {});

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search exercises..."
            placeholderTextColor={colors.placeholder}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={styles.clearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('AddExercise')}
        >
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Muscle group filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        <TouchableOpacity
          style={[styles.filterChip, !selectedMuscle && styles.filterChipActive]}
          onPress={() => setSelectedMuscle(null)}
        >
          <Text style={[styles.filterChipText, !selectedMuscle && styles.filterChipTextActive]}>All</Text>
        </TouchableOpacity>
        {muscleGroups.map((muscle) => (
          <TouchableOpacity
            key={muscle}
            style={[styles.filterChip, selectedMuscle === muscle && styles.filterChipActive, selectedMuscle === muscle && { borderColor: MUSCLE_COLORS[muscle] ?? colors.accent }]}
            onPress={() => setSelectedMuscle(selectedMuscle === muscle ? null : muscle)}
          >
            <View style={[styles.muscleDot, { backgroundColor: MUSCLE_COLORS[muscle] ?? colors.accent }]} />
            <Text style={[styles.filterChipText, selectedMuscle === muscle && styles.filterChipTextActive, selectedMuscle === muscle && { color: MUSCLE_COLORS[muscle] ?? colors.accent }]}>
              {muscle}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {Object.entries(grouped).map(([muscle, exList]: [string, any]) => (
          <View key={muscle} style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={[styles.groupDot, { backgroundColor: MUSCLE_COLORS[muscle] ?? colors.textTertiary }]} />
              <Text style={styles.groupTitle}>{muscle}</Text>
              <Text style={styles.groupCount}>{(exList as any[]).length}</Text>
            </View>
            {(exList as any[]).map((exercise: any) => (
              <TouchableOpacity
                key={exercise.id}
                style={styles.exerciseRow}
                onPress={() =>
                  navigation.navigate('ExerciseDetail', {
                    exerciseId: exercise.id,
                    exerciseName: exercise.name,
                    programSlotTemplateExerciseId: exercise.id,
                  })
                }
              >
                <View style={styles.exerciseInfo}>
                  <Text style={styles.exerciseName}>{exercise.name}</Text>
                  <Text style={styles.exerciseMeta}>
                    {exercise.working_sets} sets · {exercise.target_reps} reps
                    {exercise.phase_name ? ` · ${exercise.phase_name}` : ''}
                    {exercise.is_custom ? ' · Custom' : ''}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}

        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No exercises found</Text>
          </View>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  searchIcon: { fontSize: 14 },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 10,
  },
  clearText: { color: colors.textTertiary, fontSize: 14, padding: 4 },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: '#000', fontSize: 24, fontWeight: '300', lineHeight: 28 },

  filterRow: { maxHeight: 48 },
  filterContent: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
    flexDirection: 'row',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  filterChipActive: {
    backgroundColor: colors.accent + '18',
    borderColor: colors.accent,
  },
  filterChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  filterChipTextActive: { color: colors.accent, fontWeight: '600' },
  muscleDot: { width: 6, height: 6, borderRadius: 3 },

  list: { flex: 1 },
  group: { marginTop: 12 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    flex: 1,
    textTransform: 'uppercase',
  },
  groupCount: {
    color: colors.textTertiary,
    fontSize: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },

  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginBottom: 6,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exerciseInfo: { flex: 1 },
  exerciseName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  exerciseMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.textTertiary, fontSize: 18 },

  empty: { alignItems: 'center', padding: 40 },
  emptyText: { color: colors.textSecondary, fontSize: 15 },
});
