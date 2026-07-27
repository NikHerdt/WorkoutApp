import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import {
  getAiKeySource,
  saveAiApiKey,
  clearAiApiKey,
} from '../services/aiProgramGenerator';
import { AppNoticeModal } from './AppModalDialogs';

/**
 * "AI program generation" settings row: stores the Anthropic API key used to
 * generate custom workout programs.
 */
export default function AiSettings() {
  const [source, setSource] = useState<'in-app' | 'built-in' | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  const refresh = useCallback(() => {
    setSource(getAiKeySource());
  }, []);

  useFocusEffect(refresh);

  const statusText =
    source === null
      ? 'Not configured. Add an Anthropic API key to generate programs with AI.'
      : source === 'built-in'
        ? 'Using the API key built into this build.'
        : 'API key saved on this device.';

  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>AI program generation</Text>
        <Text style={styles.hint}>{statusText}</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => {
              setKeyInput('');
              setConfigOpen(true);
            }}
          >
            <Text style={styles.secondaryBtnText}>
              {source === null ? 'Add API key' : 'Change key'}
            </Text>
          </TouchableOpacity>
          {source === 'in-app' ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                clearAiApiKey();
                refresh();
              }}
            >
              <Text style={styles.removeBtnText}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <Modal visible={configOpen} animationType="fade" transparent onRequestClose={() => setConfigOpen(false)}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setConfigOpen(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Anthropic API key</Text>
            <Text style={styles.modalHint}>
              Create a key at console.anthropic.com → API keys, then paste it here. It is stored
              only on this device and used to generate workout programs.
            </Text>
            <TextInput
              style={styles.input}
              value={keyInput}
              onChangeText={setKeyInput}
              placeholder="sk-ant-api03-..."
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfigOpen(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, !keyInput.trim() && styles.btnDisabled]}
                disabled={!keyInput.trim()}
                onPress={() => {
                  try {
                    saveAiApiKey(keyInput);
                    setConfigOpen(false);
                    refresh();
                  } catch (e) {
                    setNotice({
                      title: 'Invalid key',
                      message: e instanceof Error ? e.message : String(e),
                    });
                  }
                }}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <AppNoticeModal
        visible={notice !== null}
        title={notice?.title ?? ''}
        message={notice?.message ?? ''}
        onClose={() => setNotice(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
  },
  label: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  hint: { color: colors.textTertiary, fontSize: 12, lineHeight: 16 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  secondaryBtn: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryBtnText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  removeBtnText: { color: '#D97777', fontSize: 12, fontWeight: '600' },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    zIndex: 1,
  },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  modalHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.accent },
  saveBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.4 },
});
