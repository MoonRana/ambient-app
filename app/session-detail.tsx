import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  ScrollView, Alert, Share, Clipboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/constants/colors';
import { useSessions, AmbientSession } from '@/lib/session-context';
import { useEffectiveColorScheme } from '@/lib/settings-context';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatFullDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }) + ' at ' + date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getResumeActions(session: AmbientSession): Array<{
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
  route: string;
  primary?: boolean;
}> {
  const actions: ReturnType<typeof getResumeActions> = [];

  if (session.soapNote && session.savedToCloud) {
    // Fully complete — no actions
    return actions;
  }

  // Can always add more documents
  if (!session.soapNote) {
    actions.push({
      label: 'Add Documents',
      icon: 'camera-outline',
      description: 'Capture more insurance cards, lab results, or clinical docs.',
      route: '/(recording)/capture',
    });
  }

  // Can add recording if none exists yet
  if (!session.recordingUri && !session.soapNote) {
    actions.push({
      label: 'Add Recording',
      icon: 'mic-outline',
      description: 'Record the patient encounter to generate a richer note.',
      route: '/(recording)/record',
      primary: true,
    });
  }

  // Can generate note if has recording or images
  if (session.recordingUri || session.capturedImages.length > 0) {
    if (!session.soapNote) {
      actions.push({
        label: 'Generate Note',
        icon: 'sparkles',
        description: 'Process recording and documents into a SOAP note.',
        route: '/(recording)/review',
        primary: true,
      });
    }
  }

  // Retry on error / stuck processing
  if (session.status === 'error' || session.status === 'processing') {
    // Move to front
    actions.unshift({
      label: 'Retry Generation',
      icon: 'refresh-circle',
      description: 'Previous generation failed. Tap to retry.',
      route: '/(recording)/review',
      primary: true,
    });
  }

  // Can re-save completed note
  if (session.soapNote && !session.savedToCloud) {
    actions.push({
      label: 'Save to Cloud',
      icon: 'cloud-upload-outline',
      description: 'Save the generated SOAP note to your patient records.',
      route: '/(recording)/review',
      primary: true,
    });
  }

  return actions;
}

function buildNoteText(session: AmbientSession): string {
  if (!session.soapNote) return '';
  const { subjective, objective, assessment, plan, followUp } = session.soapNote!;
  const date = new Date(session.createdAt).toLocaleDateString();
  return [
    `SOAP NOTE — ${date}`,
    `Patient: ${session.patientInfo?.name || session.patientContext || 'Unknown'}`,
    '',
    'SUBJECTIVE',
    subjective,
    '',
    'OBJECTIVE',
    objective,
    '',
    'ASSESSMENT',
    assessment,
    '',
    'PLAN',
    plan,
    followUp ? `\nFOLLOW-UP\n${followUp}` : '',
  ].join('\n').trim();
}

