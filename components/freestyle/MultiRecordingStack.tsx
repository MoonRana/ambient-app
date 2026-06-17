import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useFreestyleStore, type RecordingInput } from '@/lib/stores/useFreestyleStore';
import RecordingRow from './RecordingRow';

interface Props {
  workflowId: string;
  recordings: RecordingInput[];
  defaultCollapsed?: boolean;
}

export default function MultiRecordingStack({ workflowId, recordings, defaultCollapsed = false }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const addRecording = useFreestyleStore((s) => s.addRecording);
  const [expanded, setExpanded] = useState(!defaultCollapsed || recordings.length > 0);

  const handleAddRecording = () => {
    setExpanded(true);
    addRecording(workflowId);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const hasActiveRecording = recordings.some(
    (r) => r.state === 'recording' || r.state === 'paused',
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        style={styles.header}
      >
        <View style={styles.headerLeft}>
          <View style={[styles.iconBadge, { backgroundColor: `${colors.recording}15` }]}>
            <Ionicons name="mic" size={16} color={colors.recording} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: colors.text }]}>Recording (optional)</Text>
              <View style={[styles.optionalBadge, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.optionalBadgeText, { color: colors.textTertiary }]}>Optional</Text>
              </View>
            </View>
            <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
              Use when you can&apos;t upload documents — common in assisted living solo visits
            </Text>
          </View>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
      </Pressable>

      {expanded && (
        <>
          {recordings.length > 0 && (
            <View style={styles.recordingsStack}>
              {recordings.map((rec, index) => (
                <Animated.View key={rec.id} entering={FadeInDown.duration(200).delay(index * 50)}>
                  <RecordingRow workflowId={workflowId} recording={rec} index={index} />
                </Animated.View>
              ))}
            </View>
          )}

          <Pressable
            onPress={handleAddRecording}
            disabled={hasActiveRecording}
            style={({ pressed }) => [
              styles.addBtn,
              {
                borderColor: hasActiveRecording ? colors.border : colors.recording,
                backgroundColor: hasActiveRecording ? colors.surfaceSecondary : `${colors.recording}08`,
                opacity: hasActiveRecording ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color={hasActiveRecording ? colors.textTertiary : colors.recording}
            />
            <Text
              style={[
                styles.addBtnText,
                { color: hasActiveRecording ? colors.textTertiary : colors.recording },
              ]}
            >
              {recordings.length === 0 ? 'Add Recording' : 'Add Another Recording'}
            </Text>
          </Pressable>

          {hasActiveRecording && (
            <Text style={[styles.hint, { color: colors.textTertiary }]}>
              Stop the current recording before adding another
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  iconBadge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  optionalBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  optionalBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4, lineHeight: 17 },
  recordingsStack: { gap: 8 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  addBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  hint: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: -4 },
});
