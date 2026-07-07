import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import {
  getCloudSyncStatus,
  saveCloudSyncConfig,
  clearCloudSyncConfig,
  backupToCloud,
  restoreFromCloud,
  getEffectiveServiceAccountJson,
  CloudSyncStatus,
} from '../services/cloudBackup';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { AppConfirmModal, AppNoticeModal } from './AppModalDialogs';

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * "Cloud backup" section for the Home screen settings: configure the GCS
 * bucket + service account key, back up manually, and restore from the bucket.
 */
export default function CloudSyncSettings() {
  const [status, setStatus] = useState<CloudSyncStatus>({
    configured: false,
    source: null,
    bucket: null,
    lastBackupAt: null,
    pending: false,
  });
  const [configOpen, setConfigOpen] = useState(false);
  const [bucketInput, setBucketInput] = useState('');
  const [saKeyInput, setSaKeyInput] = useState('');
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  const refresh = useCallback(() => {
    setStatus(getCloudSyncStatus());
  }, []);

  useFocusEffect(refresh);

  function openConfig() {
    const current = getCloudSyncStatus();
    setBucketInput(current.bucket ?? '');
    setSaKeyInput('');
    setConfigOpen(true);
  }

  function handleSaveConfig() {
    try {
      saveCloudSyncConfig(bucketInput, saKeyInput);
      setConfigOpen(false);
      refresh();
      setNotice({
        title: 'Cloud sync configured',
        message: 'Your data will be backed up to the bucket after every finished workout.',
      });
    } catch (e) {
      setNotice({ title: 'Invalid configuration', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleBackupNow() {
    setBusy('backup');
    try {
      await backupToCloud();
      refresh();
      setNotice({ title: 'Backup complete', message: 'Your data was uploaded to the bucket.' });
    } catch (e) {
      setNotice({ title: 'Backup failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    if (useWorkoutStore.getState().activeSessionId) {
      setNotice({
        title: 'Workout in progress',
        message: 'Finish or discard your current workout before restoring from the cloud.',
      });
      return;
    }
    setBusy('restore');
    try {
      const info = await restoreFromCloud();
      useWorkoutStore.getState().loadSettings();
      refresh();
      setNotice({
        title: 'Restore complete',
        message: `Restored backup from ${formatTimestamp(info.exportedAt)} (${info.sessionCount} workouts, ${info.setCount} sets).`,
      });
    } catch (e) {
      setNotice({ title: 'Restore failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const sourceLabel = status.source === 'built-in' ? ' (built into app)' : '';
  const statusText = !status.configured
    ? 'Not configured. Add a GCS bucket and service account key to back up your data.'
    : status.pending
      ? `Bucket: ${status.bucket}${sourceLabel}. Last backup failed — will retry after the next workout.`
      : `Bucket: ${status.bucket}${sourceLabel}. Last backup: ${formatTimestamp(status.lastBackupAt)}.`;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Cloud backup (GCS)</Text>
          <Text style={styles.hint}>{statusText}</Text>
        </View>
        {busy ? <ActivityIndicator color={colors.accent} size="small" /> : null}
      </View>
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={openConfig} disabled={busy !== null}>
          <Text style={styles.secondaryBtnText}>{status.configured ? 'Reconfigure' : 'Configure'}</Text>
        </TouchableOpacity>
        {status.configured ? (
          <>
            <TouchableOpacity
              style={[styles.secondaryBtn, busy !== null && styles.btnDisabled]}
              onPress={handleBackupNow}
              disabled={busy !== null}
            >
              <Text style={styles.secondaryBtnText}>Back up now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, busy !== null && styles.btnDisabled]}
              onPress={() => setRestoreConfirmOpen(true)}
              disabled={busy !== null}
            >
              <Text style={styles.restoreBtnText}>Restore…</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>

      {/* Config modal */}
      <Modal visible={configOpen} animationType="fade" transparent onRequestClose={() => setConfigOpen(false)}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setConfigOpen(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Cloud backup setup</Text>
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalHint}>
                Create a GCS bucket and a service account with Storage Object Admin on that
                bucket only, then paste the bucket name and the service account's JSON key
                below. The key is stored only on this device.
              </Text>
              <Text style={styles.fieldLabel}>Bucket name</Text>
              <TextInput
                style={styles.input}
                value={bucketInput}
                onChangeText={setBucketInput}
                placeholder="my-workout-backups"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.fieldLabel}>Service account key (JSON)</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={saKeyInput}
                onChangeText={setSaKeyInput}
                placeholder={status.configured ? 'Paste to replace the saved key' : '{ "type": "service_account", ... }'}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
            </ScrollView>
            <View style={styles.modalActions}>
              {status.source === 'in-app' ? (
                <TouchableOpacity
                  style={styles.disableBtn}
                  onPress={() => {
                    clearCloudSyncConfig();
                    setConfigOpen(false);
                    refresh();
                  }}
                >
                  <Text style={styles.disableBtnText}>Disable</Text>
                </TouchableOpacity>
              ) : null}
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfigOpen(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  (!bucketInput.trim() || (!saKeyInput.trim() && !status.configured)) && styles.btnDisabled,
                ]}
                disabled={!bucketInput.trim() || (!saKeyInput.trim() && !status.configured)}
                onPress={() => {
                  // Keep the existing key when reconfiguring only the bucket.
                  if (!saKeyInput.trim() && status.configured) {
                    try {
                      saveCloudSyncConfig(bucketInput, requireExistingKey());
                      setConfigOpen(false);
                      refresh();
                    } catch (e) {
                      setNotice({ title: 'Invalid configuration', message: String(e) });
                    }
                    return;
                  }
                  handleSaveConfig();
                }}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <AppConfirmModal
        visible={restoreConfirmOpen}
        title="Restore from cloud?"
        message="This replaces ALL data on this device (workouts, history, programs, settings) with the latest backup from the bucket. This cannot be undone."
        cancelText="Cancel"
        confirmText="Restore"
        confirmVariant="danger"
        onCancel={() => setRestoreConfirmOpen(false)}
        onConfirm={() => {
          setRestoreConfirmOpen(false);
          handleRestore();
        }}
      />

      <AppNoticeModal
        visible={notice !== null}
        title={notice?.title ?? ''}
        message={notice?.message ?? ''}
        onClose={() => setNotice(null)}
      />
    </View>
  );
}

function requireExistingKey(): string {
  const key = getEffectiveServiceAccountJson();
  if (!key) throw new Error('No saved service account key. Paste the JSON key.');
  return key;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  restoreBtnText: { color: '#D97777', fontSize: 12, fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },

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
  fieldLabel: {
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
    marginBottom: 12,
  },
  inputMultiline: { minHeight: 120, textAlignVertical: 'top', fontSize: 11 },
  modalActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  disableBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  disableBtnText: { color: '#D97777', fontWeight: '600', fontSize: 13 },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  saveBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },
});
