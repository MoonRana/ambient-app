import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, FlatList, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withSequence, Easing, FadeIn, FadeInDown, FadeInUp,
} from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions, AmbientSession } from '@/lib/session-context';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useJobsStore, selectActiveJobs, type FreestyleJob, type JobStatus } from '@/lib/stores/useJobsStore';
import { useAuth } from '@/lib/auth-context';
import { BrandMark } from '@/components/BrandLogo';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

// ── Status config for inbox items ─────────────────────────────────────────────
function getStatusConfig(status: AmbientSession['status'], colors: ReturnType<typeof useThemeColors>) {
  switch (status) {
    case 'recording':
      return { label: 'Recording', color: colors.recording, icon: 'mic' as const, showSpinner: false };
    case 'captured':
      return { label: 'Ready', color: colors.warning, icon: 'checkmark-circle' as const, showSpinner: false };
    case 'reviewing':
      return { label: 'Review', color: colors.tint, icon: 'document-text' as const, showSpinner: false };
    case 'processing':
      return { label: 'Processing', color: colors.tint, icon: 'sync-circle' as const, showSpinner: true };
    case 'completed':
      return { label: 'Completed', color: colors.accent, icon: 'checkmark-circle' as const, showSpinner: false };
    case 'error':
      return { label: 'Error', color: colors.recording, icon: 'alert-circle' as const, showSpinner: false };
    default:
      return { label: 'Unknown', color: colors.textSecondary, icon: 'help-circle' as const, showSpinner: false };
  }
}

