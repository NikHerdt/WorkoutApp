import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { insertCustomExercise } from '../db/database';

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Calves', 'Abs', 'Glutes', 'Traps', 'Rear Delts', 'Full Body',
];

export default function AddExerciseScreen() {
  const navigation = useNavigation();
  const [name, setName] = useState('');
  const [muscleGroup, setMuscleGroup] = useState('');
  const [notes, setNotes] = useState('');

  function handleSave() {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter an exercise name.');
      return;
    }
    if (!muscleGroup) {
      Alert.alert('Error', 'Please select a muscle group.');
      return;
    }

    insertCustomExercise(name.trim(), muscleGroup, notes.trim());
    Alert.alert('Success', `"${name}" added!`, [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Name */}
        <View style={styles.field}>
          <Text style={styles.label}>Exercise Name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Cable Fly, Hip Thrust..."
            placeholderTextColor={colors.placeholder}
            autoFocus
            returnKeyType="next"
          />
        </View>

        {/* Muscle group selector */}
        <View style={styles.field}>
          <Text style={styles.label}>Muscle Group *</Text>
          <View style={styles.muscleGrid}>
            {MUSCLE_GROUPS.map((muscle) => (
              <TouchableOpacity
                key={muscle}
                style={[styles.muscleChip, muscleGroup === muscle && styles.muscleChipActive]}
                onPress={() => setMuscleGroup(muscle)}
              >
                <Text style={[styles.muscleChipText, muscleGroup === muscle && styles.muscleChipTextActive]}>
                  {muscle}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Coaching cues / notes */}
        <View style={styles.field}>
          <Text style={styles.label}>Coaching Cues / Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Form cues, setup notes..."
            placeholderTextColor={colors.placeholder}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, (!name.trim() || !muscleGroup) && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!name.trim() || !muscleGroup}
        >
          <Text style={styles.saveButtonText}>Save Exercise</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },

  field: { marginBottom: 24 },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },

  muscleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  muscleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  muscleChipActive: {
    backgroundColor: colors.accent + '18',
    borderColor: colors.accent,
  },
  muscleChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  muscleChipTextActive: { color: colors.accent, fontWeight: '600' },

  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
