import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import type { FreestyleJob } from '@/lib/stores/useJobsStore';

interface Props {
  job: FreestyleJob;
}

const STEP_LABELS: Record<string, string> = {
  queued: 'Waiting in queue...',
  extracting: 'Extracting documents...',
  retrieving: 'Searching clinical guidelines...',
  generating: 'Generating H&P note...',
  finalizing: 'Finalizing and saving...',
  complete: 'Note ready!',
  failed: 'Generation failed',
};

export default function JobProgressCard({ job }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);

  const isActive = !['complete', 'failed'].includes(job.status);
  const isComplete = job.status === 'complete';
  const isFailed = job.status === 'failed';

  const progressColor = isFailed
    ? colors.recording
    : isComplete
      ? colors.accent
      : colors.tint;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        {isActive && <ActivityIndicator size="small" color={colors.tint} />}
        {isComplete && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
        {isFailed && <Ionicons name="alert-circle" size={20} color={colors.recording} />}
        <Text style={[styles.title, { color: progressColor }]}>
          {isComplete ? 'H&P Ready' : isFailed ? 'Generation Failed' : 'Generating H&P'}
        </Text>
      </View>

      {/* Step label */}
      <Text style={[styles.stepText, { color: colors.textSecondary }]}>
        {STEP_LABELS[job.status] || job.currentStep || 'Processing...'}
      </Text>

      {/* Progress bar */}
      {isActive && (
        <View style={[styles.progressBg, { backgroundColor: colors.surfaceSecondary }]}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                backgroundColor: progressColor,
                width: `${job.progress}%`,
              },
            ]}
          />
        </View>
      )}

      {/* Percentage */}
      {isActive && (
        <Text style={[styles.pctText, { color: colors.textTertiary }]}>
          {job.progress}%
        </Text>
      )}

      {/* Error */}
      {isFailed && job.error && (
        <Text style={[styles.errorText, { color: colors.recording }]}>
          {job.error}
        </Text>
      )}

      {/* Patient name */}
      {job.patientName && (
        <View style={styles.patientRow}>
          <Ionicons name="person-outline" size={12} color={colors.textTertiary} />
          <Text style={[styles.patientText, { color: colors.textTertiary }]}>
            {job.patientName}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  stepText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  progressBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  pctText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    textAlign: 'right',
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  patientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  patientText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
