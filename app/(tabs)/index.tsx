import React from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withSequence, Easing, FadeInDown,
} from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions } from '@/lib/session-context';
import InfoCard from '@/components/InfoCard';
import { useEffectiveColorScheme } from '@/lib/settings-context';

export default function RecordTab() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { sessions } = useSessions();
  const completedCount = sessions.filter(s => s.status === 'completed').length;

  const handleStartSession = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push('/(recording)/permission');
  };

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 20,
            paddingBottom: Platform.OS === 'web' ? 84 + 34 : insets.bottom + 100,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(500).delay(100)}>
          <Text style={[styles.greeting, { color: colors.textSecondary }]}>
            Clinical Documentation
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Ambient Recording
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(500).delay(200)}>
          <Pressable
            onPress={handleStartSession}
            style={({ pressed }) => [
              styles.startButton,
              {
                backgroundColor: colors.tint,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
          >
            <View style={styles.startButtonContent}>
              <View style={styles.micCircle}>
                <Ionicons name="mic" size={32} color={colors.tint} />
              </View>
              <View style={styles.startTextContainer}>
                <Text style={styles.startButtonTitle}>Start New Session</Text>
                <Text style={styles.startButtonSubtitle}>
                  Record, capture, and generate SOAP notes
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </Animated.View>

        {completedCount > 0 && (
          <Animated.View
            entering={FadeInDown.duration(500).delay(300)}
            style={[styles.statsRow]}
          >
            <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="document-text" size={20} color={colors.accent} />
              <Text style={[styles.statNumber, { color: colors.text }]}>{completedCount}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Completed</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="time" size={20} color={colors.tint} />
              <Text style={[styles.statNumber, { color: colors.text }]}>{sessions.length}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Total Sessions</Text>
            </View>
          </Animated.View>
        )}

        <Animated.View entering={FadeInDown.duration(500).delay(400)} style={styles.infoSection}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            How it works
          </Text>
          <View style={styles.infoCards}>
            <InfoCard
              icon="mic-outline"
              title="Record Visit"
              description="Capture the ambient audio of your patient encounter"
            />
            <InfoCard
              icon="camera-outline"
              title="Capture Documents"
              description="Photograph medication bottles, insurance cards, and clinical documents"
              variant="accent"
            />
            <InfoCard
              icon="document-text-outline"
              title="Generate SOAP Note"
              description="Review and generate structured clinical documentation"
              variant="warning"
            />
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(500).delay(500)} style={styles.complianceSection}>
          <View style={[styles.complianceBadge, { backgroundColor: colors.accentLight }]}>
            <Ionicons name="shield-checkmark" size={16} color={colors.accent} />
            <Text style={[styles.complianceText, { color: colors.accent }]}>
              HIPAA Compliant
            </Text>
          </View>
          <Text style={[styles.complianceNote, { color: colors.textTertiary }]}>
            All recordings are processed securely and stored locally on your device.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 24,
  },
  greeting: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    marginTop: 4,
  },
  startButton: {
    borderRadius: 18,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  startButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
  },
  micCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startTextContainer: {
    flex: 1,
  },
  startButtonTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  startButtonSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  statNumber: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
  },
  statLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  infoSection: {},
  infoCards: {
    gap: 10,
  },
  complianceSection: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
  complianceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  complianceText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  complianceNote: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 18,
  },
});
