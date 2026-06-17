import React, { useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useFreestyleStore } from '@/lib/stores/useFreestyleStore';

interface Props {
  workflowId: string;
  customInstructions: string;
  emLevel: string | null;
}

interface EmOption {
  code: string | null;
  label: string;
  helper: string;
}

const EM_OPTIONS: EmOption[] = [
  { code: null, label: 'Auto', helper: 'Let the AI choose and justify the level' },
  { code: '99213', label: '99213', helper: 'Established · low complexity, expanded problem-focused' },
  { code: '99214', label: '99214', helper: 'Established · moderate complexity, detailed' },
  { code: '99215', label: '99215', helper: 'Established · high complexity, comprehensive' },
  { code: '99203', label: '99203', helper: 'New patient · low complexity' },
  { code: '99204', label: '99204', helper: 'New patient · moderate complexity' },
  { code: '99205', label: '99205', helper: 'New patient · high complexity' },
];

export default function NoteSettingsCard({ workflowId, customInstructions, emLevel }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const setCustomInstructions = useFreestyleStore((s) => s.setCustomInstructions);
  const setEmLevel = useFreestyleStore((s) => s.setEmLevel);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInstructionsChange = useCallback(
    (text: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setCustomInstructions(workflowId, text);
      }, 500);
    },
    [workflowId, setCustomInstructions],
  );

  const handleSelectLevel = useCallback(
    (code: string | null) => {
      if (Platform.OS !== 'web') Haptics.selectionAsync();
      setEmLevel(workflowId, code);
    },
    [workflowId, setEmLevel],
  );

  const selected = EM_OPTIONS.find((o) => o.code === (emLevel ?? null)) ?? EM_OPTIONS[0];

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.iconBadge, { backgroundColor: `${colors.tint}15` }]}>
          <Ionicons name="options" size={16} color={colors.tint} />
        </View>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Note Settings</Text>
          <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
            Tell the AI how to write the note
          </Text>
        </View>
      </View>

      {/* Custom instructions */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          Custom Instructions
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          placeholder="e.g. Write in third person, keep the Assessment concise, bullet the Plan, include a patient-friendly summary..."
          placeholderTextColor={colors.textTertiary}
          defaultValue={customInstructions}
          onChangeText={handleInstructionsChange}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          maxLength={2000}
        />
      </View>

      {/* E/M level */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          Target E/M Level
        </Text>
        <View style={styles.chipsRow}>
          {EM_OPTIONS.map((opt) => {
            const isActive = (opt.code ?? null) === (emLevel ?? null);
            return (
              <Pressable
                key={opt.label}
                onPress={() => handleSelectLevel(opt.code)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: isActive ? colors.tint : colors.surfaceSecondary,
                    borderColor: isActive ? colors.tint : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: isActive ? '#fff' : colors.textSecondary },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.helper, { color: colors.textTertiary }]}>{selected.helper}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    minHeight: 80,
    lineHeight: 22,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  helper: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 17,
  },
});
