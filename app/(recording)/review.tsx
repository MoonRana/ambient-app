import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  ScrollView, ActivityIndicator, Alert, TextInput,
  Clipboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import Animated, {
  FadeIn, FadeInDown, FadeInUp, useSharedValue,
  useAnimatedStyle, withTiming, withSequence, Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '@/constants/colors';
import { useSessions } from '@/lib/session-context';
import {
  processRecordingToSOAP, generateSOAPNote,
  analyzeInsuranceCard, extractClinicalDocument,
  type ProcessingProgress,
  savePatientToSupabase, saveEncounterToSupabase,
  saveReportToSupabase, upsertAmbientSession, savePatientData,
} from '@/lib/supabase-api';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useAuth } from '@/lib/auth-context';

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

// ── Accordion for extracted data ──────────────────────────────────────────────
function DataAccordion({
  session,
  colors,
}: {
  session: any;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const [open, setOpen] = useState(false);
  const pi = session?.patientInfo;
  const hasData = pi && Object.values(pi).some(v => !!v);
  if (!hasData && !session?.capturedImages?.length) return null;

  return (
    <View style={[accordStyles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        onPress={() => setOpen(o => !o)}
        style={({ pressed }) => [accordStyles.header, { opacity: pressed ? 0.8 : 1 }]}
      >
        <View style={accordStyles.headerLeft}>
          <Ionicons name="analytics-outline" size={16} color={colors.tint} />
          <Text style={[accordStyles.headerTitle, { color: colors.text }]}>Extracted Clinical Data</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </Pressable>

      {open && (
        <Animated.View entering={FadeInDown.duration(250)} style={accordStyles.body}>
          <View style={[accordStyles.divider, { backgroundColor: colors.border }]} />
          {pi?.name && <DataRow label="Patient" value={pi.name} colors={colors} />}
          {pi?.dateOfBirth && <DataRow label="Date of Birth" value={pi.dateOfBirth} colors={colors} />}
          {pi?.payerName && <DataRow label="Insurance" value={pi.payerName} colors={colors} />}
          {pi?.memberId && <DataRow label="Member ID" value={pi.memberId} colors={colors} />}
          {pi?.groupNumber && <DataRow label="Group #" value={pi.groupNumber} colors={colors} />}
          {pi?.address && <DataRow label="Address" value={pi.address} colors={colors} />}
          {session?.recordingDuration > 0 && (
            <DataRow label="Duration" value={formatDuration(session.recordingDuration)} colors={colors} />
          )}
          {session?.capturedImages?.length > 0 && (
            <>
              <View style={[accordStyles.divider, { backgroundColor: colors.border, marginTop: 8 }]} />
              <Text style={[accordStyles.imgLabel, { color: colors.textSecondary }]}>Captured Documents</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {session.capturedImages.map((img: any) => (
                  <Image
                    key={img.id}
                    source={{ uri: img.uri }}
                    style={[accordStyles.thumb, { borderColor: colors.border }]}
                    contentFit="cover"
                  />
                ))}
              </ScrollView>
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
}

function DataRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={accordStyles.dataRow}>
      <Text style={[accordStyles.dataLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[accordStyles.dataValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const accordStyles = StyleSheet.create({
  container: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  body: { paddingHorizontal: 14, paddingBottom: 14 },
  divider: { height: StyleSheet.hairlineWidth, marginBottom: 10 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  dataLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  dataValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', flex: 1, textAlign: 'right', marginLeft: 16 },
  imgLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.8 },
  thumb: { width: 72, height: 72, borderRadius: 10, borderWidth: 1, marginRight: 8 },
});

// ── SOAP Section card ─────────────────────────────────────────────────────────
function SoapSection({
  label, content, colors, delay,
}: {
  label: string; content: string; colors: any; delay: number;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(delay)}
      style={[soapStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[soapStyles.label, { color: colors.tint }]}>{label}</Text>
      <Text style={[soapStyles.text, { color: colors.text }]}>{content}</Text>
    </Animated.View>
  );
}

const soapStyles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 18, gap: 10 },
  label: { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 1.5 },
  text: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 24 },
});

// ── Copy flash animation ──────────────────────────────────────────────────────
function useCopyFlash() {
  const [copied, setCopied] = useState(false);
  const flash = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return { copied, flash };
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ReviewScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { currentSession, updateSession } = useSessions();
  const { user } = useAuth();
  const { copied, flash } = useCopyFlash();

  const [patientContext, setPatientContext] = useState(currentSession?.patientContext || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [soapNote, setSoapNote] = useState(currentSession?.soapNote || null);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStep, setSaveStep] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(currentSession?.savedToCloud || false);
  const [showContextInput, setShowContextInput] = useState(false);

  useKeepAwake();

  // Auto-start generating if we don't have a note yet
  useEffect(() => {
    if (currentSession && !currentSession.soapNote && !isGenerating) {
      handleGenerateNote();
    }
  }, []);

  const buildFullNote = (note: typeof soapNote) => {
    if (!note) return '';
    return [
      `SUBJECTIVE:\n${note.subjective}`,
      `\nOBJECTIVE:\n${note.objective}`,
      `\nASSESSMENT:\n${note.assessment}`,
      `\nPLAN:\n${note.plan}`,
      note.followUp ? `\nFOLLOW-UP:\n${note.followUp}` : null,
    ].filter(Boolean).join('\n');
  };

  const handleCopy = () => {
    const note = soapNote ? buildFullNote(soapNote) : '';
    if (!note) return;
    Clipboard.setString(note);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    flash();
  };

  const handleGenerateNote = useCallback(async () => {
    if (!currentSession) return;

    setIsGenerating(true);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    updateSession(currentSession.id, { patientContext, status: 'processing' });

    if (currentSession.recordingUri) {
      // Path A: Recording exists
      try {
        let mergedInfo = { ...currentSession.patientInfo };
        let extractedTextParts: string[] = [];

        if (currentSession.capturedImages.length > 0) {
          setProcessingProgress({ step: 'uploading', message: `Reading ${currentSession.capturedImages.length} document(s)...`, progress: 0.05 });
          for (let i = 0; i < currentSession.capturedImages.length; i++) {
            const img = currentSession.capturedImages[i];
            setProcessingProgress({
              step: 'uploading',
              message: `Reading document ${i + 1} of ${currentSession.capturedImages.length}...`,
              progress: 0.05 + (i / currentSession.capturedImages.length) * 0.1,
            });
            try {
              // Run insurance-field extraction and full clinical OCR in parallel
              const [info, clinicalText] = await Promise.all([
                analyzeInsuranceCard(img.uri),
                extractClinicalDocument(img.uri),
              ]);

              // Merge insurance/demographic fields
              if (info.patient_name && !mergedInfo.name) mergedInfo.name = info.patient_name;
              if (info.date_of_birth && !mergedInfo.dateOfBirth) mergedInfo.dateOfBirth = info.date_of_birth;
              if (info.payer_name && !mergedInfo.payerName) mergedInfo.payerName = info.payer_name;
              if (info.member_id && !mergedInfo.memberId) mergedInfo.memberId = info.member_id;
              if (info.group_number && !mergedInfo.groupNumber) mergedInfo.groupNumber = info.group_number;
              if (info.address && !mergedInfo.address) mergedInfo.address = info.address;

              // Build document context block — insurance fields + full clinical text
              const docParts: string[] = [];
              const insuranceParts = [
                info.patient_name ? `Patient Name: ${info.patient_name}` : null,
                info.date_of_birth ? `Date of Birth: ${info.date_of_birth}` : null,
                info.payer_name ? `Insurance: ${info.payer_name}` : null,
                info.member_id ? `Member ID: ${info.member_id}` : null,
                info.group_number ? `Group: ${info.group_number}` : null,
                info.address ? `Address: ${info.address}` : null,
              ].filter(Boolean) as string[];
              if (insuranceParts.length > 0) docParts.push(insuranceParts.join('\n'));
              // Append full clinical text (medications, diagnoses, vitals, labs, etc.)
              if (clinicalText) docParts.push(clinicalText);
              if (docParts.length > 0) extractedTextParts.push(`[Document ${i + 1}]\n${docParts.join('\n')}`);
            } catch (e) { console.warn(`OCR image ${i + 1} failed:`, e); }
          }
          updateSession(currentSession.id, { patientInfo: mergedInfo });
        }

        const documentContext = extractedTextParts.length > 0 ? extractedTextParts.join('\n\n') : undefined;
        const result = await processRecordingToSOAP(
          currentSession.recordingUri,
          currentSession.id,
          patientContext,
          (progress) => setProcessingProgress(progress),
          mergedInfo,
          documentContext,
        );

        setSoapNote(result.soapNote);
        updateSession(currentSession.id, {
          soapNote: result.soapNote, transcript: result.transcript,
          fullNote: result.fullNote, patientContext, patientInfo: mergedInfo, status: 'completed',
        });
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error: any) {
        console.error('SOAP generation failed:', error);
        updateSession(currentSession.id, { status: 'error', errorMessage: error.message });
        Alert.alert('Processing Error', `Could not process recording: ${error.message}`, [{ text: 'OK' }]);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } else {
      // Path B: No recording
      try {
        let mergedInfo = { ...currentSession.patientInfo };
        let extractedTextParts: string[] = [];

        if (currentSession.capturedImages.length > 0) {
          setProcessingProgress({ step: 'uploading', message: `Extracting data from ${currentSession.capturedImages.length} document(s)...`, progress: 0.1 });
          for (let i = 0; i < currentSession.capturedImages.length; i++) {
            const img = currentSession.capturedImages[i];
            setProcessingProgress({ step: 'uploading', message: `Reading document ${i + 1} of ${currentSession.capturedImages.length}...`, progress: 0.1 + (i / currentSession.capturedImages.length) * 0.4 });
            try {
              // Run insurance-field extraction and full clinical OCR in parallel
              const [info, clinicalText] = await Promise.all([
                analyzeInsuranceCard(img.uri),
                extractClinicalDocument(img.uri),
              ]);

              // Merge insurance/demographic fields
              if (info.patient_name && !mergedInfo.name) mergedInfo.name = info.patient_name;
              if (info.date_of_birth && !mergedInfo.dateOfBirth) mergedInfo.dateOfBirth = info.date_of_birth;
              if (info.payer_name && !mergedInfo.payerName) mergedInfo.payerName = info.payer_name;
              if (info.member_id && !mergedInfo.memberId) mergedInfo.memberId = info.member_id;
              if (info.group_number && !mergedInfo.groupNumber) mergedInfo.groupNumber = info.group_number;
              if (info.address && !mergedInfo.address) mergedInfo.address = info.address;

              // Build document context block — insurance fields + full clinical text
              const docParts: string[] = [];
              const insuranceParts = [
                info.patient_name ? `Patient Name: ${info.patient_name}` : null,
                info.date_of_birth ? `Date of Birth: ${info.date_of_birth}` : null,
                info.payer_name ? `Insurance: ${info.payer_name}` : null,
                info.member_id ? `Member ID: ${info.member_id}` : null,
                info.group_number ? `Group: ${info.group_number}` : null,
                info.address ? `Address: ${info.address}` : null,
              ].filter(Boolean) as string[];
              if (insuranceParts.length > 0) docParts.push(insuranceParts.join('\n'));
              // Append full clinical text (medications, diagnoses, vitals, labs, etc.)
              if (clinicalText) docParts.push(clinicalText);
              if (docParts.length > 0) extractedTextParts.push(`[Document ${i + 1}]\n${docParts.join('\n')}`);
            } catch (e) { console.warn(`OCR image ${i + 1} failed:`, e); }
          }
          updateSession(currentSession.id, { patientInfo: mergedInfo });
        }

        setProcessingProgress({ step: 'generating', message: 'Generating SOAP note...', progress: 0.6 });
        const documentContext = extractedTextParts.length > 0 ? `EXTRACTED FROM SCANNED DOCUMENTS:\n\n${extractedTextParts.join('\n\n')}` : '';
        const fullContext = [patientContext, documentContext].filter(Boolean).join('\n\n');

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
          transcript: fullContext || undefined,
          medications: [],
          diagnoses: [],
        });

        setSoapNote(result.sections);
        updateSession(currentSession.id, {
          soapNote: result.sections, fullNote: result.full_note,
          patientContext, patientInfo: mergedInfo, status: 'completed',
        });
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error: any) {
        console.error('SOAP generation failed:', error);
        updateSession(currentSession.id, { status: 'error', errorMessage: error.message });
        Alert.alert('Generation Error', `Could not generate note: ${error.message}`, [{ text: 'OK' }]);
      }
    }

    setIsGenerating(false);
    setProcessingProgress(null);
  }, [currentSession, patientContext]);

  const handleSaveAndFinish = useCallback(async () => {
    if (!currentSession || !soapNote || !user) return;

    setIsSaving(true);
    const fullNote = currentSession.fullNote || buildFullNote(soapNote);

    try {
      setSaveStep('Saving patient record...');
      const patientId = await savePatientToSupabase(user.id, {
        name: currentSession.patientInfo?.name || patientContext || undefined,
        dateOfBirth: currentSession.patientInfo?.dateOfBirth,
        memberId: currentSession.patientInfo?.memberId,
      });

      setSaveStep('Saving encounter...');
      const encounterId = await saveEncounterToSupabase(user.id, patientId, fullNote, { recordingDuration: currentSession.recordingDuration });

      setSaveStep('Saving report...');
      await saveReportToSupabase(user.id, patientId, encounterId, fullNote, currentSession.patientInfo?.name);

      setSaveStep('Syncing session...');
      try {
        await upsertAmbientSession({
          userId: user.id, patientId, status: 'completed',
          transcript: currentSession.transcript, generatedNote: fullNote, audioS3Uri: currentSession.audioS3Uri,
        });
      } catch (syncErr) { console.warn('Ambient session sync skipped:', syncErr); }

      setSaveStep('Extracting clinical data...');
      await savePatientData({ userId: user.id, patientId, encounterId, generatedNote: fullNote });

      updateSession(currentSession.id, { patientId, encounterId, savedToCloud: true });
      setIsSaved(true);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => router.dismissAll(), 600);
    } catch (error: any) {
      console.error('Save pipeline failed:', error);
      Alert.alert('Save Error', `Could not save: ${error.message}\n\nYou can retry or skip.`, [
        { text: 'Retry', onPress: () => handleSaveAndFinish() },
        { text: 'Skip', style: 'cancel' },
      ]);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
      setSaveStep(null);
    }
  }, [currentSession, soapNote, user, patientContext]);

  const webTopInset = Platform.OS === 'web' ? 20 : 0;
  const footerPb = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20) + 8;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <Pressable
          onPress={() => router.dismissAll()}
          hitSlop={12}
          style={({ pressed }) => [styles.headerBtn, { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>

        <View style={[styles.titlePill, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="document-text-outline" size={14} color={colors.tint} />
          <Text style={[styles.titlePillText, { color: colors.text }]}>SOAP Note</Text>
        </View>

        {/* Context toggle */}
        <Pressable
          onPress={() => setShowContextInput(s => !s)}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerBtn,
            {
              backgroundColor: showContextInput ? `${colors.tint}20` : colors.surfaceSecondary,
              borderWidth: showContextInput ? 1 : 0,
              borderColor: colors.tint,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="create-outline" size={18} color={showContextInput ? colors.tint : colors.textSecondary} />
        </Pressable>
      </View>

      {/* ── Scroll: SOAP content ── */}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: footerPb + (soapNote ? 130 : 80) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Optional context input */}
        {showContextInput && (
          <Animated.View entering={FadeInDown.duration(250)} style={styles.contextSection}>
            <Text style={[styles.contextLabel, { color: colors.textSecondary }]}>
              Additional Context (Optional)
            </Text>
            <TextInput
              style={[styles.contextInput, {
                backgroundColor: colors.surface, borderColor: colors.border, color: colors.text,
              }]}
              placeholder="Chief complaint, past history, allergies..."
              placeholderTextColor={colors.textTertiary}
              value={patientContext}
              onChangeText={setPatientContext}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              editable={!isGenerating}
            />
          </Animated.View>
        )}

        {/* Processing state */}
        {isGenerating && processingProgress && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.progressSection}>
            <View style={[styles.progressCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.progressHeader}>
                <ActivityIndicator color={colors.tint} size="small" />
                <Text style={[styles.progressTitle, { color: colors.tint }]}>
                  {STEP_LABELS[processingProgress.step] || 'Processing...'}
                </Text>
              </View>
              <Text style={[styles.progressMsg, { color: colors.textSecondary }]}>
                {processingProgress.message}
              </Text>
              <View style={[styles.progressBarBg, { backgroundColor: colors.surfaceSecondary }]}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      backgroundColor: colors.tint,
                      width: `${Math.round(processingProgress.progress * 100)}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.progressPct, { color: colors.textTertiary }]}>
                {Math.round(processingProgress.progress * 100)}%
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Generating spinner (before progress arrives) */}
        {isGenerating && !processingProgress && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.spinnerSection}>
            <ActivityIndicator size="large" color={colors.tint} />
            <Text style={[styles.generatingText, { color: colors.textSecondary }]}>
              Generating your SOAP note...
            </Text>
          </Animated.View>
        )}

        {/* Manual generate if auto didn't kick in */}
        {!soapNote && !isGenerating && (
          <Animated.View entering={FadeInDown.duration(400)} style={styles.generateSection}>
            <View style={[styles.generateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="document-text-outline" size={32} color={colors.textTertiary} />
              <Text style={[styles.generateTitle, { color: colors.text }]}>Ready to Generate</Text>
              <Text style={[styles.generateSub, { color: colors.textSecondary }]}>
                Tap below to process your recording into a structured SOAP note.
              </Text>
              <Pressable
                onPress={handleGenerateNote}
                style={({ pressed }) => [styles.generateBtn, { backgroundColor: colors.tint, opacity: pressed ? 0.9 : 1 }]}
              >
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={styles.generateBtnText}>Generate SOAP Note</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {/* ── SOAP Note: clean reading view ── */}
        {soapNote && (
          <Animated.View entering={FadeIn.duration(500)} style={styles.soapContainer}>
            {/* Patient banner if we have a name */}
            {currentSession?.patientInfo?.name && (
              <Animated.View
                entering={FadeInDown.duration(300)}
                style={[styles.patientBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={[styles.patientIcon, { backgroundColor: `${colors.tint}18` }]}>
                  <Ionicons name="person" size={18} color={colors.tint} />
                </View>
                <Text style={[styles.patientName, { color: colors.text }]}>
                  {currentSession.patientInfo.name}
                </Text>
                {currentSession.savedToCloud && (
                  <View style={[styles.savedBadge, { backgroundColor: `${colors.accent}18` }]}>
                    <Ionicons name="cloud-done" size={12} color={colors.accent} />
                  </View>
                )}
              </Animated.View>
            )}

            <SoapSection label="Subjective" content={soapNote.subjective} colors={colors} delay={0} />
            <SoapSection label="Objective" content={soapNote.objective} colors={colors} delay={80} />
            <SoapSection label="Assessment" content={soapNote.assessment} colors={colors} delay={160} />
            <SoapSection label="Plan" content={soapNote.plan} colors={colors} delay={240} />
            {soapNote.followUp && (
              <SoapSection label="Follow-Up" content={soapNote.followUp} colors={colors} delay={320} />
            )}

            {/* Accordion: extracted data */}
            <Animated.View entering={FadeInDown.duration(300).delay(400)}>
              <DataAccordion session={currentSession} colors={colors} />
            </Animated.View>
          </Animated.View>
        )}
      </ScrollView>

      {/* ── Sticky Footer — Simplified ── */}
      {soapNote && (
        <Animated.View
          entering={FadeInUp.duration(400)}
          style={[styles.footer, { paddingBottom: footerPb, backgroundColor: colors.background }]}
        >
          {/* Save progress */}
          {isSaving && saveStep && (
            <View style={styles.saveProgressRow}>
              <ActivityIndicator size="small" color={colors.tint} />
              <Text style={[styles.saveStepText, { color: colors.textSecondary }]}>{saveStep}</Text>
            </View>
          )}

          <View style={styles.footerBtns}>
            {/* Copy to Clipboard — full width */}
            <Pressable
              onPress={handleCopy}
              style={({ pressed }) => [
                styles.copyBtn,
                {
                  backgroundColor: copied ? `${colors.accent}18` : colors.surfaceSecondary,
                  borderColor: copied ? colors.accent : colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons
                name={copied ? 'checkmark-circle' : 'copy-outline'}
                size={20}
                color={copied ? colors.accent : colors.text}
              />
              <Text style={[styles.copyBtnText, { color: copied ? colors.accent : colors.text }]}>
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </Text>
            </Pressable>

            {/* Save & Close — full width, primary styling */}
            {isSaved ? (
              <View style={[styles.saveBtn, { backgroundColor: colors.accent }]}>
                <Ionicons name="cloud-done" size={20} color="#fff" />
                <Text style={styles.saveBtnText}>Saved to Cloud</Text>
              </View>
            ) : (
              <Pressable
                onPress={handleSaveAndFinish}
                disabled={isSaving}
                style={({ pressed }) => [
                  styles.saveBtn,
                  {
                    backgroundColor: isSaving ? colors.surfaceSecondary : colors.tint,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={isSaving ? 'cloud-upload-outline' : 'cloud-upload'}
                  size={20}
                  color={isSaving ? colors.textTertiary : '#fff'}
                />
                <Text style={[styles.saveBtnText, isSaving && { color: colors.textTertiary }]}>
                  {isSaving ? 'Saving...' : 'Save & Close'}
                </Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 8,
  },
  headerBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  titlePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  titlePillText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 14 },

  contextSection: { gap: 8 },
  contextLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.8 },
  contextInput: {
    borderWidth: 1, borderRadius: 14, padding: 14,
    fontSize: 15, fontFamily: 'Inter_400Regular', minHeight: 80,
  },

  progressSection: {},
  progressCard: { borderRadius: 16, borderWidth: 1, padding: 18, gap: 12 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  progressMsg: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  progressBarBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  progressPct: { fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'right' },

  spinnerSection: { alignItems: 'center', gap: 16, paddingVertical: 40 },
  generatingText: { fontSize: 15, fontFamily: 'Inter_400Regular' },

  generateSection: { flex: 1, paddingTop: 20 },
  generateCard: {
    borderRadius: 20, borderWidth: 1, padding: 32,
    alignItems: 'center', gap: 12,
  },
  generateTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  generateSub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 21 },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 8,
  },
  generateBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  soapContainer: { gap: 12 },
  patientBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: 14, borderWidth: 1,
  },
  patientIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  patientName: { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  savedBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

  // Sticky footer
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveProgressRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginBottom: 10,
  },
  saveStepText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  footerBtns: { flexDirection: 'column', gap: 10 },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 14, borderWidth: 1,
  },
  copyBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 14,
  },
  saveBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
