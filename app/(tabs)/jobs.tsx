import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Platform, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useJobsStore, selectRecentJobs, selectActiveJobs, type FreestyleJob, type JobStatus } from '@/lib/stores/useJobsStore';

function getStatusConfig(status: JobStatus, colors: ReturnType<typeof useThemeColors>) {
  switch (status) {
    case 'queued':
      return { label: 'Queued', color: colors.textTertiary, icon: 'time-outline' as const, progress: '0%' };
    case 'extracting':
      return { label: 'Extracting', color: colors.warning, icon: 'document-text-outline' as const, progress: '20%' };
    case 'retrieving':
      return { label: 'Retrieving', color: colors.warning, icon: 'search-outline' as const, progress: '40%' };
    case 'generating':
      return { label: 'Generating', color: colors.tint, icon: 'sparkles-outline' as const, progress: '70%' };
    case 'finalizing':
      return { label: 'Finalizing', color: colors.tint, icon: 'checkmark-circle-outline' as const, progress: '95%' };
    case 'complete':
      return { label: 'Complete', color: colors.accent, icon: 'checkmark-circle' as const, progress: '100%' };
    case 'failed':
      return { label: 'Failed', color: colors.recording, icon: 'alert-circle' as const, progress: '—' };
    default:
      return { label: 'Unknown', color: colors.textTertiary, icon: 'help-circle-outline' as const, progress: '—' };
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / (1000 * 60));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function JobCard({ job, colors }: { job: FreestyleJob; colors: ReturnType<typeof useThemeColors> }) {
  const status = getStatusConfig(job.status, colors);
  const isActive = !['complete', 'failed'].includes(job.status);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.jobCard,
        {
          backgroundColor: colors.surface,
          borderColor: isActive ? `${status.color}40` : colors.border,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {/* Status bar */}
      <View style={[styles.statusBar, { backgroundColor: status.color }]} />

      <View style={styles.jobContent}>
        <View style={styles.jobTopRow}>
          <View style={[styles.statusChip, { backgroundColor: `${status.color}18` }]}>
            <Ionicons name={status.icon} size={12} color={status.color} />
            <Text style={[styles.statusChipText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={[styles.jobTime, { color: colors.textTertiary }]}>
            {formatTime(job.createdAt)}
          </Text>
        </View>

        {job.patientName && (
          <Text style={[styles.jobPatient, { color: colors.text }]} numberOfLines={1}>
            {job.patientName}
          </Text>
        )}

        {/* Progress bar for active jobs */}
        {isActive && (
          <View style={[styles.progressBg, { backgroundColor: colors.surfaceSecondary }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: status.color, width: `${job.progress}%` },
              ]}
            />
          </View>
        )}

        {job.error && (
          <Text style={[styles.errorText, { color: colors.recording }]} numberOfLines={2}>
            {job.error}
          </Text>
        )}
      </View>

      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} style={{ marginRight: 14 }} />
    </Pressable>
  );
}

export default function JobsDashboard() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const jobsMap = useJobsStore((s) => s.jobs);
  const jobs = useMemo(() => selectRecentJobs(jobsMap), [jobsMap]);
  const activeJobs = useMemo(() => selectActiveJobs(jobsMap), [jobsMap]);

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const renderJob = ({ item, index }: { item: FreestyleJob; index: number }) => (
    <Animated.View entering={FadeInDown.duration(300).delay(index * 50)}>
      <JobCard job={item} colors={colors} />
    </Animated.View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 16 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Jobs</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {activeJobs.length > 0
            ? `${activeJobs.length} active · ${jobs.length} total`
            : `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`}
        </Text>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJob}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Platform.OS === 'web' ? 84 + 34 : insets.bottom + 100 },
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Animated.View entering={FadeIn.duration(400)} style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="sparkles-outline" size={40} color={colors.textTertiary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
              No jobs yet
            </Text>
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
              Generate an H&P note from the Freestyle tab to see your jobs here.
            </Text>
          </Animated.View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
  },
  listContent: {
    paddingHorizontal: 20,
  },
  separator: {
    height: 8,
  },
  // Job card
  jobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  statusBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  jobContent: {
    flex: 1,
    padding: 13,
    gap: 6,
  },
  jobTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusChipText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  jobTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  jobPatient: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  progressBg: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  // Empty
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
});
