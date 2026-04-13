import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { initDatabase } from './src/db/database';
import AppNavigator from './src/navigation/AppNavigator';
import { useWorkoutStore } from './src/store/useWorkoutStore';
import { colors } from './src/theme/colors';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      initDatabase();
      useWorkoutStore.getState().loadSettings();
      setReady(true);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  if (error) {
    return (
      <View style={styles.loading}>
        <Text style={{ color: 'red', padding: 20 }}>DB Error: {error}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <AppNavigator />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
});
