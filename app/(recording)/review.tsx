import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  ScrollView, ActivityIndicator, Alert, TextInput, AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions } from '@/lib/session-context';
import { processRecordingToSOAP, generateSOAPNote, analyzeInsuranceCard, type ProcessingProgress } from '@/lib/supabase-api';
import { useEffectiveColorScheme } from '@/lib/settings-context';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const STEP_LABELS: Record<string, string> = {
  uploading: 'Reading Documents',
  starting: 'Starting Transcription',
  processing: 'Analyzing Audio',
  fetching: 'Retrieving Results',
  generating: 'Generating SOAP Note',
  complete: 'Complete',
  error: 'Error',
};

export default function ReviewScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { currentSession, updateSession } = useSessions();

  const [patientContext, setPatientContext] = useState(currentSession?.patientContext || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [soapNote, setSoapNote] = useState(currentSession?.soapNote || null);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);

  // Keep the screen awake during the entire upload + processing flow
  useKeepAwake();

  const handleGenerateNote = useCallback(async () => {
    if (!currentSession) return;

    setIsGenerating(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    updateSession(currentSession.id, {
      patientContext,
      status: 'processing',
    });

    if (currentSession.recordingUri) {
      // ── Path A: Recording exists → OCR images → HealthScribe pipeline ──────
      try {
        // Step 1: Auto-OCR any captured images first (same as no-audio path)
        let mergedInfo = { ...currentSession.patientInfo };
        let extractedTextParts: string[] = [];

        if (currentSession.capturedImages.length > 0) {
          setProcessingProgress({
            step: 'uploading',
            message: `Reading ${currentSession.capturedImages.length} document(s)...`,
            progress: 0.05,
          });

          for (let i = 0; i < currentSession.capturedImages.length; i++) {
            const img = currentSession.capturedImages[i];
            try {
              const info = await analyzeInsuranceCard(img.uri);
              if (info.patient_name && !mergedInfo.name) mergedInfo.name = info.patient_name;
              if (info.date_of_birth && !mergedInfo.dateOfBirth) mergedInfo.dateOfBirth = info.date_of_birth;
              if (info.payer_name && !mergedInfo.payerName) mergedInfo.payerName = info.payer_name;
              if (info.member_id && !mergedInfo.memberId) mergedInfo.memberId = info.member_id;
              if (info.group_number && !mergedInfo.groupNumber) mergedInfo.groupNumber = info.group_number;
              if (info.address && !mergedInfo.address) mergedInfo.address = info.address;

              const parts = [
                info.patient_name ? `Patient Name: ${info.patient_name}` : null,
                info.date_of_birth ? `Date of Birth: ${info.date_of_birth}` : null,
                info.payer_name ? `Insurance: ${info.payer_name}` : null,
                info.member_id ? `Member ID: ${info.member_id}` : null,
                info.group_number ? `Group: ${info.group_number}` : null,
                info.address ? `Address: ${info.address}` : null,
              ].filter(Boolean) as string[];
              if (parts.length > 0) extractedTextParts.push(`[Document ${i + 1}]\n${parts.join('\n')}`);
            } catch (e) {
              console.warn(`OCR image ${i + 1} failed:`, e);
            }
          }

          // Persist merged patient info before audio processing
          updateSession(currentSession.id, { patientInfo: mergedInfo });
        }

        // Build document context block to accompany the audio transcript
        const documentContext = extractedTextParts.length > 0
          ? extractedTextParts.join('\n\n')
          : undefined;

        // Step 2: HealthScribe audio pipeline (with enriched patient info + doc context)
        const result = await processRecordingToSOAP(
          currentSession.recordingUri,
          currentSession.id,
          patientContext,
          (progress) => setProcessingProgress(progress),
          mergedInfo,       // ← structured patient fields (name, DOB, insurance...)
          documentContext,  // ← free-text from scanned documents
        );

        setSoapNote(result.soapNote);
        updateSession(currentSession.id, {
          soapNote: result.soapNote,
          transcript: result.transcript,
          fullNote: result.fullNote,
          patientContext,
          patientInfo: mergedInfo,
          status: 'completed',
        });

        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (error: any) {
        console.error('SOAP generation failed:', error);
        updateSession(currentSession.id, {
          status: 'error',
          errorMessage: error.message,
        });

        Alert.alert(
          'Processing Error',
          `Could not process recording: ${error.message}. You can try again or check your connection.`,
          [{ text: 'OK' }],
        );

        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }
    } else {
      // ── Path B: No recording → extract images then generate ─────────────
      try {
        // Step 1: Auto-OCR any captured images (insurance cards, IDs, Rx labels)
        let mergedInfo = { ...currentSession.patientInfo };
        let extractedTextParts: string[] = [];

        if (currentSession.capturedImages.length > 0) {
          setProcessingProgress({
            step: 'uploading',
            message: `Extracting data from ${currentSession.capturedImages.length} document(s)...`,
            progress: 0.1,
          });

          for (let i = 0; i < currentSession.capturedImages.length; i++) {
            const img = currentSession.capturedImages[i];
            setProcessingProgress({
              step: 'uploading',
              message: `Reading document ${i + 1} of ${currentSession.capturedImages.length}...`,
              progress: 0.1 + (i / currentSession.capturedImages.length) * 0.4,
            });
            try {
              const info = await analyzeInsuranceCard(img.uri);
              // Merge — prefer already-filled fields
              if (info.patient_name && !mergedInfo.name) mergedInfo.name = info.patient_name;
              if (info.date_of_birth && !mergedInfo.dateOfBirth) mergedInfo.dateOfBirth = info.date_of_birth;
              if (info.payer_name && !mergedInfo.payerName) mergedInfo.payerName = info.payer_name;
              if (info.member_id && !mergedInfo.memberId) mergedInfo.memberId = info.member_id;
              if (info.group_number && !mergedInfo.groupNumber) mergedInfo.groupNumber = info.group_number;
              if (info.address && !mergedInfo.address) mergedInfo.address = info.address;

              // Build human-readable text for the SOAP context
              const parts = [
                info.patient_name ? `Patient Name: ${info.patient_name}` : null,
                info.date_of_birth ? `Date of Birth: ${info.date_of_birth}` : null,
                info.payer_name ? `Insurance: ${info.payer_name}` : null,
                info.member_id ? `Member ID: ${info.member_id}` : null,
                info.group_number ? `Group: ${info.group_number}` : null,
                info.address ? `Address: ${info.address}` : null,
              ].filter(Boolean) as string[];

              if (parts.length > 0) {
                extractedTextParts.push(`[Document ${i + 1}]\n${parts.join('\n')}`);
              }
            } catch (e) {
              console.warn(`Could not OCR image ${i + 1}:`, e);
            }
          }

          // Persist merged patient info back to session
          updateSession(currentSession.id, { patientInfo: mergedInfo });
        }

        setProcessingProgress({ step: 'generating', message: 'Generating SOAP note...', progress: 0.6 });

        // Step 2: Build a rich context string for the LLM
        const documentContext = extractedTextParts.length > 0
          ? `EXTRACTED FROM SCANNED DOCUMENTS:\n\n${extractedTextParts.join('\n\n')}`
          : '';

        const fullContext = [
          patientContext,
          documentContext,
        ].filter(Boolean).join('\n\n');

        const result = await generateSOAPNote({
          session_id: currentSession.id,
          patient_info: {
            name: mergedInfo.name || patientContext || '',
            date_of_birth: mergedInfo.dateOfBirth,
            member_id: mergedInfo.memberId,
            group_number: mergedInfo.groupNumber,
            payer_name: mergedInfo.payerName,
            address: mergedInfo.address,
          },
          // Pass extracted document text as transcript so the LLM has real data
          transcript: fullContext || undefined,
          medications: [],
          diagnoses: [],
        });

        setSoapNote(result.sections);
        updateSession(currentSession.id, {
          soapNote: result.sections,
          fullNote: result.full_note,
          patientContext,
          patientInfo: mergedInfo,
          status: 'completed',
        });

        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (error: any) {
        console.error('SOAP generation failed:', error);
        updateSession(currentSession.id, {
          status: 'error',
          errorMessage: error.message,
        });

        Alert.alert(
          'Generation Error',
          `Could not generate note: ${error.message}`,
          [{ text: 'OK' }],
        );
      }
    }

    setIsGenerating(false);
    setProcessingProgress(null);
  }, [currentSession, patientContext]);

  const handleDone = () => {
    router.dismissAll();
  };

  const handleCancel = () => {
    router.dismissAll();
  };

  const webTopInset = Platform.OS === 'web' ? 20 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <Pressable
          onPress={handleCancel}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>

        <View style={[styles.stepIndicator, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={[styles.stepDot, { backgroundColor: colors.tint }]} />
          <View style={[styles.stepDot, { backgroundColor: colors.tint }]} />
          <View style={[styles.stepDot, { backgroundColor: colors.tint }]} />
        </View>

        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Platform.OS === 'web' ? 34 + 80 : Math.max(insets.bottom, 16) + 80 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text style={[styles.title, { color: colors.text }]}>Review & Generate</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Review your session details and generate a SOAP note.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.summarySection}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Session Summary</Text>
          <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.summaryRow}>
              <Ionicons name="time-outline" size={18} color={colors.tint} />
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Duration</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {formatDuration(currentSession?.recordingDuration || 0)}
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryRow}>
              <Ionicons name="images-outline" size={18} color={colors.accent} />
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Documents</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {currentSession?.capturedImages.length || 0} captured
              </Text>
            </View>
            {currentSession?.recordingUri && (
              <>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <View style={styles.summaryRow}>
                  <Ionicons name="mic-outline" size={18} color={colors.recording} />
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Recording</Text>
                  <Text style={[styles.summaryValue, { color: colors.accent }]}>Saved</Text>
                </View>
              </>
            )}
          </View>
        </Animated.View>

        {currentSession && currentSession.capturedImages.length > 0 && (
          <Animated.View entering={FadeInDown.duration(400).delay(150)}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Captured Documents</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
              {currentSession.capturedImages.map(img => (
                <Image
                  key={img.id}
                  source={{ uri: img.uri }}
                  style={[styles.previewImage, { borderColor: colors.border }]}
                  contentFit="cover"
                />
              ))}
            </ScrollView>
          </Animated.View>
        )}

        <Animated.View entering={FadeInDown.duration(400).delay(200)}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Patient Context (Optional)</Text>
          <TextInput
            style={[styles.contextInput, {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              color: colors.text,
            }]}
            placeholder="Add any additional context about this encounter..."
            placeholderTextColor={colors.textTertiary}
            value={patientContext}
            onChangeText={setPatientContext}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            editable={!isGenerating}
          />
        </Animated.View>

        {!soapNote && !isGenerating && (
          <Animated.View entering={FadeInDown.duration(400).delay(300)}>
            <Pressable
              onPress={handleGenerateNote}
              disabled={isGenerating}
              style={({ pressed }) => [
                styles.generateBtn,
                {
                  backgroundColor: colors.accent,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Ionicons name="document-text" size={20} color="#fff" />
              <Text style={styles.generateBtnText}>Generate SOAP Note</Text>
            </Pressable>
          </Animated.View>
        )}

        {isGenerating && processingProgress && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.progressSection}>
            <View style={[styles.progressCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.progressHeader}>
                <ActivityIndicator color={colors.tint} size="small" />
                <Text style={[styles.progressTitle, { color: colors.tint }]}>
                  {STEP_LABELS[processingProgress.step] || 'Processing...'}
                </Text>
              </View>
              <Text style={[styles.progressMessage, { color: colors.textSecondary }]}>
                {processingProgress.message}
              </Text>
              <View style={[styles.progressBarBg, { backgroundColor: colors.surfaceSecondary }]}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      backgroundColor: colors.tint,
                      width: `${Math.round(processingProgress.progress * 100)}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.progressPercent, { color: colors.textTertiary }]}>
                {Math.round(processingProgress.progress * 100)}%
              </Text>
            </View>
          </Animated.View>
        )}

        {soapNote && (
          <Animated.View entering={FadeIn.duration(500)} style={styles.soapSection}>
            <View style={styles.soapHeader}>
              <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              <Text style={[styles.soapTitle, { color: colors.accent }]}>SOAP Note Generated</Text>
            </View>

            {(['subjective', 'objective', 'assessment', 'plan'] as const).map((section, idx) => (
              <Animated.View
                key={section}
                entering={FadeInDown.duration(300).delay(100 + idx * 80)}
                style={[styles.soapCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[styles.soapSectionTitle, { color: colors.tint }]}>
                  {section.charAt(0).toUpperCase() + section.slice(1)}
                </Text>
                <Text style={[styles.soapText, { color: colors.text }]}>
                  {soapNote[section]}
                </Text>
              </Animated.View>
            ))}

            {soapNote.followUp && (
              <Animated.View
                entering={FadeInDown.duration(300).delay(420)}
                style={[styles.soapCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[styles.soapSectionTitle, { color: colors.tint }]}>Follow-Up</Text>
                <Text style={[styles.soapText, { color: colors.text }]}>{soapNote.followUp}</Text>
              </Animated.View>
            )}
          </Animated.View>
        )}
      </ScrollView>

      {soapNote && (
        <Animated.View
          entering={FadeInUp.duration(400)}
          style={[styles.footer, { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16) + 8 }]}
        >
          <Pressable
            onPress={handleDone}
            style={({ pressed }) => [
              styles.doneButton,
              { backgroundColor: colors.tint, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Ionicons name="checkmark" size={22} color="#fff" />
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </Animated.View>
      )}
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
    paddingBottom: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndicator: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 24,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    marginTop: 6,
  },
  summarySection: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  summaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  summaryLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
  },
  imageScroll: {
    marginTop: -4,
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 8,
  },
  contextInput: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    minHeight: 80,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  generateBtnText: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  progressSection: {
    gap: 8,
  },
  progressCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  progressMessage: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressPercent: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    textAlign: 'right',
  },
  soapSection: {
    gap: 12,
  },
  soapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  soapTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  soapCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  soapSectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  soapText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  doneButtonText: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
