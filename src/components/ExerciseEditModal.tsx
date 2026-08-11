import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors } from '../theme/colors';
import type { ExerciseDefaults } from '../db/database';

export interface ExerciseEditValues {
  name: string;
  muscleGroup: string;
  warmupSets: number;
  workingSets: number;
  targetReps: string;
  targetRpe: string;
  restSeconds: number;
  notes: string;
}

type Props = {
  visible: boolean;
  initial: ExerciseEditValues | null;
  /** How many workout slots use this exercise — shown so the blast radius is clear. */
  usageCount: number;
  onCancel: () => void;
  onSave: (fields: ExerciseDefaults) => void;
};

function Stepper({
  label,
  value,
  min,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity
          style={[styles.stepBtn, value <= min && styles.stepBtnDisabled]}
          disabled={value <= min}
          onPress={() => onChange(Math.max(min, value - step))}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepValue}>
          {value}
          {suffix ?? ''}
        </Text>
        <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(value + step)}>
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatRest(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Edit a shared exercise: its identity and the defaults every program inherits. */
export default function ExerciseEditModal({
  visible,
  initial,
  usageCount,
  onCancel,
  onSave,
}: Props) {
  const [v, setV] = useState<ExerciseEditValues | null>(initial);

  useEffect(() => {
    if (visible) setV(initial);
  }, [visible, initial]);

  if (!v) return null;
  const canSave = v.name.trim().length > 0;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>Edit exercise</Text>

          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={v.name}
              onChangeText={(t) => setV({ ...v, name: t })}
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.label}>Muscle group</Text>
            <TextInput
              style={styles.input}
              value={v.muscleGroup}
              onChangeText={(t) => setV({ ...v, muscleGroup: t })}
              placeholder="e.g. Chest"
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.sectionLabel}>DEFAULTS</Text>
            <Stepper
              label="Warmup sets"
              value={v.warmupSets}
              min={0}
              onChange={(n) => setV({ ...v, warmupSets: n })}
            />
            <Stepper
              label="Working sets"
              value={v.workingSets}
              min={1}
              onChange={(n) => setV({ ...v, workingSets: n })}
            />
            <View style={styles.stepperRow}>
              <Text style={styles.stepperLabel}>Rest timer</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepBtn, v.restSeconds <= 0 && styles.stepBtnDisabled]}
                  disabled={v.restSeconds <= 0}
                  onPress={() => setV({ ...v, restSeconds: Math.max(0, v.restSeconds - 15) })}
                >
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepValue}>{formatRest(v.restSeconds)}</Text>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => setV({ ...v, restSeconds: v.restSeconds + 15 })}
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <Text style={styles.label}>Target reps</Text>
                <TextInput
                  style={styles.input}
                  value={v.targetReps}
                  onChangeText={(t) => setV({ ...v, targetReps: t })}
                  placeholder="8-12"
                  placeholderTextColor={colors.placeholder}
                />
              </View>
              <View style={styles.rowItem}>
                <Text style={styles.label}>Target RPE</Text>
                <TextInput
                  style={styles.input}
                  value={v.targetRpe}
                  onChangeText={(t) => setV({ ...v, targetRpe: t })}
                  placeholder="8"
                  placeholderTextColor={colors.placeholder}
                />
              </View>
            </View>

            <Text style={styles.label}>Cue / notes</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={v.notes}
              onChangeText={(t) => setV({ ...v, notes: t })}
              placeholder="Optional form cue"
              placeholderTextColor={colors.placeholder}
              multiline
            />

            <Text style={styles.hint}>
              {usageCount > 0
                ? `This exercise is used in ${usageCount} workout day${usageCount === 1 ? '' : 's'}. Name, muscle group and notes apply everywhere. Defaults apply wherever a day hasn't set its own sets/reps/rest — days with their own programming keep it.`
                : 'This exercise is not in any workout yet.'}
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, !canSave && styles.btnDisabled]}
              disabled={!canSave}
              onPress={() =>
                onSave({
                  name: v.name,
                  muscleGroup: v.muscleGroup,
                  notes: v.notes,
                  warmupSets: v.warmupSets,
                  workingSets: v.workingSets,
                  targetReps: v.targetReps,
                  targetRpe: v.targetRpe,
                  restSeconds: v.restSeconds,
                })
              }
            >
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    zIndex: 1,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 10 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 8,
  },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  rowItem: { flex: 1 },

  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  stepperLabel: { color: colors.textSecondary, fontSize: 13 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  stepBtn: { width: 40, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepBtnDisabled: { opacity: 0.25 },
  stepBtnText: { color: colors.text, fontSize: 18, lineHeight: 22 },
  stepValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    minWidth: 52,
    textAlign: 'center',
  },

  hint: { color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  cancelText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.accent },
  saveText: { color: '#000', fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.4 },
});
