import React from 'react';
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
}

export default function MultiRecordingStack({ workflowId, recordings }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const addRecording = useFreestyleStore((s) => s.addRecording);

  const handleAddRecording = () => {
    addRecording(workflowId);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const hasActiveRecording = recordings.some(
    (r) => r.state === 'recording' || r.state === 'paused',
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconBadge, { backgroundColor: `${colors.recording}15` }]}>
            <Ionicons name="mic" size={16} color={colors.recording} />
          </View>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Recordings</Text>
            <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
              {recordings.length > 0
                ? `${recordings.length} recording${recordings.length !== 1 ? 's' : ''}`
                : 'Ambient audio capture'}
            </Text>
          </View>
        </View>
      </View>

      {/* Recording rows */}
      {recordings.length > 0 && (
        <View style={styles.recordingsStack}>
          {recordings.map((rec, index) => (
            <Animated.View key={rec.id} entering={FadeInDown.duration(200).delay(index * 50)}>
              <RecordingRow
                workflowId={workflowId}
                recording={rec}
                index={index}
              />
            </Animated.View>
          ))}
        </View>
      )}

      {/* Add Recording button */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  recordingsStack: {
    gap: 8,
  },
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
  addBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  hint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: -4,
  },
});
