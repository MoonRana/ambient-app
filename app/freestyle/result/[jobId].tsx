import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useJobsStore } from '@/lib/stores/useJobsStore';
import { useJobRealtime } from '@/lib/hooks/useJobRealtime';
import { getJobStatus } from '@/lib/api/freestyle';
import JobProgressCard from '@/components/freestyle/JobProgressCard';
import NoteChatDrawer from '@/components/freestyle/NoteChatDrawer';

// ── SOAP Section Card (reused pattern from review.tsx) ───────────────────────

function NoteSection({
  label, content, colors, delay,
}: {
  label: string; content: string; colors: any; delay: number;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(delay)}
      style={[soapStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[soapStyles.label, { color: colors.tint }]}>{label}</Text>
      <Text style={[soapStyles.text, { color: colors.text }]}>{content}</Text>
    </Animated.View>
  );
}

const soapStyles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 18, gap: 10 },
  label: { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 1.5 },
  text: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 24 },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNote(note: string) {
  const sections: { label: string; content: string }[] = [];
  // Try to parse structured sections from the note
  const sectionHeaders = [
    { pattern: /(?:^|\n)(HISTORY OF PRESENT ILLNESS|HPI)[:\n]/i, label: 'History of Present Illness' },
    { pattern: /(?:^|\n)(REVIEW OF SYSTEMS|ROS)[:\n]/i, label: 'Review of Systems' },
    { pattern: /(?:^|\n)(PHYSICAL EXAM(?:INATION)?|PE)[:\n]/i, label: 'Physical Examination' },
    { pattern: /(?:^|\n)(ASSESSMENT(?:\s*(?:&|AND)\s*PLAN)?)[:\n]/i, label: 'Assessment & Plan' },
    { pattern: /(?:^|\n)(PLAN)[:\n]/i, label: 'Plan' },
    { pattern: /(?:^|\n)(SUBJECTIVE)[:\n]/i, label: 'Subjective' },
    { pattern: /(?:^|\n)(OBJECTIVE)[:\n]/i, label: 'Objective' },
    { pattern: /(?:^|\n)(ASSESSMENT)[:\n]/i, label: 'Assessment' },
    { pattern: /(?:^|\n)(FOLLOW[- ]?UP)[:\n]/i, label: 'Follow-Up' },
  ];

  // If no structured sections found, return the whole note as one block
  let hasStructure = sectionHeaders.some((s) => s.pattern.test(note));

  if (!hasStructure) {
    return [{ label: 'Clinical Note', content: note.trim() }];
  }

  // Split by known headers
  const lines = note.split('\n');
  let currentLabel = 'Overview';
  let currentContent: string[] = [];

  for (const line of lines) {
    let matched = false;
    for (const header of sectionHeaders) {
      if (header.pattern.test(line)) {
        if (currentContent.length > 0) {
          sections.push({ label: currentLabel, content: currentContent.join('\n').trim() });
        }
        currentLabel = header.label;
        currentContent = [];
        matched = true;
        break;
      }
    }
    if (!matched) {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    sections.push({ label: currentLabel, content: currentContent.join('\n').trim() });
  }

  return sections.filter((s) => s.content.length > 0);
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function FreestyleResultScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();

  const localJob = useJobsStore((s) => (jobId ? s.getJob(jobId) : undefined));
  const updateJob = useJobsStore((s) => s.updateJob);
  const [note, setNote] = useState(localJob?.resultNote || '');
  const [loading, setLoading] = useState(!localJob?.resultNote);
  const [copied, setCopied] = useState(false);

  // Subscribe to real-time updates
  useJobRealtime(jobId || null);

  // Sync note from job store
  useEffect(() => {
    if (localJob?.resultNote && !note) {
      setNote(localJob.resultNote);
      setLoading(false);
    }
  }, [localJob?.resultNote]);

  // Fetch from server if we don't have the result locally
  useEffect(() => {
    if (jobId && !localJob?.resultNote) {
      fetchJob();
    }
  }, [jobId]);

  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const data = await getJobStatus(jobId);
      if (data.result_note) {
        setNote(data.result_note);
        updateJob(jobId, {
          status: data.status as any,
          progress: data.progress,
          resultNote: data.result_note,
          error: data.error || undefined,
          completedAt: data.completed_at ? new Date(data.completed_at).getTime() : undefined,
        });
      }
    } catch (e: any) {
      console.error('Failed to fetch job:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const handleCopy = () => {
    if (!note) return;
    // RN Clipboard deprecated, use @react-native-clipboard/clipboard or inline
    try {
      const { Clipboard } = require('react-native');
      Clipboard.setString(note);
    } catch {
      // Fallback for web / missing clipboard
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleNoteUpdate = useCallback((updatedNote: string) => {
    setNote(updatedNote);
    if (jobId) {
      updateJob(jobId, { resultNote: updatedNote });
    }
  }, [jobId, updateJob]);

  const sections = note ? parseNote(note) : [];
  const isComplete = localJob?.status === 'complete';
  const isActive = localJob && !['complete', 'failed'].includes(localJob.status);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
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

        <View style={[styles.titlePill, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="document-text-outline" size={14} color={colors.tint} />
          <Text style={[styles.titlePillText, { color: colors.text }]}>H&P Note</Text>
        </View>

        {isComplete && (
          <Pressable
            onPress={handleCopy}
            hitSlop={12}
            style={({ pressed }) => [
              styles.copyBtn,
              {
                backgroundColor: copied ? `${colors.accent}15` : colors.surfaceSecondary,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={18}
              color={copied ? colors.accent : colors.text}
            />
          </Pressable>
        )}
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Job progress card for active jobs */}
        {isActive && localJob && (
          <JobProgressCard job={localJob} />
        )}

        {loading && !isActive && (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={colors.tint} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading result...
            </Text>
          </View>
        )}

        {/* Note sections */}
        {sections.length > 0 && (
          <Animated.View entering={FadeIn.duration(500)} style={styles.sectionsContainer}>
            {localJob?.patientName && (
              <Animated.View
                entering={FadeInDown.duration(300)}
                style={[styles.patientBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={[styles.patientIcon, { backgroundColor: `${colors.tint}18` }]}>
                  <Ionicons name="person" size={18} color={colors.tint} />
                </View>
                <Text style={[styles.patientName, { color: colors.text }]}>
                  {localJob.patientName}
                </Text>
              </Animated.View>
            )}

            {sections.map((section, i) => (
              <NoteSection
                key={i}
                label={section.label}
                content={section.content}
                colors={colors}
                delay={i * 80}
              />
            ))}
          </Animated.View>
        )}

        {/* Error state */}
        {localJob?.status === 'failed' && localJob.error && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={32} color={colors.recording} />
            <Text style={[styles.errorTitle, { color: colors.recording }]}>
              Generation Failed
            </Text>
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>
              {localJob.error}
            </Text>
          </Animated.View>
        )}
      </ScrollView>

      {/* Chat drawer for refinement (only when note is available) */}
      {isComplete && note && (
        <NoteChatDrawer
          jobId={jobId!}
          currentNote={note}
          onNoteUpdate={handleNoteUpdate}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  titlePillText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  copyBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 14,
  },
  loadingState: {
    alignItems: 'center',
    gap: 16,
    paddingTop: 60,
  },
  loadingText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  sectionsContainer: {
    gap: 12,
  },
  patientBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  patientIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patientName: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  errorContainer: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  errorTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  errorText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
});
