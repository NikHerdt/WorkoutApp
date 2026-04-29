import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme/colors';

type AppNoticeModalProps = {
  visible: boolean;
  title: string;
  message: string;
  buttonText?: string;
  onClose: () => void;
};

type AppConfirmModalProps = {
  visible: boolean;
  title: string;
  message: string;
  cancelText?: string;
  confirmText?: string;
  confirmVariant?: 'primary' | 'danger';
  onCancel: () => void;
  onConfirm: () => void;
};

export function AppNoticeModal({
  visible,
  title,
  message,
  buttonText = 'Got it',
  onClose,
}: AppNoticeModalProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonText}>{buttonText}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export function AppConfirmModal({
  visible,
  title,
  message,
  cancelText = 'Cancel',
  confirmText = 'Confirm',
  confirmVariant = 'danger',
  onCancel,
  onConfirm,
}: AppConfirmModalProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>{cancelText}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.confirmButton,
                confirmVariant === 'danger' ? styles.confirmButtonDanger : styles.confirmButtonPrimary,
              ]}
              onPress={onConfirm}
            >
              <Text
                style={[
                  styles.confirmButtonText,
                  confirmVariant === 'danger'
                    ? styles.confirmButtonTextOnDark
                    : styles.confirmButtonTextOnAccent,
                ]}
              >
                {confirmText}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    zIndex: 1,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  message: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 8 },
  primaryButton: {
    marginTop: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#000', fontSize: 14, fontWeight: '700' },
  actions: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  cancelButtonText: { color: colors.textSecondary, fontWeight: '600' },
  confirmButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  confirmButtonDanger: { backgroundColor: colors.danger },
  confirmButtonPrimary: { backgroundColor: colors.accent },
  confirmButtonText: { fontWeight: '700' },
  confirmButtonTextOnDark: { color: '#fff' },
  confirmButtonTextOnAccent: { color: '#000' },
});
