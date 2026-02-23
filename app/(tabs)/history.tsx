import React from 'react';
import {
  View, Text, StyleSheet, FlatList, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions, AmbientSession } from '@/lib/session-context';
import SessionCard from '@/components/SessionCard';
import { useEffectiveColorScheme } from '@/lib/settings-context';

export default function HistoryTab() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { sessions, deleteSession, setCurrentSession, updateSession } = useSessions();

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const handleSessionPress = (session: AmbientSession) => {
    setCurrentSession(session);
    router.push({ pathname: '/session-detail', params: { id: session.id } });
  };

  const handleResumeSession = (session: AmbientSession) => {
    // Reset error state before resuming so review screen starts fresh
    if (session.status === 'error' || session.status === 'processing') {
      updateSession(session.id, { status: 'captured', errorMessage: undefined });
    }
    setCurrentSession(session);
    router.push({ pathname: '/(recording)/review' });
  };

  const handleDeleteSession = (session: AmbientSession) => {
    Alert.alert(
      'Delete Session',
      'Are you sure you want to delete this session? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteSession(session.id),
        },
      ],
    );
  };

  const renderItem = ({ item, index }: { item: AmbientSession; index: number }) => (
    <Animated.View entering={FadeInDown.duration(300).delay(index * 50)}>
      <SessionCard
        session={item}
        onPress={() => handleSessionPress(item)}
        onDelete={() => handleDeleteSession(item)}
        onResume={() => handleResumeSession(item)}
      />
    </Animated.View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 16 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Session History</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <FlatList
        data={sessions}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Platform.OS === 'web' ? 84 + 34 : insets.bottom + 100 },
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="document-text-outline" size={40} color={colors.textTertiary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
              No sessions yet
            </Text>
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
              Start a new recording session from the Record tab to begin documenting encounters.
            </Text>
          </View>
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
    height: 10,
  },
  emptyContainer: {
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
