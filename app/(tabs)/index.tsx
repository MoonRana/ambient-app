import React from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, FlatList, ActivityIndicator,
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
    router.push('/(recording)/permission');
  };

  const handleCaptureOnly = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // Create a session and go straight to doc capture (skip mic permission + record)
    createSession();
    router.push('/(recording)/capture');
  };

  const handleSessionPress = (session: AmbientSession) => {
    setCurrentSession(session);
    if (session.status === 'completed' || session.soapNote) {
      router.push({ pathname: '/session-detail', params: { id: session.id } });
    } else if (session.status === 'error' || session.status === 'captured' || session.status === 'reviewing') {
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

  const ListHeader = () => (
    <View style={styles.listHeaderContainer}>
      {/* ── Action Zone ── */}
      <Animated.View entering={FadeIn.duration(600).delay(100)} style={styles.actionZone}>
        <Text style={[styles.greeting, { color: colors.textSecondary }]}>
          DoMyNote
        </Text>

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
              <Ionicons name="mic" size={52} color="#fff" />
            </Pressable>
          </Animated.View>
        </View>
        <Text style={[styles.micLabel, { color: colors.text }]}>
          Start New Encounter
        </Text>
        <Text style={[styles.micSublabel, { color: colors.textTertiary }]}>
          Tap to record and generate a SOAP note
        </Text>

        {/* Secondary: Capture Document */}
        <Pressable
          onPress={handleCaptureOnly}
          style={({ pressed }) => [
            styles.captureBtn,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
        >
          <Ionicons name="camera-outline" size={18} color={colors.tint} />
          <Text style={[styles.captureBtnText, { color: colors.tint }]}>
            Capture Document
          </Text>
        </Pressable>
      </Animated.View>

      {/* ── Inbox header ── */}
      {sessions.length > 0 && (
        <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.inboxHeader}>
          <Text style={[styles.inboxTitle, { color: colors.textSecondary }]}>
            Recent Encounters
          </Text>
          <Text style={[styles.inboxCountText, { color: colors.textTertiary }]}>
            {sessions.length}
          </Text>
        </Animated.View>
      )}
    </View>
  );

  const ListFooter = () => (
    <Animated.View entering={FadeInUp.duration(400).delay(400)} style={styles.footerSection}>
      {sessions.length > 10 && (
        <Pressable
          onPress={() => router.push('/(tabs)/history')}
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
          HIPAA Compliant
        </Text>
      </View>
    </Animated.View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={recentSessions}
        keyExtractor={item => item.id}
        renderItem={renderInboxItem}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
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

  // ── Action Zone ──
  actionZone: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 28,
    gap: 12,
  },
  greeting: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  micWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 160,
    height: 160,
  },
  micGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  bigMicBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  micLabel: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginTop: 4,
  },
  micSublabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: -4,
  },
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 4,
  },
  captureBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
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
  inboxCountText: {
    fontSize: 12,
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
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  complianceText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
});
