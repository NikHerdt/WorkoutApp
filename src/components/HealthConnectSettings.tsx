import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import {
  connectHealthConnect,
  disconnectHealthConnect,
  getHealthConnectStatus,
  getSdkAvailability,
  getHealthPermissions,
  requestMissingPermissions,
  isHealthConnectSupported,
  openHealthConnectSettings,
  syncBodyWeightNow,
  HealthConnectStatus,
  SdkAvailability,
  HealthPermissions,
} from '../services/healthConnect';
import { getNutritionDayCount } from '../db/database';
import { AppNoticeModal } from './AppModalDialogs';

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
 * "Health Connect" section for the Home screen settings.
 *
 * Body weight goes out to Health Connect, which is what Cronometer imports for
 * calorie tracking; weights logged elsewhere (a smart scale) come back in.
 */
export default function HealthConnectSettings() {
  const [status, setStatus] = useState<HealthConnectStatus>({ enabled: false, lastSyncAt: null });
  const [availability, setAvailability] = useState<SdkAvailability | null>(null);
  const [permissions, setPermissions] = useState<HealthPermissions>({
    read: false,
    write: false,
    nutrition: false,
    history: false,
  });
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [nutritionDays, setNutritionDays] = useState(0);

  const refresh = useCallback(() => {
    setStatus(getHealthConnectStatus());
    setNutritionDays(getNutritionDayCount());
    if (!isHealthConnectSupported()) {
      setAvailability('unsupported-platform');
      return;
    }
    getSdkAvailability()
      .then(setAvailability)
      .catch(() => setAvailability('unavailable'));
    if (getHealthConnectStatus().enabled) {
      getHealthPermissions()
        .then(setPermissions)
        .catch(() => setPermissions({ read: false, write: false, nutrition: false, history: false }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  async function handleConnect() {
    setBusy('connect');
    try {
      const granted = await connectHealthConnect();
      setPermissions(granted);
      refresh();
      if (!granted.read && !granted.write) {
        setNotice({
          title: 'No permissions granted',
          message: 'Nothing will sync until weight access is allowed in Health Connect.',
        });
        return;
      }
      const lines: string[] = [];
      lines.push(
        granted.write
          ? 'Body weight you log will be written to Health Connect. In Cronometer, go to More → Connect Apps & Devices → Health Connect to pull it in.'
          : 'Weight write access was not granted, so nothing will reach Cronometer.'
      );
      lines.push(
        granted.nutrition
          ? 'Calories and macros will be imported from Cronometer.'
          : 'Nutrition access was not granted — the energy balance and TDEE stats stay hidden.'
      );
      setNotice({ title: 'Health Connect connected', message: lines.join('\n\n') });
    } catch (e) {
      setNotice({ title: 'Could not connect', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function handleSync() {
    setBusy('sync');
    try {
      const result = await syncBodyWeightNow();
      refresh();
      const parts = [`${result.pushed} weights sent`, `${result.pulled} imported`];
      if (result.skippedExisting > 0) {
        parts.push(`${result.skippedExisting} skipped (already logged here)`);
      }
      if (permissions.nutrition) {
        parts.push(`${result.nutritionDays} days of nutrition`);
      }
      setNotice({ title: 'Sync complete', message: `${parts.join(', ')}.` });
    } catch (e) {
      setNotice({ title: 'Sync failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function handleGrantMissing() {
    setBusy('connect');
    try {
      const granted = await requestMissingPermissions();
      setPermissions(granted);
      refresh();
    } catch (e) {
      setNotice({ title: 'Could not update permissions', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  function handleDisconnect() {
    disconnectHealthConnect();
    refresh();
    setNotice({
      title: 'Disconnected',
      message:
        'Body weight will no longer sync. To revoke the permission itself, open Health Connect.',
    });
  }

  // Nothing here is actionable off Android — don't show a dead section.
  if (Platform.OS !== 'android') return null;

  let statusText: string;
  if (availability === 'unavailable') {
    statusText = 'Health Connect isn’t available on this device. Install it from the Play Store to sync body weight with Cronometer.';
  } else if (availability === 'update-required') {
    statusText = 'Health Connect needs updating on this device before it can be used.';
  } else if (!status.enabled) {
    statusText = 'Not connected. Sync body weight with Cronometer and other health apps.';
  } else {
    const direction =
      permissions.read && permissions.write
        ? 'Weight: two-way'
        : permissions.write
          ? 'Weight: sending only'
          : permissions.read
            ? 'Weight: receiving only'
            : 'Weight: no access';
    // Deliberately reports stored days rather than the history permission:
    // that permission cannot be read back reliably, so claiming "last 30 days
    // only" would often be a lie. Days actually imported is a fact.
    const nutrition = permissions.nutrition
      ? `nutrition on (${nutritionDays} days stored)`
      : 'nutrition off';
    statusText = `${direction}, ${nutrition}. Last sync: ${formatTimestamp(status.lastSyncAt)}.`;
  }

  const unusable = availability === 'unavailable' || availability === 'update-required';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Health Connect (body weight)</Text>
          <Text style={styles.hint}>{statusText}</Text>
        </View>
        {busy ? <ActivityIndicator color={colors.accent} size="small" /> : null}
      </View>

      <View style={styles.actionsRow}>
        {!status.enabled ? (
          <TouchableOpacity
            style={[styles.secondaryBtn, (busy !== null || unusable) && styles.btnDisabled]}
            onPress={handleConnect}
            disabled={busy !== null || unusable}
          >
            <Text style={styles.secondaryBtnText}>Connect</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.secondaryBtn, busy !== null && styles.btnDisabled]}
              onPress={handleSync}
              disabled={busy !== null}
            >
              <Text style={styles.secondaryBtnText}>Sync now</Text>
            </TouchableOpacity>
            {!permissions.nutrition ? (
              <TouchableOpacity
                style={[styles.secondaryBtn, busy !== null && styles.btnDisabled]}
                onPress={handleGrantMissing}
                disabled={busy !== null}
              >
                <Text style={styles.grantBtnText}>Grant missing</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.secondaryBtn, busy !== null && styles.btnDisabled]}
              onPress={() => openHealthConnectSettings()}
              disabled={busy !== null}
            >
              <Text style={styles.secondaryBtnText}>Permissions</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, busy !== null && styles.btnDisabled]}
              onPress={handleDisconnect}
              disabled={busy !== null}
            >
              <Text style={styles.disconnectBtnText}>Disconnect</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {status.enabled ? (
        <Text style={styles.footnote}>
          Weights you log here are sent automatically. Imported weights only fill days you haven’t
          logged yourself. Calories and macros come from Cronometer and drive the energy balance
          stats on the Stats tab.
        </Text>
      ) : null}

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
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  secondaryBtnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  disconnectBtnText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  grantBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },
  footnote: { color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 12 },
});
