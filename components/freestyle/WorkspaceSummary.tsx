import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import type { FreestyleWorkflow } from '@/lib/stores/useFreestyleStore';

interface Props {
  workflow: FreestyleWorkflow;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const SYNC_LABELS: Record<string, { label: string; icon: string; color: 'accent' | 'warning' | 'recording' | 'textTertiary' }> = {
  local: { label: 'Local', icon: 'phone-portrait-outline', color: 'textTertiary' },
  syncing: { label: 'Syncing', icon: 'cloud-upload-outline', color: 'warning' },
  synced: { label: 'Synced', icon: 'cloud-done-outline', color: 'accent' },
  failed: { label: 'Sync failed', icon: 'cloud-offline-outline', color: 'recording' },
};

export default function WorkspaceSummary({ workflow }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);

  const docCount = workflow.documents.length;
  const recCount = workflow.recordings.length;
  const totalDuration = workflow.recordings.reduce((sum, r) => sum + r.duration, 0);
  const notesLen = workflow.notes.trim().length;
  const medCount = workflow.medications.length;
  const syncInfo = SYNC_LABELS[workflow.syncStatus] || SYNC_LABELS.local;
  const hasAnyInput = docCount > 0 || recCount > 0 || notesLen > 0 || medCount > 0;

  if (!hasAnyInput) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.statsRow}>
        {docCount > 0 && (
          <View style={styles.stat}>
            <Ionicons name="document-text-outline" size={14} color={colors.tint} />
            <Text style={[styles.statText, { color: colors.text }]}>
              {docCount} doc{docCount !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
        {recCount > 0 && (
          <View style={styles.stat}>
            <Ionicons name="mic-outline" size={14} color={colors.recording} />
            <Text style={[styles.statText, { color: colors.text }]}>
              {recCount} rec{recCount !== 1 ? 's' : ''}
              {totalDuration > 0 && ` · ${formatDuration(totalDuration)}`}
            </Text>
          </View>
        )}
        {notesLen > 0 && (
          <View style={styles.stat}>
            <Ionicons name="create-outline" size={14} color={colors.accent} />
            <Text style={[styles.statText, { color: colors.text }]}>Notes</Text>
          </View>
        )}
        {medCount > 0 && (
          <View style={styles.stat}>
            <Ionicons name="medkit-outline" size={14} color={colors.warning} />
            <Text style={[styles.statText, { color: colors.text }]}>
              {medCount} med{medCount !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </View>

      {/* Sync badge */}
      <View style={[styles.syncBadge, { backgroundColor: `${colors[syncInfo.color]}15` }]}>
        <Ionicons name={syncInfo.icon as any} size={11} color={colors[syncInfo.color]} />
        <Text style={[styles.syncText, { color: colors[syncInfo.color] }]}>
          {syncInfo.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    flexWrap: 'wrap',
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  syncText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
