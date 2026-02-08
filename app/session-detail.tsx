import React from 'react';
import {
  View, Text, StyleSheet, Pressable, useColorScheme, Platform,
  ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions } from '@/lib/session-context';

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

export default function SessionDetailScreen() {
  const colorScheme = useColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getSession, deleteSession } = useSessions();

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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16) + 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text style={[styles.dateText, { color: colors.textSecondary }]}>
            {formatFullDate(session.createdAt)}
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>Session Details</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(100)}>
          <View style={[styles.statsRow]}>
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
              <Ionicons
                name={session.status === 'completed' ? 'checkmark-circle' : 'ellipsis-horizontal-circle'}
                size={22}
                color={session.status === 'completed' ? colors.accent : colors.warning}
              />
              <Text style={[styles.statValue, { color: colors.text, fontSize: 13 }]}>
                {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Status</Text>
            </View>
          </View>
        </Animated.View>

        {session.capturedImages.length > 0 && (
          <Animated.View entering={FadeInDown.duration(400).delay(200)}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
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

        {session.patientContext && (
          <Animated.View entering={FadeInDown.duration(400).delay(250)}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              Patient Context
            </Text>
            <View style={[styles.contextCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.contextText, { color: colors.text }]}>
                {session.patientContext}
              </Text>
            </View>
          </Animated.View>
        )}

        {session.soapNote && (
          <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.soapSection}>
            <View style={styles.soapLabelRow}>
              <Ionicons name="document-text" size={18} color={colors.accent} />
              <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginBottom: 0 }]}>
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
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 24,
    gap: 24,
  },
  dateText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  statValue: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  statLabel: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  docImage: {
    width: 100,
    height: 100,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
  },
  contextCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  contextText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
  },
  soapSection: {
    gap: 12,
  },
  soapLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  soapCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  soapSectionTitle: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  soapText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
});
