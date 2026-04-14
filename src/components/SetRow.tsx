import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { WEIGHT_UNIT } from '../constants/weightUnits';
import { ActiveSet } from '../types';
import SwipeableRow from './SwipeableRow';

interface SetRowProps {
  set: ActiveSet;
  previousWeight?: string;
  previousReps?: string;
  onWeightChange: (value: string) => void;
  onRepsChange: (value: string) => void;
  onToggleComplete: () => void;
  /** When provided, the row becomes swipeable to reveal a Delete action. Only shown for uncompleted sets. */
  onDelete?: () => void;
  /** When true, the reps field is treated as seconds (timed hold exercises). */
  isTimed?: boolean;
}

export default function SetRow({
  set,
  previousWeight,
  previousReps,
  onWeightChange,
  onRepsChange,
  onToggleComplete,
  onDelete,
  isTimed = false,
}: SetRowProps) {
  const isWarmup = set.setType === 'warmup';
  const isCompleted = set.completed;
  const canDelete = !!onDelete && !isCompleted;

  const rowContent = (
    <View style={[styles.row, isWarmup && styles.warmupRow, isCompleted && styles.completedRow]}>
      {/* Set label */}
      <View style={styles.setLabel}>
        {isWarmup ? (
          <Text style={styles.warmupSetText}>W{set.setNumber}</Text>
        ) : (
          <Text style={[styles.setNumber, isCompleted && styles.completedText]}>
            {set.setNumber - (set.setNumber > 1 ? 0 : 0)}
          </Text>
        )}
      </View>

      {/* Previous */}
      <View style={styles.previous}>
        {previousReps ? (
          <Text style={styles.previousText}>
            {isTimed
              ? (previousWeight && parseFloat(previousWeight) > 0
                  ? `${previousWeight} ${WEIGHT_UNIT} × ${previousReps}s`
                  : `${previousReps}s`)
              : `${previousWeight} ${WEIGHT_UNIT} × ${previousReps}`}
          </Text>
        ) : (
          <Text style={styles.previousEmpty}>—</Text>
        )}
      </View>

      {/* Weight input */}
      <TextInput
        style={[styles.input, isWarmup && styles.warmupInput, isCompleted && styles.completedInput]}
        value={set.weight}
        onChangeText={onWeightChange}
        keyboardType="decimal-pad"
        placeholder={WEIGHT_UNIT}
        placeholderTextColor={colors.placeholder}
        editable={!isCompleted}
        selectTextOnFocus
      />

      {/* Reps / time input */}
      <TextInput
        style={[styles.input, isWarmup && styles.warmupInput, isCompleted && styles.completedInput]}
        value={set.reps}
        onChangeText={onRepsChange}
        keyboardType="number-pad"
        placeholder={isTimed ? 'sec' : 'reps'}
        placeholderTextColor={colors.placeholder}
        editable={!isCompleted}
        selectTextOnFocus
      />

      {/* Complete / undo */}
      <TouchableOpacity
        style={[styles.checkButton, isCompleted && styles.checkButtonDone, isWarmup && styles.checkButtonWarmup]}
        onPress={onToggleComplete}
      >
        <Text style={[styles.checkText, isCompleted && styles.checkTextDone]}>
          {isCompleted ? 'Undo' : 'Log'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (canDelete) {
    return <SwipeableRow onDelete={onDelete!}>{rowContent}</SwipeableRow>;
  }
  return rowContent;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
    backgroundColor: colors.surface,
  },
  warmupRow: {
    backgroundColor: colors.warmup + '40',
  },
  completedRow: {
    backgroundColor: colors.success + '15',
  },
  setLabel: {
    width: 30,
    alignItems: 'center',
  },
  setNumber: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  warmupSetText: {
    color: colors.warmupText,
    fontSize: 13,
    fontWeight: '600',
  },
  completedText: {
    color: colors.success,
  },
  previous: {
    flex: 1,
    alignItems: 'center',
  },
  previousText: {
    color: colors.textTertiary,
    fontSize: 12,
  },
  previousEmpty: {
    color: colors.textTertiary,
    fontSize: 14,
  },
  input: {
    width: 64,
    height: 36,
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    color: colors.text,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: colors.border,
  },
  warmupInput: {
    backgroundColor: colors.warmup,
    color: colors.warmupText,
  },
  completedInput: {
    borderColor: colors.success + '60',
    color: colors.success,
  },
  checkButton: {
    minWidth: 44,
    paddingHorizontal: 6,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.inputBg,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkButtonDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  checkButtonWarmup: {
    borderColor: colors.warmupText,
  },
  checkText: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
  },
  checkTextDone: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 10,
  },
});
