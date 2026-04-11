import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  ScrollView, Alert, ActivityIndicator, ActionSheetIOS,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions, CapturedImage } from '@/lib/session-context';
import {
  analyzeInsuranceCard,
  extractClinicalDocument,
  extractMedications,
  uploadImageToS3,
  type ExtractedMedication,
} from '@/lib/supabase-api';
import { useEffectiveColorScheme } from '@/lib/settings-context';

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// ── Document type config ──────────────────────────────────────────────────────
type DocType = 'insurance' | 'clinical' | 'pill_bottle' | 'med_list';

const DOC_TYPES: { key: DocType; label: string; icon: keyof typeof Ionicons.glyphMap; description: string }[] = [
  { key: 'insurance', label: 'Insurance Card', icon: 'card-outline', description: 'Extract member ID, group, payer' },
  { key: 'clinical', label: 'Lab / Clinical Doc', icon: 'flask-outline', description: 'Extract labs, vitals, diagnoses' },
  { key: 'pill_bottle', label: 'Pill Bottle', icon: 'medical-outline', description: 'Extract medication & dosage' },
  { key: 'med_list', label: 'Medication List', icon: 'list-outline', description: 'Extract full medication list' },
];

export default function CaptureScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { currentSession, updateSession } = useSessions();

  const sessionIdRef = useRef(currentSession?.id);

  const [images, setImages] = useState<CapturedImage[]>(currentSession?.capturedImages || []);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<Record<string, { type: DocType; summary: string }>>({});

  const [patientInfo, setPatientInfo] = useState(
    currentSession?.patientInfo ?? {}
  );
  const [extractedMeds, setExtractedMeds] = useState<ExtractedMedication[]>([]);
  const [extractedClinicalText, setExtractedClinicalText] = useState<string | null>(null);

  // ── Scan with doc-type picker ───────────────────────────────────────────────
  const showDocTypePicker = (img: CapturedImage) => {
    if (scanningId) return;

    const options = DOC_TYPES.map(d => d.label);
    options.push('Cancel');

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'What type of document is this?',
          options,
          cancelButtonIndex: options.length - 1,
        },
        (buttonIndex) => {
          if (buttonIndex < DOC_TYPES.length) {
            handleScanImage(img, DOC_TYPES[buttonIndex].key);
          }
        },
      );
    } else {
      // Android / Web fallback — use Alert with buttons
      Alert.alert(
        'Document Type',
        'What type of document is this?',
        [
          ...DOC_TYPES.map(d => ({
            text: d.label,
            onPress: () => handleScanImage(img, d.key),
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
    }
  };

  const handleScanImage = async (img: CapturedImage, docType: DocType) => {
    if (scanningId) return;
    setScanningId(img.id);

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    try {
      let summary = '';

      if (docType === 'insurance') {
        const info = await analyzeInsuranceCard(img.uri);

        setPatientInfo(prev => {
          const merged = {
            ...prev,
            memberId: info.member_id || prev.memberId,
            groupNumber: info.group_number || prev.groupNumber,
            payerName: info.payer_name || prev.payerName,
            name: info.patient_name || prev.name,
            address: info.address || prev.address,
            dateOfBirth: info.date_of_birth || prev.dateOfBirth,
          };
          const id = sessionIdRef.current;
          if (id) updateSession(id, { patientInfo: merged });
          return merged;
        });

        summary = [
          info.patient_name ? `Name: ${info.patient_name}` : null,
          info.date_of_birth ? `DOB: ${info.date_of_birth}` : null,
          info.payer_name ? `Payer: ${info.payer_name}` : null,
          info.member_id ? `Member ID: ${info.member_id}` : null,
          info.group_number ? `Group: ${info.group_number}` : null,
          info.address ? `Address: ${info.address}` : null,
        ].filter(Boolean).join('\n');

      } else if (docType === 'clinical') {
        const text = await extractClinicalDocument(img.uri);
        if (text) {
          setExtractedClinicalText(prev => prev ? `${prev}\n\n${text}` : text);
          summary = text.length > 200 ? text.slice(0, 200) + '…' : text;
        } else {
          summary = 'No clinical data could be extracted.';
        }

      } else if (docType === 'pill_bottle' || docType === 'med_list') {
        const meds = await extractMedications(img.uri, docType === 'med_list');
        if (meds.length > 0) {
          setExtractedMeds(prev => [...prev, ...meds]);
          summary = meds.map(m => {
            return [m.name, m.dose, m.frequency].filter(Boolean).join(' ');
          }).join('\n');
        } else {
          summary = 'No medications could be extracted.';
        }
      }

      setScanResults(prev => ({ ...prev, [img.id]: { type: docType, summary } }));

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      Alert.alert(
        `${DOC_TYPES.find(d => d.key === docType)?.label} Scanned ✓`,
        summary || 'Document processed successfully.',
        [{ text: 'OK' }]
      );
    } catch (err: any) {
      console.error('Scan failed', err);

      const msg: string = err?.message || '';
      const isApiKeyError =
        msg.includes('400') || msg.includes('401') ||
        msg.includes('Anthropic') || msg.includes('authentication') ||
        msg.includes('API key');

      Alert.alert(
        isApiKeyError ? 'AI Service Not Configured' : 'Scan Error',
        isApiKeyError
          ? 'The document scanning service needs an API key.\n\nGo to: Supabase Dashboard → Edge Functions → Secrets.\n\nYou can still enter patient info manually.'
          : `Could not extract info: ${msg}`,
        [
          { text: 'OK' },
          { text: 'Enter Manually', onPress: () => router.push('/(recording)/patient-info') },
        ]
      );
    } finally {
      setScanningId(null);
    }
  };

  const addImage = async (useCamera: boolean) => {
    try {
      let result;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera Access', 'Camera permission is required to capture documents.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          quality: 0.8,
          allowsEditing: false,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Photo Access', 'Photo library permission is required to select documents.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          quality: 0.8,
          allowsMultipleSelection: true,
          selectionLimit: 5,
        });
      }

      if (!result.canceled && result.assets) {
        const newImages: CapturedImage[] = result.assets.map(asset => ({
          uri: asset.uri,
          id: generateId(),
          timestamp: Date.now(),
        }));
        setImages(prev => [...prev, ...newImages]);

        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }

        // Auto-backup images to S3 in background (fire-and-forget)
        const sid = sessionIdRef.current;
        if (sid) {
          newImages.forEach(img => {
            uploadImageToS3(img.uri, sid, img.id).then(res => {
              if (res.success && res.s3_uri) {
                setImages(prev =>
                  prev.map(i => i.id === img.id ? { ...i, s3Uri: res.s3_uri } : i)
                );
              }
            }).catch(() => { /* non-fatal */ });
          });
        }
      }
    } catch (err) {
      console.error('Failed to capture image', err);
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    setScanResults(prev => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleNext = () => {
    const id = sessionIdRef.current;
    if (id) {
      updateSession(id, {
        capturedImages: images,
        patientInfo,
        status: 'reviewing',
      });
    }
    router.push('/(recording)/review');
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

        <View style={[styles.titlePill, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="documents-outline" size={14} color={colors.tint} />
          <Text style={[styles.titlePillText, { color: colors.text }]}>Capture Documents</Text>
        </View>

        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text style={[styles.title, { color: colors.text }]}>Scan Documents</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {images.length > 0
              ? `${images.length} document${images.length !== 1 ? 's' : ''} captured. Tap the scan button on each to extract data.`
              : 'Photograph insurance cards, lab results, pill bottles, or medication lists.'}
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.captureButtons}>
          <Pressable
            onPress={() => addImage(true)}
            style={({ pressed }) => [
              styles.captureBtn,
              {
                backgroundColor: colors.tint,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
          >
            <Ionicons name="camera" size={24} color="#fff" />
            <Text style={styles.captureBtnText}>Take Photo</Text>
          </Pressable>
          <Pressable
            onPress={() => addImage(false)}
            style={({ pressed }) => [
              styles.captureBtn,
              {
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
          >
            <Ionicons name="images" size={24} color={colors.tint} />
            <Text style={[styles.captureBtnText, { color: colors.tint }]}>Choose from Library</Text>
          </Pressable>
        </Animated.View>

        {/* ── Document type hint chips ── */}
        <Animated.View entering={FadeInDown.duration(300).delay(150)} style={styles.docTypeHints}>
          {DOC_TYPES.map(d => (
            <View key={d.key} style={[styles.docTypeChip, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name={d.icon} size={12} color={colors.tint} />
              <Text style={[styles.docTypeChipText, { color: colors.textSecondary }]}>{d.label}</Text>
            </View>
          ))}
        </Animated.View>

        {images.length > 0 && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.imageSection}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              {images.length} document{images.length !== 1 ? 's' : ''} captured
            </Text>
            <View style={styles.imageGrid}>
              {images.map((img, idx) => {
                const result = scanResults[img.id];
                const isScanned = !!result;

                return (
                  <Animated.View
                    key={img.id}
                    entering={FadeInDown.duration(300).delay(idx * 50)}
                    style={styles.imageWrapper}
                  >
                    <Image
                      source={{ uri: img.uri }}
                      style={[
                        styles.image,
                        {
                          borderColor: isScanned ? colors.accent : colors.border,
                          borderWidth: isScanned ? 2 : 1,
                        },
                      ]}
                      contentFit="cover"
                    />
                    {/* Scan button */}
                    <Pressable
                      onPress={() => showDocTypePicker(img)}
                      disabled={!!scanningId}
                      style={[
                        styles.scanBtn,
                        {
                          backgroundColor: scanningId === img.id ? colors.tint :
                            isScanned ? colors.accent : colors.surface,
                          borderColor: isScanned ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      {scanningId === img.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : isScanned ? (
                        <Ionicons name="checkmark" size={14} color="#fff" />
                      ) : (
                        <Ionicons name="scan-outline" size={14} color={colors.tint} />
                      )}
                    </Pressable>
                    {/* Remove button */}
                    <Pressable
                      onPress={() => removeImage(img.id)}
                      style={[styles.removeBtn, { backgroundColor: colors.recording }]}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={14} color="#fff" />
                    </Pressable>
                    {/* Scanned type label */}
                    {isScanned && (
                      <View style={[styles.scannedLabel, { backgroundColor: colors.accent }]}>
                        <Text style={styles.scannedLabelText}>
                          {DOC_TYPES.find(d => d.key === result.type)?.label.split(' ')[0] || 'Scanned'}
                        </Text>
                      </View>
                    )}
                  </Animated.View>
                );
              })}
            </View>

            {/* Show extracted info if any field was found */}
            {Object.values(patientInfo).some(Boolean) && (
              <Animated.View entering={FadeIn.duration(400)} style={[styles.infoPreview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.infoPreviewHeader}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
                  <Text style={[styles.infoPreviewTitle, { color: colors.text }]}>Extracted Patient Info</Text>
                </View>
                <View style={styles.infoGrid}>
                  {patientInfo.name && (
                    <View style={styles.infoItem}>
                      <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Patient</Text>
                      <Text style={[styles.infoValue, { color: colors.text }]}>{patientInfo.name}</Text>
                    </View>
                  )}
                  {patientInfo.dateOfBirth && (
                    <View style={styles.infoItem}>
                      <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>DOB</Text>
                      <Text style={[styles.infoValue, { color: colors.text }]}>{patientInfo.dateOfBirth}</Text>
                    </View>
                  )}
                  {patientInfo.payerName && (
                    <View style={styles.infoItem}>
                      <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Insurance</Text>
                      <Text style={[styles.infoValue, { color: colors.text }]}>{patientInfo.payerName}</Text>
                    </View>
                  )}
                  {patientInfo.memberId && (
                    <View style={styles.infoItem}>
                      <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Member ID</Text>
                      <Text style={[styles.infoValue, { color: colors.text }]}>{patientInfo.memberId}</Text>
                    </View>
                  )}
                  {patientInfo.groupNumber && (
                    <View style={styles.infoItem}>
                      <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Group</Text>
                      <Text style={[styles.infoValue, { color: colors.text }]}>{patientInfo.groupNumber}</Text>
                    </View>
                  )}
                  {patientInfo.address && (
                    <View style={styles.infoItem}>
                      <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Address</Text>
                      <Text style={[styles.infoValue, { color: colors.text }]}>{patientInfo.address}</Text>
                    </View>
                  )}
                </View>
              </Animated.View>
            )}

            {/* Show extracted medications */}
            {extractedMeds.length > 0 && (
              <Animated.View entering={FadeIn.duration(400)} style={[styles.infoPreview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.infoPreviewHeader}>
                  <Ionicons name="medical" size={18} color={colors.tint} />
                  <Text style={[styles.infoPreviewTitle, { color: colors.text }]}>
                    Extracted Medications ({extractedMeds.length})
                  </Text>
                </View>
                {extractedMeds.map((med, i) => (
                  <View key={i} style={[styles.medRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                    <Text style={[styles.medName, { color: colors.text }]}>{med.name}</Text>
                    <Text style={[styles.medDetail, { color: colors.textSecondary }]}>
                      {[med.dose, med.frequency, med.route].filter(Boolean).join(' · ')}
                    </Text>
                    {med.notes && (
                      <Text style={[styles.medNotes, { color: colors.textTertiary }]}>{med.notes}</Text>
                    )}
                  </View>
                ))}
              </Animated.View>
            )}

            {/* Show extracted clinical text */}
            {extractedClinicalText && (
              <Animated.View entering={FadeIn.duration(400)} style={[styles.infoPreview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.infoPreviewHeader}>
                  <Ionicons name="flask" size={18} color={colors.warning} />
                  <Text style={[styles.infoPreviewTitle, { color: colors.text }]}>Extracted Clinical Data</Text>
                </View>
                <Text style={[styles.clinicalText, { color: colors.text }]} numberOfLines={15}>
                  {extractedClinicalText}
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        )}

        {images.length === 0 && (
          <Animated.View
            entering={FadeIn.duration(400).delay(200)}
            style={styles.emptyState}
          >
            <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="document-outline" size={36} color={colors.textTertiary} />
            </View>
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
              No documents captured yet
            </Text>
            <Text style={[styles.emptySubText, { color: colors.textTertiary }]}>
              Use the buttons above to photograph insurance cards, lab results, pill bottles, or medication lists.
            </Text>
          </Animated.View>
        )}

        {/* Manual entry button */}
        <Animated.View entering={FadeIn.duration(400).delay(250)}>
          <Pressable
            onPress={() => router.push('/(recording)/patient-info')}
            style={({ pressed }) => [
              styles.manualBtn,
              { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons name="person-add-outline" size={20} color={colors.tint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.manualBtnTitle, { color: colors.text }]}>Enter Patient Info Manually</Text>
              <Text style={[styles.manualBtnSub, { color: colors.textTertiary }]}>Add name, insurance ID, medications & more</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
        </Animated.View>
      </ScrollView>

      <Animated.View
        entering={FadeInUp.duration(400).delay(300)}
        style={[styles.footer, { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16) + 8 }]}
      >
        <Pressable
          onPress={handleNext}
          style={({ pressed }) => [
            styles.nextButton,
            { backgroundColor: colors.tint, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={styles.nextButtonText}>
            {images.length > 0 ? 'Continue to Review' : 'Skip & Continue'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </Pressable>
      </Animated.View>
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
  titlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  titlePillText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
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
  captureButtons: {
    gap: 12,
  },
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  captureBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },

  // Doc type hint chips
  docTypeHints: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: -12,
  },
  docTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  docTypeChipText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },

  // Image section
  imageSection: {
    gap: 12,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  imageWrapper: {
    position: 'relative',
  },
  image: {
    width: 100,
    height: 100,
    borderRadius: 12,
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  scanBtn: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  scannedLabel: {
    position: 'absolute',
    bottom: -6,
    left: -4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    zIndex: 10,
  },
  scannedLabelText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    textTransform: 'uppercase',
  },

  // Extracted info preview
  infoPreview: {
    marginTop: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  infoPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  infoPreviewTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  infoItem: {
    minWidth: '40%',
  },
  infoLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },

  // Medication rows
  medRow: {
    paddingVertical: 8,
  },
  medName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  medDetail: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  medNotes: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
    marginTop: 2,
  },

  // Clinical text
  clinicalText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
    paddingHorizontal: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },

  // Manual entry button
  manualBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  manualBtnTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  manualBtnSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },

  // Footer
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  nextButtonText: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
