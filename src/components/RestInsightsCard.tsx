import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { getRestInsightsForExercise, formatRest } from '../utils/restAnalysis';

interface Props {
  exerciseId: number;
  /** Machine silo the stats are scoped to; undefined = all machines. */
  brand?: string | null;
  /** Rest currently programmed for the exercise, seconds. */
  currentRestSeconds: number;
  /** Reload key — bump to recompute after new sets are logged. */
  reloadKey?: number;
  /** Applies the suggested rest as the exercise default. */
  onApplySuggestion?: (seconds: number) => void;
}

/** Colour a performance delta: gains green, losses red, flat neutral. */
function deltaColor(deltaPct: number): string {
  if (deltaPct >= 0.5) return colors.success;
  if (deltaPct <= -0.5) return colors.danger;
  return colors.textSecondary;
}

export default function RestInsightsCard({
  exerciseId,
  brand,
  currentRestSeconds,
  reloadKey = 0,
  onApplySuggestion,
}: Props) {
  const insights = useMemo(
    () => getRestInsightsForExercise(exerciseId, brand),
    [exerciseId, brand, reloadKey]
  );

  const populated = insights.buckets.filter((b) => b.n > 0);
  const maxN = Math.max(1, ...populated.map((b) => b.n));
  const suggestion = insights.suggestion;
  const alreadyMatches =
    suggestion != null && Math.abs(suggestion.seconds - currentRestSeconds) <= 10;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>REST RESPONSE</Text>

      {insights.totalPairs === 0 ? (
        <Text style={styles.emptyText}>
          No timed sets yet. Time between sets is measured automatically as you log them — come
          back after a few sessions.
        </Text>
      ) : (
        <>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{insights.totalPairs}</Text>
              <Text style={styles.summaryLabel}>Timed sets</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                {insights.medianRestSeconds != null ? formatRest(insights.medianRestSeconds) : '—'}
              </Text>
              <Text style={styles.summaryLabel}>Typical rest</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{formatRest(currentRestSeconds)}</Text>
              <Text style={styles.summaryLabel}>Programmed</Text>
            </View>
          </View>

          <Text style={styles.subheading}>NEXT-SET PERFORMANCE BY REST TAKEN</Text>
          {populated.map((bucket) => (
            <View key={bucket.label} style={styles.bucketRow}>
              <Text style={styles.bucketLabel}>{bucket.label}</Text>
              <View style={styles.bucketBarTrack}>
                <View
                  style={[
                    styles.bucketBarFill,
                    {
                      width: `${(bucket.n / maxN) * 100}%`,
                      backgroundColor: bucket.qualifies ? colors.accent + '55' : colors.border,
                    },
                  ]}
                />
                <Text style={styles.bucketN}>{bucket.n}</Text>
              </View>
              <Text style={[styles.bucketDelta, { color: deltaColor(bucket.meanDeltaPct) }]}>
                {bucket.meanDeltaPct >= 0 ? '+' : ''}
                {bucket.meanDeltaPct.toFixed(1)}%
              </Text>
            </View>
          ))}
          <Text style={styles.legend}>
            Change in estimated 1RM from one set to the next. Rest is measured between logging two
            sets, so it covers the set itself as well as the break.
          </Text>

          {suggestion ? (
            <View style={styles.suggestionBox}>
              <View style={styles.suggestionHeader}>
                <Text style={styles.suggestionLabel}>SUGGESTED REST</Text>
                <Text style={styles.confidence}>{suggestion.confidence} confidence</Text>
              </View>
              <Text style={styles.suggestionValue}>{formatRest(suggestion.seconds)}</Text>
              <Text style={styles.suggestionReason}>{suggestion.reason}</Text>
              {alreadyMatches ? (
                <Text style={styles.matchesText}>Your programmed rest already matches this.</Text>
              ) : onApplySuggestion ? (
                <TouchableOpacity
                  style={styles.applyBtn}
                  onPress={() => onApplySuggestion(suggestion.seconds)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.applyBtnText}>
                    Use {formatRest(suggestion.seconds)} for this exercise
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <Text style={styles.insufficientText}>{insights.insufficientReason}</Text>
          )}
        </>
      )}
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
  cardTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 14,
  },
  emptyText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },

  summaryRow: { flexDirection: 'row', marginBottom: 18 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { color: colors.text, fontSize: 20, fontWeight: '700' },
  summaryLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },

  subheading: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  bucketRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  bucketLabel: { color: colors.textSecondary, fontSize: 12, width: 74 },
  bucketBarTrack: {
    flex: 1,
    height: 20,
    borderRadius: 4,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
  },
  bucketBarFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
  bucketN: { color: colors.textSecondary, fontSize: 11, marginLeft: 6 },
  bucketDelta: { fontSize: 13, fontWeight: '700', width: 56, textAlign: 'right' },

  legend: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },

  suggestionBox: {
    marginTop: 16,
    backgroundColor: colors.accent + '14',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent + '44',
    padding: 14,
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestionLabel: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  confidence: { color: colors.textSecondary, fontSize: 10, textTransform: 'capitalize' },
  suggestionValue: { color: colors.accent, fontSize: 30, fontWeight: '700', marginVertical: 4 },
  suggestionReason: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  matchesText: { color: colors.textTertiary, fontSize: 12, marginTop: 10 },
  applyBtn: {
    marginTop: 12,
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  applyBtnText: { color: colors.background, fontSize: 13, fontWeight: '700' },

  insufficientText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
    fontStyle: 'italic',
  },
});
