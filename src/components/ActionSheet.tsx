import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { colors } from '../theme/colors';

export interface ActionSheetAction {
  label: string;
  style?: 'default' | 'destructive' | 'cancel';
  onPress?: () => void;
}

interface Props {
  visible: boolean;
  title?: string;
  message?: string;
  actions: ActionSheetAction[];
  onClose: () => void;
}

export default function ActionSheet({
  visible,
  title,
  message,
  actions,
  onClose,
}: Props) {
  const mainActions = actions.filter((a) => a.style !== 'cancel');
  const cancelActions = actions.filter((a) => a.style === 'cancel');

  function handlePress(action: ActionSheetAction) {
    onClose();
    action.onPress?.();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.container}>
          {/* Main actions card */}
          <View style={styles.card}>
            {(title || message) && (
              <View style={styles.headerBlock}>
                {title ? <Text style={styles.title}>{title}</Text> : null}
                {message ? <Text style={styles.message}>{message}</Text> : null}
              </View>
            )}
            {mainActions.map((action, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.row, idx > 0 && styles.rowBorder]}
                onPress={() => handlePress(action)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.rowLabel,
                    action.style === 'destructive' && styles.rowLabelDestructive,
                  ]}
                >
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Cancel card */}
          {cancelActions.length > 0 && (
            <View style={[styles.card, styles.cancelCard]}>
              {cancelActions.map((action, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.row}
                  onPress={() => handlePress(action)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelLabel}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  container: {
    paddingHorizontal: 12,
    paddingBottom: 32,
    gap: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cancelCard: {
    backgroundColor: colors.surfaceElevated,
  },
  headerBlock: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  row: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLabel: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '600',
  },
  rowLabelDestructive: {
    color: colors.danger,
  },
  cancelLabel: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
});
