import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors } from '../theme/colors';
import { PROGRAM_TEMPLATES } from '../data/programTemplates';

type Props = {
  visible: boolean;
  aiConfigured: boolean;
  busy: boolean;
  onCancel: () => void;
  onCreateEmpty: (name: string) => void;
  onGenerate: (name: string, memo: string) => void;
  /** Build one of the built-in templates. `nameOverride` is the typed name, if any. */
  onUseTemplate: (templateId: string, nameOverride: string) => void;
};

/**
 * Collects a program name plus an optional description, and offers either an
 * empty program or an AI-generated 7-day cycle built from that description.
 */
export default function NewProgramModal({
  visible,
  aiConfigured,
  busy,
  onCancel,
  onCreateEmpty,
  onGenerate,
  onUseTemplate,
}: Props) {
  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    if (visible) {
      setName('');
      setMemo('');
    }
  }, [visible]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !busy;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={busy ? () => {} : onCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={busy ? undefined : onCancel}
        />
        <View style={styles.card}>
          <Text style={styles.title}>New program</Text>

          <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Upper/Lower 4-day"
              placeholderTextColor={colors.placeholder}
              editable={!busy}
              autoFocus
            />

            <Text style={styles.label}>What do you want? (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={memo}
              onChangeText={setMemo}
              placeholder={
                'e.g. 4 days a week, upper/lower. Focus on shoulders and back. No barbell squats — bad knees. Keep sessions under an hour.'
              }
              placeholderTextColor={colors.placeholder}
              editable={!busy}
              multiline
            />

            <Text style={styles.hint}>
              {aiConfigured
                ? 'AI builds the 7-day cycle from your notes using exercises already in the app. You can edit everything afterward.'
                : 'Add an Anthropic API key in Settings to generate a program with AI. You can still build one by hand or start from a template.'}
            </Text>

            {PROGRAM_TEMPLATES.length > 0 ? (
              <View style={styles.templateSection}>
                <Text style={styles.label}>Or start from a template</Text>
                {PROGRAM_TEMPLATES.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={styles.templateRow}
                    disabled={busy}
                    onPress={() => onUseTemplate(t.id, trimmedName)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.templateName}>{t.name}</Text>
                      <Text style={styles.templateTagline}>{t.tagline}</Text>
                    </View>
                    <Text style={styles.templateChevron}>›</Text>
                  </TouchableOpacity>
                ))}
                <Text style={styles.hint}>
                  Templates are built in — no API key needed. Fully editable once created.
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.busyText}>Designing your program…</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={busy}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={[styles.secondaryBtn, !canSubmit && styles.btnDisabled]}
              disabled={!canSubmit}
              onPress={() => onCreateEmpty(trimmedName)}
            >
              <Text style={styles.secondaryText}>Empty</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, (!canSubmit || !aiConfigured) && styles.btnDisabled]}
              disabled={!canSubmit || !aiConfigured}
              onPress={() => onGenerate(trimmedName, memo)}
            >
              <Text style={styles.primaryText}>✨ Generate</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    zIndex: 1,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 4,
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
    marginBottom: 10,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  hint: { color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginBottom: 4 },

  templateSection: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 8,
  },
  templateName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  templateTagline: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  templateChevron: { color: colors.accent, fontSize: 18, fontWeight: '700' },

  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  busyText: { color: colors.textSecondary, fontSize: 13 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  cancelBtn: { paddingHorizontal: 10, paddingVertical: 9 },
  cancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  secondaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  secondaryText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  primaryText: { color: '#000', fontSize: 13, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
});