export default function SessionDetailScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getSession, deleteSession, setCurrentSession, updateSession } = useSessions();
  const [copied, setCopied] = useState(false);

  const session = id ? getSession(id) : null;

  const handleDelete = () => {
    Alert.alert(
      'Delete Session',
      'Are you sure you want to delete this session? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (id) deleteSession(id);
            router.back();
          },
        },
      ],
    );
  };

  const handleResumeAction = (route: string) => {
    if (!session) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Reset error state so review screen starts fresh
    if (session.status === 'error' || session.status === 'processing') {
      updateSession(session.id, { status: 'captured', errorMessage: undefined });
    }

    setCurrentSession(getSession(session.id) ?? session);
    router.push({ pathname: route as any });
  };

  const handleShare = async () => {
    if (!session?.soapNote) return;
    const text = buildNoteText(session);
    try {
      await Share.share({ message: text, title: 'SOAP Note' });
    } catch {
      // user cancelled
    }
  };

  const handleCopy = () => {
    if (!session?.soapNote) return;
    const text = buildNoteText(session);
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  if (!session) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
          <Pressable onPress={() => router.back()} style={[styles.headerBtn, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Session not found</Text>
        </View>
      </View>
    );
  }

  const resumeActions = getResumeActions(session);
  const statusColor =
    session.status === 'completed' ? colors.accent :
      session.status === 'error' ? colors.recording :
        session.status === 'processing' ? colors.tint :
          colors.warning;

  const statusIcon: keyof typeof Ionicons.glyphMap =
    session.status === 'completed' ? 'checkmark-circle' :
      session.status === 'error' ? 'alert-circle' :
        session.status === 'processing' ? 'sync-circle' :
          'ellipsis-horizontal-circle';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.headerActions}>
          {session.soapNote && (
            <>
              <Pressable
                onPress={handleCopy}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.headerBtn,
                  { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color={copied ? colors.accent : colors.text} />
              </Pressable>
              <Pressable
                onPress={handleShare}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.headerBtn,
                  { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="share-outline" size={20} color={colors.text} />
              </Pressable>
            </>
          )}
          <Pressable
            onPress={handleDelete}
            hitSlop={12}
            style={({ pressed }) => [
              styles.headerBtn,
              { backgroundColor: colors.recordingLight, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="trash-outline" size={20} color={colors.recording} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16) + 30 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text style={[styles.dateText, { color: colors.textSecondary }]}>
            {formatFullDate(session.createdAt)}
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>Session Details</Text>
        </Animated.View>

        {/* Stats */}
        <Animated.View entering={FadeInDown.duration(400).delay(100)}>
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="time" size={22} color={colors.tint} />
              <Text style={[styles.statValue, { color: colors.text }]}>
                {formatDuration(session.recordingDuration)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Duration</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="images" size={22} color={colors.accent} />
              <Text style={[styles.statValue, { color: colors.text }]}>
                {session.capturedImages.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Documents</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name={statusIcon} size={22} color={statusColor} />
              <Text style={[styles.statValue, { color: colors.text, fontSize: 13 }]}>
                {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Status</Text>
            </View>
          </View>
        </Animated.View>

        {/* Error message banner */}
        {session.errorMessage && (
          <Animated.View
            entering={FadeInDown.duration(400).delay(120)}
            style={[styles.errorBanner, { backgroundColor: colors.recordingLight, borderColor: colors.recording }]}
          >
            <Ionicons name="alert-circle-outline" size={16} color={colors.recording} />
            <Text style={[styles.errorBannerText, { color: colors.recording }]}>{session.errorMessage}</Text>
          </Animated.View>
        )}

        {/* ── Resume / Action Buttons ── */}
        {resumeActions.length > 0 && (
          <Animated.View entering={FadeInDown.duration(400).delay(130)} style={styles.actionBtnsContainer}>
            {resumeActions.map((action, idx) => (
              <Pressable
                key={action.label}
                onPress={() => handleResumeAction(action.route)}
                style={({ pressed }) => [
                  styles.resumeBtn,
                  {
                    backgroundColor: action.primary ? colors.tint : colors.surface,
                    borderWidth: action.primary ? 0 : 1,
                    borderColor: colors.border,
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}
              >
                <Ionicons name={action.icon} size={20} color={action.primary ? '#fff' : colors.tint} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.resumeBtnTitle, !action.primary && { color: colors.text }]}>{action.label}</Text>
                  <Text style={[styles.resumeBtnSub, !action.primary && { color: colors.textSecondary }]}>{action.description}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={action.primary ? 'rgba(255,255,255,0.7)' : colors.textTertiary} />
              </Pressable>
            ))}
          </Animated.View>
        )}

        {/* Patient Info */}
        {session.patientInfo && (session.patientInfo.name || session.patientInfo.memberId) && (
          <Animated.View entering={FadeInDown.duration(400).delay(160)}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Patient</Text>
            <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {session.patientInfo.name && (
                <InfoRow icon="person-outline" label="Name" value={session.patientInfo.name} colors={colors} />
              )}
              {session.patientInfo.dateOfBirth && (
                <InfoRow icon="calendar-outline" label="DOB" value={session.patientInfo.dateOfBirth} colors={colors} />
              )}
              {session.patientInfo.payerName && (
                <InfoRow icon="business-outline" label="Insurance" value={session.patientInfo.payerName} colors={colors} />
              )}
              {session.patientInfo.memberId && (
                <InfoRow icon="card-outline" label="Member ID" value={session.patientInfo.memberId} colors={colors} />
              )}
            </View>
          </Animated.View>
        )}

        {/* Captured Images */}
        {session.capturedImages.length > 0 && (
          <Animated.View entering={FadeInDown.duration(400).delay(200)}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
              Captured Documents
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {session.capturedImages.map(img => (
                <Image
                  key={img.id}
                  source={{ uri: img.uri }}
                  style={[styles.docImage, { borderColor: colors.border }]}
                  contentFit="cover"
                />
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Patient Context */}
        {session.patientContext && (
          <Animated.View entering={FadeInDown.duration(400).delay(250)}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
              Notes / Context
            </Text>
            <View style={[styles.contextCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.contextText, { color: colors.text }]}>
                {session.patientContext}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Transcript */}
        {session.transcript && (
          <Animated.View entering={FadeInDown.duration(400).delay(280)}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Transcript</Text>
            <View style={[styles.contextCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.contextText, { color: colors.text }]}>
                {session.transcript}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* SOAP Note */}
        {session.soapNote && (
          <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.soapSection}>
            <View style={styles.soapLabelRow}>
              <Ionicons name="document-text" size={18} color={colors.accent} />
              <Text style={[styles.sectionLabel, { color: colors.textTertiary, marginBottom: 0 }]}>
                SOAP Note
              </Text>
            </View>
            {(['subjective', 'objective', 'assessment', 'plan'] as const).map((section, idx) => (
              <Animated.View
                key={section}
                entering={FadeInDown.duration(300).delay(350 + idx * 60)}
                style={[styles.soapCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[styles.soapSectionTitle, { color: colors.tint }]}>
                  {section.charAt(0).toUpperCase() + section.slice(1)}
                </Text>
                <Text style={[styles.soapText, { color: colors.text }]}>
                  {session.soapNote![section]}
                </Text>
              </Animated.View>
            ))}

            {session.soapNote.followUp && (
              <Animated.View
                entering={FadeInDown.duration(300).delay(590)}
                style={[styles.soapCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[styles.soapSectionTitle, { color: colors.tint }]}>Follow-Up</Text>
                <Text style={[styles.soapText, { color: colors.text }]}>{session.soapNote.followUp}</Text>
              </Animated.View>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({ icon, label, value, colors }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  colors: any;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={15} color={colors.textTertiary} />
      <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>{value}</Text>
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
    paddingBottom: 12,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 20,
    paddingTop: 4,
  },
  dateText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold', marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, padding: 14, borderRadius: 14,
    borderWidth: 1, alignItems: 'center', gap: 6,
  },
  statValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 8, padding: 12, borderRadius: 12, borderWidth: 1,
  },
  errorBannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  actionBtnsContainer: { gap: 8 },
  resumeBtn: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, padding: 16, borderRadius: 16,
  },
  resumeBtnTitle: {
    fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff',
  },
  resumeBtnSub: {
    fontSize: 12, fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.75)', marginTop: 2,
  },

  infoCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  infoRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', width: 72 },
  infoValue: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },

  sectionLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
  },
  docImage: {
    width: 100, height: 100, borderRadius: 12,
    borderWidth: 1, marginRight: 10,
  },
  contextCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  contextText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  soapSection: { gap: 12 },
  soapLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2,
  },
  soapCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  soapSectionTitle: {
    fontSize: 12, fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  soapText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 16, fontFamily: 'Inter_400Regular' },
});
