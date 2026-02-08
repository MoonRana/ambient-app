import React from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/constants/colors';
import { AmbientSession } from '@/lib/session-context';

interface SessionCardProps {
  session: AmbientSession;
  onPress: () => void;
  onDelete?: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'long' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getStatusConfig(status: AmbientSession['status'], colors: ReturnType<typeof useThemeColors>) {
  switch (status) {
    case 'recording':
      return { label: 'Recording', color: colors.recording, icon: 'mic' as const };
    case 'captured':
      return { label: 'Captured', color: colors.warning, icon: 'camera' as const };
    case 'reviewing':
      return { label: 'Reviewing', color: colors.tint, icon: 'document-text' as const };
    case 'completed':
      return { label: 'Completed', color: colors.accent, icon: 'checkmark-circle' as const };
  }
}

export default function SessionCard({ session, onPress, onDelete }: SessionCardProps) {
  const colorScheme = useColorScheme();
  const colors = useThemeColors(colorScheme);
  const statusConfig = getStatusConfig(session.status, colors);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
      onPress={onPress}
    >
      <View style={[styles.statusIndicator, { backgroundColor: statusConfig.color }]} />
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.titleRow}>
            <Ionicons name={statusConfig.icon} size={16} color={statusConfig.color} />
            <Text style={[styles.statusLabel, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
          <Text style={[styles.date, { color: colors.textTertiary }]}>
            {formatDate(session.createdAt)}
          </Text>
        </View>
        <View style={styles.detailsRow}>
          <View style={styles.detail}>
            <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.detailText, { color: colors.textSecondary }]}>
              {formatDuration(session.recordingDuration)}
            </Text>
          </View>
          {session.capturedImages.length > 0 && (
            <View style={styles.detail}>
              <Ionicons name="images-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                {session.capturedImages.length} photo{session.capturedImages.length !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
          {session.soapNote && (
            <View style={styles.detail}>
              <Ionicons name="document-text-outline" size={14} color={colors.accent} />
              <Text style={[styles.detailText, { color: colors.accent }]}>
                SOAP Note
              </Text>
            </View>
          )}
        </View>
      </View>
      {onDelete && (
        <Pressable
          onPress={onDelete}
          hitSlop={12}
          style={({ pressed }) => [
            styles.deleteBtn,
            { opacity: pressed ? 0.5 : 0.7 },
          ]}
        >
          <Ionicons name="trash-outline" size={18} color={colors.recording} />
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  statusIndicator: {
    width: 4,
    alignSelf: 'stretch',
  },
  content: {
    flex: 1,
    padding: 14,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  date: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  detailsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  deleteBtn: {
    padding: 14,
  },
});
