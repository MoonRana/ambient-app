import React, { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Platform, Pressable, Modal, ScrollView, Share, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { SCREENSHOT_DEMO } from '@/lib/screenshot-demo';
import { useJobsStore, selectRecentJobs, selectActiveJobs, type FreestyleJob, type JobStatus } from '@/lib/stores/useJobsStore';
import { getJobStatus } from '@/lib/api/freestyle';

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

// ── Job Card ───────────────────────────────────────────────────────────────────

function JobCard({
  job, colors, onPress,
}: {
  job: FreestyleJob;
  colors: ReturnType<typeof useThemeColors>;
  onPress: () => void;
}) {
  const status = getStatusConfig(job.status, colors);
  const isActive = !['complete', 'failed'].includes(job.status);

  return (
    <Pressable
      onPress={onPress}
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

        {job.currentStep && isActive && (
          <Text style={[styles.stepText, { color: colors.textSecondary }]} numberOfLines={1}>
            {job.currentStep}
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

        {job.status === 'complete' && (
          <Text style={[styles.tapHint, { color: colors.textTertiary }]}>
            Tap to view note
          </Text>
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

// ── Note Viewer Modal ──────────────────────────────────────────────────────────

function NoteViewerModal({
  job, visible, onClose, colors,
}: {
  job: FreestyleJob | null;
  visible: boolean;
  onClose: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const insets = useSafeAreaInsets();

  const handleCopy = async () => {
    if (!job?.resultNote) return;
    await Clipboard.setStringAsync(job.resultNote);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', 'Note copied to clipboard');
  };

  const handleShare = async () => {
    if (!job?.resultNote) return;
    try {
      await Share.share({
        message: job.resultNote,
        title: 'H&P Note',
      });
    } catch {}
  };

  if (!job) return null;
  const status = getStatusConfig(job.status, colors);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.modalHeader, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {job.status === 'complete' ? 'Generated Note' : job.status === 'failed' ? 'Job Failed' : 'Job Details'}
          </Text>
          <View style={styles.modalActions}>
            {job.resultNote && (
              <>
                <Pressable onPress={handleCopy} hitSlop={8} style={({ pressed }) => [styles.modalActionBtn, { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 }]}>
                  <Ionicons name="copy-outline" size={18} color={colors.tint} />
                </Pressable>
                <Pressable onPress={handleShare} hitSlop={8} style={({ pressed }) => [styles.modalActionBtn, { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 }]}>
                  <Ionicons name="share-outline" size={18} color={colors.tint} />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* Status chip */}
        <View style={styles.modalStatusRow}>
          <View style={[styles.statusChip, { backgroundColor: `${status.color}18` }]}>
            <Ionicons name={status.icon} size={12} color={status.color} />
            <Text style={[styles.statusChipText, { color: status.color }]}>{status.label}</Text>
          </View>
          {job.patientName && (
            <Text style={[styles.modalPatient, { color: colors.textSecondary }]}>{job.patientName}</Text>
          )}
          <Text style={[styles.modalTime, { color: colors.textTertiary }]}>{formatTime(job.createdAt)}</Text>
        </View>

        {/* Content */}
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={[styles.modalScrollContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {job.resultNote ? (
            <Text style={[styles.noteText, { color: colors.text }]} selectable>
              {job.resultNote}
            </Text>
          ) : job.error ? (
            <View style={[styles.errorCard, { backgroundColor: colors.recordingLight, borderColor: `${colors.recording}30` }]}>
              <Ionicons name="alert-circle" size={24} color={colors.recording} />
              <Text style={[styles.errorCardText, { color: colors.recording }]}>{job.error}</Text>
            </View>
          ) : (
            <View style={styles.emptyNoteState}>
              <Ionicons name="document-text-outline" size={48} color={colors.textTertiary} />
              <Text style={[styles.emptyNoteText, { color: colors.textTertiary }]}>
                {job.status === 'complete' ? 'No note content available' : 'Job is still processing...'}
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function JobsDashboard() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const jobsMap = useJobsStore((s) => s.jobs);
  const updateJob = useJobsStore((s) => s.updateJob);
  const jobs = useMemo(() => selectRecentJobs(jobsMap), [jobsMap]);
  const activeJobs = useMemo(() => selectActiveJobs(jobsMap), [jobsMap]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedJob, setSelectedJob] = useState<FreestyleJob | null>(null);

  // Poll active jobs from Supabase every 3s while screen is focused
  const pollActiveJobs = useCallback(async () => {
    if (SCREENSHOT_DEMO) return;
    const active = selectActiveJobs(useJobsStore.getState().jobs);
    if (active.length === 0) return;

    for (const job of active) {
      try {
        const fresh = await getJobStatus(job.id);
        if (fresh) {
          updateJob(job.id, {
            status: fresh.status as JobStatus,
            progress: fresh.progress,
            currentStep: fresh.current_step || undefined,
            resultNote: fresh.result_note || undefined,
            error: fresh.error || undefined,
            completedAt: fresh.completed_at ? new Date(fresh.completed_at).getTime() : undefined,
          });
        }
      } catch (e: any) {
        console.warn(`Poll error for job ${job.id}:`, e?.message);
      }
    }
  }, [updateJob]);

  useFocusEffect(
    useCallback(() => {
      pollActiveJobs();
      pollRef.current = setInterval(pollActiveJobs, 3000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }, [pollActiveJobs]),
  );

  const handleJobPress = useCallback((job: FreestyleJob) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // For completed/failed jobs, show the detail modal
    // For active jobs, also show modal (to see current step)
    setSelectedJob(job);
  }, []);

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const renderJob = ({ item, index }: { item: FreestyleJob; index: number }) => (
    <Animated.View entering={FadeInDown.duration(300).delay(index * 50)}>
      <JobCard job={item} colors={colors} onPress={() => handleJobPress(item)} />
    </Animated.View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 16 }]}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backBtn,
              { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </Pressable>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Jobs</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {activeJobs.length > 0
                ? `${activeJobs.length} active · ${jobs.length} total`
                : `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
        </View>
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

      {/* Note viewer modal */}
      <NoteViewerModal
        job={selectedJob}
        visible={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        colors={colors}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
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
  stepText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  tapHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
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
  // Modal
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 14,
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
  },
  modalActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  modalPatient: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  modalTime: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginLeft: 'auto',
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  noteText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 24,
  },
  errorCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
  },
  errorCardText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyNoteState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 16,
  },
  emptyNoteText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
});
