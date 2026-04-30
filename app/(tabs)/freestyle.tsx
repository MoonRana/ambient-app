import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn, FadeInDown, FadeInUp,
  useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming, Easing,
} from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useFreestyleStore } from '@/lib/stores/useFreestyleStore';
import { useFreestyleGeneration } from '@/lib/hooks/useFreestyleGeneration';
import { router } from 'expo-router';
import WorkspaceSummary from '@/components/freestyle/WorkspaceSummary';
import DocumentDropCard from '@/components/freestyle/DocumentDropCard';
import MultiRecordingStack from '@/components/freestyle/MultiRecordingStack';
import QuickNotesCard from '@/components/freestyle/QuickNotesCard';
import PatientLinkCard from '@/components/freestyle/PatientLinkCard';
import FreestyleAssistDrawer from '@/components/freestyle/FreestyleAssistDrawer';

export default function FreestyleScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();

  const workflows = useFreestyleStore((s) => s.workflows);
  const activeWorkflowId = useFreestyleStore((s) => s.activeWorkflowId);
  const createWorkflow = useFreestyleStore((s) => s.createWorkflow);
  const setActiveWorkflow = useFreestyleStore((s) => s.setActiveWorkflow);
  const deleteWorkflow = useFreestyleStore((s) => s.deleteWorkflow);
  const [showAssist, setShowAssist] = useState(false);

  // Auto-create a workflow if none exists
  useEffect(() => {
    if (!activeWorkflowId || !workflows[activeWorkflowId]) {
      const workflowIds = Object.keys(workflows);
      if (workflowIds.length > 0) {
        // Resume the most recent workflow
        const sorted = Object.values(workflows).sort((a, b) => b.updatedAt - a.updatedAt);
        setActiveWorkflow(sorted[0].workflowId);
      } else {
        createWorkflow();
      }
    }
  }, []);

  const activeWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null;

  // Sparkle animation for generate button
  const sparkle = useSharedValue(1);
  useEffect(() => {
    sparkle.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);
  const sparkleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sparkle.value }],
  }));

  const handleNewWorkflow = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createWorkflow();
  }, [createWorkflow]);

  const handleClearWorkflow = useCallback(() => {
    if (!activeWorkflowId) return;
    Alert.alert(
      'Clear Workspace',
      'This will remove all documents, recordings, and notes from the current workspace. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            deleteWorkflow(activeWorkflowId);
            createWorkflow();
          },
        },
      ],
    );
  }, [activeWorkflowId, deleteWorkflow, createWorkflow]);

  const { generate, isUploading, uploadProgress, error: genError } = useFreestyleGeneration();

  const handleGenerate = useCallback(async () => {
    if (!activeWorkflow || !activeWorkflowId) return;
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const jobId = await generate(activeWorkflowId);
    if (jobId) {
      // Navigate to Jobs tab to see live progress
      router.push('/(tabs)/jobs' as any);
    } else if (genError) {
      Alert.alert('Generation Failed', genError, [{ text: 'OK' }]);
    }
  }, [activeWorkflow, activeWorkflowId, generate, genError]);

  const hasAnyInput = activeWorkflow
    ? activeWorkflow.documents.length > 0 ||
      activeWorkflow.recordings.some((r) => r.state === 'stopped' || r.state === 'transcribed') ||
      activeWorkflow.notes.trim().length > 0
    : false;

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  if (!activeWorkflow) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 12,
            paddingBottom: Platform.OS === 'web' ? 84 + 34 : insets.bottom + 160,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.headerSection}>
          <View style={styles.headerRow}>
            <View>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Freestyle</Text>
              <Text style={[styles.headerSub, { color: colors.textTertiary }]}>
                Add anything, generate H&P
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={handleClearWorkflow}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.headerBtn,
                  { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
              </Pressable>
              <Pressable
                onPress={handleNewWorkflow}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.headerBtn,
                  { backgroundColor: `${colors.tint}15`, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="add" size={18} color={colors.tint} />
              </Pressable>
              <Pressable
                onPress={() => setShowAssist(!showAssist)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.headerBtn,
                  {
                    backgroundColor: showAssist ? colors.tint : `${colors.tint}15`,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons name="sparkles" size={16} color={showAssist ? '#fff' : colors.tint} />
              </Pressable>
            </View>
          </View>

          {/* Workspace summary */}
          <WorkspaceSummary workflow={activeWorkflow} />
        </Animated.View>

        {/* ── Input Cards ── */}
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.cardsSection}>
          {/* Patient Link */}
          <PatientLinkCard
            workflowId={activeWorkflow.workflowId}
            patientId={activeWorkflow.patientId}
            patientInfo={activeWorkflow.patientInfo}
          />

          {/* Documents */}
          <DocumentDropCard
            workflowId={activeWorkflow.workflowId}
            documents={activeWorkflow.documents}
          />

          {/* Recordings */}
          <MultiRecordingStack
            workflowId={activeWorkflow.workflowId}
            recordings={activeWorkflow.recordings}
          />

          {/* Quick Notes */}
          <QuickNotesCard
            workflowId={activeWorkflow.workflowId}
            notes={activeWorkflow.notes}
          />
        </Animated.View>

        {/* ── AI Assistant ── */}
        {showAssist && activeWorkflow && (
          <Animated.View entering={FadeInDown.duration(300)} style={styles.assistSection}>
            <FreestyleAssistDrawer
              workflow={activeWorkflow}
              visible={showAssist}
              onClose={() => setShowAssist(false)}
            />
          </Animated.View>
        )}

        {/* HIPAA badge */}
        <Animated.View entering={FadeInDown.duration(300).delay(300)} style={styles.complianceRow}>
          <View style={[styles.complianceBadge, { backgroundColor: colors.accentLight }]}>
            <Ionicons name="shield-checkmark" size={13} color={colors.accent} />
            <Text style={[styles.complianceText, { color: colors.accent }]}>HIPAA Compliant</Text>
          </View>
        </Animated.View>
      </ScrollView>

      {/* ── Sticky Generate Button ── */}
      <Animated.View
        entering={FadeInUp.duration(400).delay(200)}
        style={[
          styles.generateBar,
          {
            paddingBottom: Platform.OS === 'web' ? 84 + 20 : insets.bottom + 90,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Animated.View style={sparkleStyle}>
          <Pressable
            onPress={handleGenerate}
            disabled={!hasAnyInput || isUploading}
            style={({ pressed }) => [
              styles.generateBtn,
              {
                backgroundColor: hasAnyInput && !isUploading ? colors.tint : colors.surfaceSecondary,
                shadowColor: hasAnyInput && !isUploading ? colors.tint : 'transparent',
                opacity: !hasAnyInput || isUploading ? 0.6 : pressed ? 0.9 : 1,
              },
            ]}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons
                name="sparkles"
                size={22}
                color={hasAnyInput ? '#fff' : colors.textTertiary}
              />
            )}
            <Text
              style={[
                styles.generateBtnText,
                { color: hasAnyInput && !isUploading ? '#fff' : colors.textTertiary },
              ]}
            >
              {isUploading ? `Uploading ${Math.round(uploadProgress)}%` : 'Generate H&P'}
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 20,
  },
  headerSection: {
    gap: 12,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  headerSub: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardsSection: {
    gap: 14,
    paddingTop: 8,
  },
  complianceRow: {
    alignItems: 'center',
    paddingTop: 20,
  },
  complianceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  complianceText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  assistSection: {
    paddingTop: 8,
  },
  // Sticky generate
  generateBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  generateBtnText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
});
