import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import { WEIGHT_UNIT } from '../constants/weightUnits';
import { isValidYmd } from '../utils/dateLocal';

type Props = {
  visible: boolean;
  title?: string;
  initialDateYmd: string;
  /** Pre-fill the weight input with this value (existing logged weight for the date). */
  initialWeight?: number | null;
  /** When true, date is fixed to initialDateYmd (e.g. finish workout today). */
  lockDate?: boolean;
  /** Shown when lockDate (finish flow). */
  showSkip?: boolean;
  onClose: () => void;
  onSave: (dateYmd: string, weightLbs: number) => void;
  onSkip?: () => void;
};

export default function BodyWeightLogModal({
  visible,
  title = 'Log body weight',
  initialDateYmd,
  initialWeight,
  lockDate = false,
  showSkip = false,
  onClose,
  onSave,
  onSkip,
}: Props) {
  const [dateStr, setDateStr] = useState(initialDateYmd);
  const [lbsStr, setLbsStr] = useState('');

  useEffect(() => {
    if (visible) {
      setDateStr(initialDateYmd);
      setLbsStr(initialWeight != null ? String(initialWeight) : '');
    }
  }, [visible, initialDateYmd, initialWeight]);

  function handleSave() {
    const date = lockDate ? initialDateYmd.trim() : dateStr.trim();
    if (!isValidYmd(date)) {
      Alert.alert('Invalid date', 'Use YYYY-MM-DD format.');
      return;
    }
    const lbs = parseFloat(lbsStr.replace(',', '.'));
    if (!Number.isFinite(lbs) || lbs <= 0 || lbs > 1200) {
      Alert.alert('Invalid weight', `Enter a realistic body weight in ${WEIGHT_UNIT} (0–1200).`);
      return;
    }
    onSave(date, lbs);
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.label}>Date</Text>
          {lockDate ? (
            <Text style={styles.dateLocked}>{initialDateYmd}</Text>
          ) : (
            <TextInput
              style={styles.input}
              value={dateStr}
              onChangeText={setDateStr}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}
          <Text style={styles.label}>Body weight ({WEIGHT_UNIT})</Text>
          <TextInput
            style={styles.input}
            value={lbsStr}
            onChangeText={setLbsStr}
            placeholder="e.g. 175"
            placeholderTextColor={colors.placeholder}
            keyboardType="decimal-pad"
          />
          {initialWeight != null && (
            <Text style={styles.existingHint}>
              Previously logged: {initialWeight} {WEIGHT_UNIT}
            </Text>
          )}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              {showSkip && onSkip ? (
                <TouchableOpacity style={styles.secondaryBtn} onPress={onSkip}>
                  <Text style={styles.secondaryBtnText}>Skip</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity style={styles.ghostBtn} onPress={onClose}>
              <Text style={styles.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSave}>
              <Text style={styles.primaryBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 24 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    zIndex: 1,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  label: { color: colors.textTertiary, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  dateLocked: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 4 },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
  },
  rowLeft: { flex: 1 },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  ghostBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    marginRight: 'auto',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  existingHint: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 4,
    marginBottom: 4,
  },
});
