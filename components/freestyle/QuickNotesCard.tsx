import React, { useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useFreestyleStore } from '@/lib/stores/useFreestyleStore';

interface Props {
  workflowId: string;
  notes: string;
}

export default function QuickNotesCard({ workflowId, notes }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const setNotes = useFreestyleStore((s) => s.setNotes);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (text: string) => {
      // Debounce store writes by 500ms
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setNotes(workflowId, text);
      }, 500);
    },
    [workflowId, setNotes],
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.iconBadge, { backgroundColor: `${colors.accent}15` }]}>
          <Ionicons name="create" size={16} color={colors.accent} />
        </View>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Quick Notes</Text>
          <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
            HPI, chief complaint, additional context
          </Text>
        </View>
      </View>

      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
        placeholder="Type or paste notes here... Chief complaint, history, allergies, etc."
        placeholderTextColor={colors.textTertiary}
        defaultValue={notes}
        onChangeText={handleChange}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        maxLength={10000}
      />
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
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    minHeight: 100,
    lineHeight: 22,
  },
});
