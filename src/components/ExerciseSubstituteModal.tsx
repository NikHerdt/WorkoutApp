import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors } from '../theme/colors';
import { getAllExercises } from '../db/database';

type ExerciseRow = {
  id: number;
  name: string;
  muscle_group: string;
  workout_name: string | null;
  phase_name: string | null;
};

interface ExerciseSubstituteModalProps {
  visible: boolean;
  title: string;
  /** Exercise id to exclude from the list (the one being replaced). */
  excludeExerciseId?: number;
  onSelect: (exerciseId: number) => void;
  onClose: () => void;
}

export default function ExerciseSubstituteModal({
  visible,
  title,
  excludeExerciseId,
  onSelect,
  onClose,
}: ExerciseSubstituteModalProps) {
  const [query, setQuery] = useState('');

  const all = useMemo(() => {
    if (!visible) return [];
    return getAllExercises() as ExerciseRow[];
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      if (excludeExerciseId !== undefined && e.id === excludeExerciseId) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.muscle_group && e.muscle_group.toLowerCase().includes(q))
      );
    });
  }, [all, query, excludeExerciseId]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.search}
            placeholder="Search exercises"
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={24}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setQuery('');
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {[item.muscle_group, item.phase_name].filter(Boolean).join(' · ')}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>No exercises match.</Text>
            }
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '78%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '700', flex: 1, marginRight: 12 },
  closeText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  search: {
    marginHorizontal: 16,
    marginVertical: 10,
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 4 },
  empty: { color: colors.textTertiary, padding: 24, textAlign: 'center', fontSize: 14 },
});