function getJobStatusConfig(status: JobStatus, colors: ReturnType<typeof useThemeColors>) {
  switch (status) {
    case 'queued':
      return { label: 'Queued', color: colors.textTertiary, icon: 'time-outline' as const };
    case 'extracting':
      return { label: 'Extracting', color: colors.warning, icon: 'document-text-outline' as const };
    case 'retrieving':
      return { label: 'Retrieving', color: colors.warning, icon: 'search-outline' as const };
    case 'generating':
      return { label: 'Generating', color: colors.tint, icon: 'sparkles-outline' as const };
    case 'finalizing':
      return { label: 'Finalizing', color: colors.tint, icon: 'checkmark-circle-outline' as const };
    case 'complete':
      return { label: 'Complete', color: colors.accent, icon: 'checkmark-circle' as const };
    case 'failed':
      return { label: 'Failed', color: colors.recording, icon: 'alert-circle' as const };
    default:
      return { label: 'Unknown', color: colors.textTertiary, icon: 'help-circle-outline' as const };
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / (1000 * 60));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Active Jobs Banner ────────────────────────────────────────────────────────
function ActiveJobsBanner({
  jobs, colors,
}: {
  jobs: FreestyleJob[];
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (jobs.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.duration(300).delay(50)}>
      <Pressable
        onPress={() => router.navigate('/(tabs)/jobs' as any)}
        style={({ pressed }) => [
          styles.jobsBanner,
          {
            backgroundColor: `${colors.tint}10`,
            borderColor: `${colors.tint}30`,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={[styles.jobsBannerIcon, { backgroundColor: `${colors.tint}20` }]}>
          <ActivityIndicator size={14} color={colors.tint} />
        </View>
        <View style={styles.jobsBannerText}>
          <Text style={[styles.jobsBannerTitle, { color: colors.text }]}>
            {jobs.length} active job{jobs.length !== 1 ? 's' : ''}
          </Text>
          <Text style={[styles.jobsBannerSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {jobs.map(j => {
              const s = getJobStatusConfig(j.status, colors);
              return s.label;
            }).join(', ')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </Pressable>
    </Animated.View>
  );
}

// ── Quick Action Card ─────────────────────────────────────────────────────────
function QuickActionCard({
  icon, label, sublabel, color, bgColor, onPress, colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel: string;
  color: string;
  bgColor: string;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickAction,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      <View style={[styles.quickActionIcon, { backgroundColor: bgColor }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={[styles.quickActionLabel, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.quickActionSub, { color: colors.textTertiary }]}>{sublabel}</Text>
    </Pressable>
  );
}

// ── Inbox Item ────────────────────────────────────────────────────────────────
function InboxItem({
  session, colors, onPress,
}: {
  session: AmbientSession;
  colors: ReturnType<typeof useThemeColors>;
  onPress: () => void;
}) {
  const status = getStatusConfig(session.status, colors);
  const patientName = session.patientInfo?.name || session.patientContext?.split('\n')[0]?.trim();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.inboxItem,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {/* Status indicator bar */}
      <View style={[styles.inboxStatusBar, { backgroundColor: status.color }]} />

      <View style={styles.inboxContent}>
        <View style={styles.inboxTopRow}>
          {/* Status chip */}
          <View style={[styles.statusChip, { backgroundColor: `${status.color}18` }]}>
            {status.showSpinner ? (
              <ActivityIndicator size={10} color={status.color} />
            ) : (
              <Ionicons name={status.icon} size={11} color={status.color} />
            )}
            <Text style={[styles.statusChipText, { color: status.color }]}>
              {status.label}
            </Text>
          </View>
          <Text style={[styles.inboxTime, { color: colors.textTertiary }]}>
            {formatTime(session.createdAt)}
          </Text>
        </View>

        {patientName && (
          <Text style={[styles.inboxPatient, { color: colors.text }]} numberOfLines={1}>
            {patientName}
          </Text>
        )}

        <View style={styles.inboxDetails}>
          {session.recordingDuration > 0 && (
            <View style={styles.inboxDetail}>
              <Ionicons name="time-outline" size={12} color={colors.textTertiary} />
              <Text style={[styles.inboxDetailText, { color: colors.textTertiary }]}>
                {formatDuration(session.recordingDuration)}
              </Text>
            </View>
          )}
          {session.capturedImages.length > 0 && (
            <View style={styles.inboxDetail}>
              <Ionicons name="images-outline" size={12} color={colors.textTertiary} />
              <Text style={[styles.inboxDetailText, { color: colors.textTertiary }]}>
                {session.capturedImages.length}
              </Text>
            </View>
          )}
          {session.soapNote && (
            <View style={styles.inboxDetail}>
              <Ionicons name="document-text" size={12} color={colors.accent} />
              <Text style={[styles.inboxDetailText, { color: colors.accent }]}>
                SOAP
              </Text>
            </View>
          )}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} style={{ marginRight: 14 }} />
    </Pressable>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function HomeHub() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { sessions, setCurrentSession, createSession } = useSessions();
  const { user } = useAuth();
  const jobsMap = useJobsStore((s) => s.jobs);
  const activeJobs = useMemo(() => selectActiveJobs(jobsMap), [jobsMap]);
  const userName = user?.email?.split('@')[0] || '';
  const greeting = getGreeting();

  // Pulse animation for mic button
  const pulse = useSharedValue(1);
  React.useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ), -1, false,
    );
  }, []);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  // Outer glow pulse
  const glowOpacity = useSharedValue(0.15);
  React.useEffect(() => {
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.15, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ), -1, false,
    );
  }, []);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const handleStartSession = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push('/(recording)/encounter-picker');
  };

  const handleCaptureOnly = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // Create a session and go straight to doc capture (skip mic permission + record)
    createSession();
    router.push('/(recording)/capture');
  };

  const handleFreestyle = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push('/(tabs)/freestyle');
  };

  const handleSessionPress = (session: AmbientSession) => {
    setCurrentSession(session);
    if (session.status === 'completed' || session.soapNote) {
      router.push({ pathname: '/session-detail', params: { id: session.id } });
    } else if (
      session.status === 'error' ||
      session.status === 'captured' ||
      session.status === 'reviewing' ||
      session.status === 'processing' // stuck sessions can be retried
    ) {
      router.push({ pathname: '/(recording)/review' });
    } else {
      router.push({ pathname: '/session-detail', params: { id: session.id } });
    }
  };

  const recentSessions = sessions.slice(0, 10);
  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const renderInboxItem = ({ item, index }: { item: AmbientSession; index: number }) => (
    <Animated.View entering={FadeInDown.duration(300).delay(index * 60)}>
      <InboxItem
        session={item}
        colors={colors}
        onPress={() => handleSessionPress(item)}
      />
    </Animated.View>
  );

  const listHeader = useMemo(() => (
    <View style={styles.listHeaderContainer}>
      {/* ── Hero Action Zone ── */}
      <Animated.View entering={FadeIn.duration(600).delay(100)} style={styles.actionZone}>
        <Text style={[styles.greeting, { color: colors.textSecondary }]}>
          {greeting}{userName ? `, ${userName}` : ''}
        </Text>
        <View style={styles.brandRow}>
          <BrandMark size={30} tintColor={colors.tint} />
          <Text style={[styles.brandName, { color: colors.text }]}>
            DoMy<Text style={{ color: colors.tint }}>Note</Text>
          </Text>
        </View>

        {/* Big mic button with glow */}
        <View style={styles.micWrapper}>
          <Animated.View
            style={[
              styles.micGlow,
              { backgroundColor: colors.recording },
              glowStyle,
            ]}
          />
          <Animated.View style={pulseStyle}>
            <Pressable
              onPress={handleStartSession}
              style={({ pressed }) => [
                styles.bigMicBtn,
                {
                  backgroundColor: colors.recording,
                  shadowColor: colors.recording,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                },
              ]}
            >
              <Ionicons name="mic" size={48} color="#fff" />
            </Pressable>
          </Animated.View>
        </View>
        <Text style={[styles.micLabel, { color: colors.text }]}>
          Start New Encounter
        </Text>
        <Text style={[styles.micSublabel, { color: colors.textTertiary }]}>
          Tap to record and generate a SOAP note
        </Text>
      </Animated.View>

      {/* ── Quick Actions Grid ── */}
      <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.quickActionsRow}>
        <QuickActionCard
          icon="camera-outline"
          label="Scan Docs"
          sublabel="Capture & extract"
          color={colors.accent}
          bgColor={colors.accentLight}
          onPress={handleCaptureOnly}
          colors={colors}
        />
        <QuickActionCard
          icon="sparkles-outline"
          label="Freestyle"
          sublabel="AI generate H&P"
          color={colors.tint}
          bgColor={colors.tintLight}
          onPress={handleFreestyle}
          colors={colors}
        />
        <QuickActionCard
          icon="medical-outline"
          label="Consult"
          sublabel="Clinical Q&A"
          color={colors.warning}
          bgColor={colors.warningLight}
          onPress={() => router.push('/(tabs)/consult')}
          colors={colors}
        />
      </Animated.View>

      {/* ── Active Jobs Banner ── */}
      <ActiveJobsBanner jobs={activeJobs} colors={colors} />

      {/* ── Inbox header ── */}
      {sessions.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.inboxHeader}>
          <Text style={[styles.inboxTitle, { color: colors.textSecondary }]}>
            Recent Encounters
          </Text>
          <Pressable
            onPress={() => router.navigate('/(tabs)/history' as any)}
            hitSlop={8}
          >
            <Text style={[styles.viewAllLink, { color: colors.tint }]}>
              View All ({sessions.length})
            </Text>
          </Pressable>
        </Animated.View>
      ) : (
        <Animated.View entering={FadeInDown.duration(500).delay(350)} style={styles.welcomeCard}>
          <View style={[styles.welcomeCardInner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.welcomeTitle, { color: colors.text }]}>Welcome to DoMyNote 👋</Text>
            <Text style={[styles.welcomeText, { color: colors.textSecondary }]}>
              Your AI-powered clinical scribe. Three ways to generate notes:
            </Text>
            {[
              { step: '1', icon: 'mic-outline' as const, text: 'Ambient Record — capture encounters hands-free' },
              { step: '2', icon: 'sparkles-outline' as const, text: 'Freestyle H&P — mix audio, docs & typed notes' },
              { step: '3', icon: 'medical-outline' as const, text: 'STAT Consult — evidence-based clinical Q&A' },
            ].map((item, i) => (
              <View key={i} style={styles.welcomeStep}>
                <View style={[styles.welcomeStepNum, { backgroundColor: colors.tintLight }]}>
                  <Ionicons name={item.icon} size={16} color={colors.tint} />
                </View>
                <Text style={[styles.welcomeStepText, { color: colors.text }]}>{item.text}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      )}
    </View>
  ), [greeting, userName, colors, glowStyle, pulseStyle, handleStartSession, handleCaptureOnly, handleFreestyle, activeJobs, sessions]);

  const listFooter = useMemo(() => (
    <Animated.View entering={FadeInUp.duration(400).delay(400)} style={styles.footerSection}>
      {sessions.length > 10 && (
        <Pressable
          onPress={() => router.navigate('/(tabs)/history' as any)}
          style={({ pressed }) => [
            styles.viewAllBtn,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.viewAllText, { color: colors.tint }]}>
            View All Sessions →
          </Text>
        </Pressable>
      )}
      <View style={[styles.complianceBadge, { backgroundColor: colors.accentLight }]}>
        <Ionicons name="shield-checkmark" size={13} color={colors.accent} />
        <Text style={[styles.complianceText, { color: colors.accent }]}>
          HIPAA Compliant · On-Device Encryption
        </Text>
      </View>
    </Animated.View>
  ), [sessions.length, colors]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={recentSessions}
        keyExtractor={item => item.id}
        renderItem={renderInboxItem}
        ListHeaderComponent={<>{listHeader}</>}
        ListFooterComponent={<>{listFooter}</>}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 12,
            paddingBottom: Platform.OS === 'web' ? 84 + 34 : insets.bottom + 100,
          },
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
  },
  listHeaderContainer: {
    gap: 0,
  },

  // ── Hero Action Zone ──
  actionZone: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 20,
    gap: 10,
  },
  greeting: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.3,
  },
  brandName: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    marginBottom: 2,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  micWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 140,
    height: 140,
  },
  micGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  bigMicBtn: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 14,
  },
  micLabel: {
    fontSize: 19,
    fontFamily: 'Inter_700Bold',
    marginTop: 2,
  },
  micSublabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: -4,
  },

  // ── Quick Actions ──
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 16,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  quickActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  quickActionSub: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: -2,
  },

  // ── Active Jobs Banner ──
  jobsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  jobsBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobsBannerText: {
    flex: 1,
    gap: 2,
  },
  jobsBannerTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  jobsBannerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },

  // ── Inbox ──
  inboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    paddingTop: 4,
  },
  inboxTitle: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  viewAllLink: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },

  // ── Inbox Item ──
  inboxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  inboxStatusBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  inboxContent: {
    flex: 1,
    padding: 13,
    gap: 5,
  },
  inboxTopRow: {
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
  inboxTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  inboxPatient: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  inboxDetails: {
    flexDirection: 'row',
    gap: 14,
  },
  inboxDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  inboxDetailText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  separator: {
    height: 8,
  },

  // ── Footer ──
  footerSection: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 20,
  },
  viewAllBtn: {
    paddingVertical: 8,
  },
  viewAllText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  complianceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  complianceText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },

  // ── Welcome Card (first-time) ──
  welcomeCard: {
    paddingTop: 8,
    paddingBottom: 12,
  },
  welcomeCardInner: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  welcomeTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  welcomeText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  welcomeStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  welcomeStepNum: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeStepText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
});
