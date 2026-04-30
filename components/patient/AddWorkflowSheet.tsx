import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useFreestyleStore } from '@/lib/stores/useFreestyleStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  patientId?: string;
}

interface WorkflowOption {
  id: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  recommended?: boolean;
  color: string;
}

export default function AddWorkflowSheet({ visible, onClose, patientId }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const createWorkflow = useFreestyleStore((s) => s.createWorkflow);
  const setPatientId = useFreestyleStore((s) => s.setPatientId);

  const options: WorkflowOption[] = [
    {
      id: 'freestyle',
      title: 'Freestyle',
      subtitle: 'Add docs, recordings, notes — generate H&P',
      icon: 'sparkles',
      recommended: true,
      color: colors.tint,
    },
    {
      id: 'ambient',
      title: 'Ambient Recording',
      subtitle: 'Record encounter and auto-generate notes',
      icon: 'mic',
      color: colors.recording,
    },
    {
      id: 'document',
      title: 'Upload Documents',
      subtitle: 'Scan insurance cards, lab results, prescriptions',
      icon: 'document-text',
      color: colors.accent,
    },
    {
      id: 'quicknote',
      title: 'Quick Note',
      subtitle: 'Type or paste text for clinical note generation',
      icon: 'create',
      color: colors.warning,
    },
  ];

  const handleSelect = useCallback((option: WorkflowOption) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();

    switch (option.id) {
      case 'freestyle': {
        const wfId = createWorkflow();
        if (patientId) setPatientId(wfId, patientId);
        // Navigate to freestyle tab
        router.push('/(tabs)/freestyle' as any);
        break;
      }
      case 'ambient': {
        // Use existing recording flow
        router.push('/(recording)/record');
        break;
      }
      case 'document': {
        // Create a freestyle workflow focused on documents
        const wfId = createWorkflow();
        if (patientId) setPatientId(wfId, patientId);
        router.push('/(tabs)/freestyle' as any);
        break;
      }
      case 'quicknote': {
        // Create a freestyle workflow focused on quick notes
        const wfId = createWorkflow();
        if (patientId) setPatientId(wfId, patientId);
        router.push('/(tabs)/freestyle' as any);
        break;
      }
      default:
        break;
    }
  }, [createWorkflow, setPatientId, patientId, onClose]);

  if (!visible) return null;

  return (
    <Pressable style={styles.overlay} onPress={onClose}>
      <Pressable onPress={() => {}} style={styles.preventClose}>
        <Animated.View
          entering={FadeInDown.duration(300)}
          style={[styles.sheet, { backgroundColor: colors.background }]}
        >
          {/* Handle bar */}
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: colors.textTertiary }]} />
          </View>

          {/* Header */}
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Add Workflow</Text>
            <Text style={[styles.sheetSubtitle, { color: colors.textTertiary }]}>
              Choose how you want to capture clinical data
            </Text>
          </View>

          {/* Options */}
          <View style={styles.optionsList}>
            {options.map((option, index) => (
              <Animated.View
                key={option.id}
                entering={FadeInDown.duration(250).delay(index * 50)}
              >
                <Pressable
                  onPress={() => handleSelect(option)}
                  style={({ pressed }) => [
                    styles.optionCard,
                    {
                      backgroundColor: pressed ? `${option.color}10` : colors.surface,
                      borderColor: option.recommended ? option.color : colors.border,
                      borderWidth: option.recommended ? 1.5 : 1,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <View style={[styles.optionIcon, { backgroundColor: `${option.color}15` }]}>
                    <Ionicons name={option.icon as any} size={22} color={option.color} />
                  </View>
                  <View style={styles.optionContent}>
                    <View style={styles.optionTitleRow}>
                      <Text style={[styles.optionTitle, { color: colors.text }]}>
                        {option.title}
                      </Text>
                      {option.recommended && (
                        <View style={[styles.recBadge, { backgroundColor: `${option.color}20` }]}>
                          <Text style={[styles.recBadgeText, { color: option.color }]}>
                            Recommended
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.optionSubtitle, { color: colors.textSecondary }]}>
                      {option.subtitle}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </Pressable>
              </Animated.View>
            ))}
          </View>

          {/* Cancel */}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.cancelBtn,
              { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    zIndex: 999,
  },
  preventClose: {
    width: '100%',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 36,
  },
  handleBar: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  sheetHeader: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 4,
  },
  sheetTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  sheetSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  optionsList: {
    paddingHorizontal: 20,
    gap: 10,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionContent: {
    flex: 1,
    gap: 3,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  recBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  recBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  optionSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  cancelBtn: {
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 20,
    marginTop: 16,
  },
  cancelText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
});
