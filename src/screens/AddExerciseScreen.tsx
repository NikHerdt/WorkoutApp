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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { insertCustomExercise } from '../db/database';
import ActionSheet from '../components/ActionSheet';

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Calves', 'Abs', 'Glutes', 'Traps', 'Rear Delts', 'Full Body',
];

const REST_OPTIONS: { label: string; seconds: number }[] = [
  { label: '30s', seconds: 30 },
  { label: '1:00', seconds: 60 },
  { label: '1:30', seconds: 90 },
  { label: '2:00', seconds: 120 },
  { label: '2:30', seconds: 150 },
  { label: '3:00', seconds: 180 },
  { label: '4:00', seconds: 240 },
  { label: '5:00', seconds: 300 },
];

function StepperField({
  label,
  hint,
  value,
  onDecrement,
  onIncrement,
  displayValue,
}: {
  label: string;
  hint?: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  displayValue?: string;
}) {
  return (
    <View style={styles.stepperRow}>
      <View style={styles.stepperLeft}>
        <Text style={styles.stepperLabel}>{label}</Text>
        {hint ? <Text style={styles.stepperHint}>{hint}</Text> : null}
      </View>
      <View style={styles.stepperControls}>
        <TouchableOpacity style={styles.stepperBtn} onPress={onDecrement}>
          <Text style={styles.stepperBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{displayValue ?? String(value)}</Text>
        <TouchableOpacity style={styles.stepperBtn} onPress={onIncrement}>
          <Text style={styles.stepperBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function AddExerciseScreen() {
  const navigation = useNavigation();

  const [name, setName] = useState('');
  const [muscleGroup, setMuscleGroup] = useState('');
  const [notes, setNotes] = useState('');
  const [warmupSets, setWarmupSets] = useState(0);
  const [workingSets, setWorkingSets] = useState(3);
  const [targetReps, setTargetReps] = useState('8-12');
  const [targetRpe, setTargetRpe] = useState('');
  const [restSeconds, setRestSeconds] = useState(90);
  const [errorSheet, setErrorSheet] = useState<string | null>(null);

  const restLabel = REST_OPTIONS.find((r) => r.seconds === restSeconds)?.label
    ?? `${Math.floor(restSeconds / 60)}:${String(restSeconds % 60).padStart(2, '0')}`;

  function handleSave() {
    if (!name.trim()) {
      setErrorSheet('Please enter an exercise name.');
      return;
    }
    if (!muscleGroup) {
      setErrorSheet('Please select a muscle group.');
      return;
    }
    insertCustomExercise(
      name.trim(),
      muscleGroup,
      notes.trim(),
      warmupSets,
      workingSets,
      targetReps.trim(),
      targetRpe.trim(),
      restSeconds
    );
    navigation.goBack();
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

        {/* Sets */}
        <View style={styles.field}>
          <Text style={styles.label}>Sets</Text>
          <View style={styles.card}>
            <StepperField
              label="Warmup sets"
              value={warmupSets}
              onDecrement={() => setWarmupSets((v) => Math.max(0, v - 1))}
              onIncrement={() => setWarmupSets((v) => v + 1)}
            />
            <View style={styles.cardDivider} />
            <StepperField
              label="Working sets"
              value={workingSets}
              onDecrement={() => setWorkingSets((v) => Math.max(1, v - 1))}
              onIncrement={() => setWorkingSets((v) => v + 1)}
            />
          </View>
        </View>

        {/* Reps + RPE */}
        <View style={styles.field}>
          <Text style={styles.label}>Reps &amp; Intensity</Text>
          <View style={styles.card}>
            <View style={styles.inlineRow}>
              <View style={styles.inlineField}>
                <Text style={styles.inlineLabel}>Rep Target</Text>
                <TextInput
                  style={styles.inlineInput}
                  value={targetReps}
                  onChangeText={setTargetReps}
                  placeholder="e.g. 8-12"
                  placeholderTextColor={colors.placeholder}
                  returnKeyType="next"
                />
              </View>
              <View style={styles.inlineDivider} />
              <View style={styles.inlineField}>
                <Text style={styles.inlineLabel}>Target RPE</Text>
                <TextInput
                  style={styles.inlineInput}
                  value={targetRpe}
                  onChangeText={setTargetRpe}
                  placeholder="e.g. 8"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>
            </View>
          </View>
        </View>

        {/* Rest */}
        <View style={styles.field}>
          <Text style={styles.label}>Rest Period</Text>
          <View style={styles.chipRow}>
            {REST_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.seconds}
                style={[styles.restChip, restSeconds === opt.seconds && styles.restChipActive]}
                onPress={() => setRestSeconds(opt.seconds)}
              >
                <Text style={[styles.restChipText, restSeconds === opt.seconds && styles.restChipTextActive]}>
                  {opt.label}
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

        {/* Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryText}>
            {warmupSets > 0 ? `${warmupSets} warmup + ` : ''}{workingSets} working sets
            {targetReps ? ` · ${targetReps} reps` : ''}
            {targetRpe ? ` · RPE ${targetRpe}` : ''}
            {' · '}{restLabel} rest
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, (!name.trim() || !muscleGroup) && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!name.trim() || !muscleGroup}
        >
          <Text style={styles.saveButtonText}>Save Exercise</Text>
        </TouchableOpacity>
      </ScrollView>

      <ActionSheet
        visible={errorSheet !== null}
        title="Missing Info"
        message={errorSheet ?? ''}
        actions={[{ label: 'OK', style: 'cancel' }]}
        onClose={() => setErrorSheet(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },

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

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },

  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  stepperLeft: { flex: 1 },
  stepperLabel: { color: colors.text, fontSize: 15, fontWeight: '500' },
  stepperHint: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: { color: colors.text, fontSize: 20, lineHeight: 24, fontWeight: '400' },
  stepperValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    minWidth: 24,
    textAlign: 'center',
  },

  inlineRow: {
    flexDirection: 'row',
  },
  inlineField: {
    flex: 1,
    padding: 14,
  },
  inlineDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  inlineLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  inlineInput: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    padding: 0,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  restChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  restChipActive: {
    backgroundColor: colors.accent + '18',
    borderColor: colors.accent,
  },
  restChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  restChipTextActive: { color: colors.accent, fontWeight: '600' },

  summaryCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  summaryText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },

  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
