import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useFreestyleStore, type DocumentInput } from '@/lib/stores/useFreestyleStore';

interface Props {
  workflowId: string;
  documents: DocumentInput[];
  autoCapture?: boolean;
  onAutoCaptureHandled?: () => void;
}

const DOC_TYPE_CHIPS = ['Lab Results', 'Medication List', 'Prior Note', 'Insurance'] as const;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export default function DocumentDropCard({
  workflowId,
  documents,
  autoCapture,
  onAutoCaptureHandled,
}: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const addDocument = useFreestyleStore((s) => s.addDocument);
  const removeDocument = useFreestyleStore((s) => s.removeDocument);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const autoCaptureDone = useRef(false);

  const addAsset = useCallback((asset: ImagePicker.ImagePickerAsset, label?: string | null) => {
    const size = asset.fileSize ?? 0;
    if (size > MAX_FILE_SIZE) {
      Alert.alert('File Too Large', `${asset.fileName ?? 'Image'} exceeds 50MB limit.`);
      return;
    }
    const baseName = asset.fileName ?? `Photo ${Date.now()}`;
    addDocument(workflowId, {
      uri: asset.uri,
      name: label ? `${label} — ${baseName}` : baseName,
      type: 'image',
      sizeBytes: size,
      thumbnailUri: asset.uri,
      label: label ?? undefined,
    });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [workflowId, addDocument]);

  const handlePickImages = useCallback(async (label?: string | null) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Photo library access is needed to select documents.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });

    if (!result.canceled && result.assets) {
      for (const asset of result.assets) {
        addAsset(asset, label ?? pendingLabel);
      }
      setPendingLabel(null);
    }
  }, [addAsset, pendingLabel]);

  const handleCamera = useCallback(async (label?: string | null) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera access is needed to capture documents.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets?.[0]) {
      addAsset(result.assets[0], label ?? pendingLabel);
      setPendingLabel(null);
    }
  }, [addAsset, pendingLabel]);

  useEffect(() => {
    if (!autoCapture || autoCaptureDone.current) return;
    autoCaptureDone.current = true;
    handleCamera().finally(() => onAutoCaptureHandled?.());
  }, [autoCapture, handleCamera, onAutoCaptureHandled]);

  const handleRemove = useCallback((docId: string) => {
    removeDocument(workflowId, docId);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [workflowId, removeDocument]);

  const handleChipPress = (chip: string) => {
    setPendingLabel(chip);
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    handleCamera(chip);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconBadge, { backgroundColor: `${colors.tint}15` }]}>
            <Ionicons name="document-text" size={16} color={colors.tint} />
          </View>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Documents</Text>
            <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
              {documents.length > 0
                ? `${documents.length} file${documents.length !== 1 ? 's' : ''} ready`
                : 'Labs, med lists, prior notes'}
            </Text>
          </View>
        </View>
      </View>

      <Pressable
        onPress={() => handleCamera()}
        style={({ pressed }) => [
          styles.primaryCameraBtn,
          {
            backgroundColor: colors.tint,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
        ]}
      >
        <Ionicons name="camera" size={22} color="#fff" />
        <Text style={styles.primaryCameraText}>Take Photo of Lab / Med List / Prior Note</Text>
      </Pressable>

      <Pressable
        onPress={() => handlePickImages()}
        style={({ pressed }) => [
          styles.secondaryBtn,
          { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="images-outline" size={18} color={colors.tint} />
        <Text style={[styles.secondaryBtnText, { color: colors.tint }]}>Choose from Photos</Text>
      </Pressable>

      {documents.length === 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeChipsRow}>
          {DOC_TYPE_CHIPS.map((chip) => (
            <Pressable
              key={chip}
              onPress={() => handleChipPress(chip)}
              style={({ pressed }) => [
                styles.typeChip,
                {
                  backgroundColor: pendingLabel === chip ? `${colors.tint}15` : colors.surfaceSecondary,
                  borderColor: pendingLabel === chip ? colors.tint : colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.typeChipText, { color: pendingLabel === chip ? colors.tint : colors.textSecondary }]}>
                {chip}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {documents.length > 0 && (
        <Animated.View entering={FadeInDown.duration(200)} style={styles.chipsContainer}>
          {documents.map((doc) => (
            <Animated.View
              key={doc.id}
              entering={FadeIn.duration(200)}
              style={[styles.chip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            >
              {doc.thumbnailUri ? (
                <Image source={{ uri: doc.thumbnailUri }} style={styles.chipThumb} contentFit="cover" />
              ) : (
                <View style={[styles.chipThumb, { backgroundColor: `${colors.tint}15`, alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="document" size={14} color={colors.tint} />
                </View>
              )}
              <View style={styles.chipInfo}>
                {doc.label && (
                  <Text style={[styles.chipLabel, { color: colors.tint }]}>{doc.label}</Text>
                )}
                <Text style={[styles.chipName, { color: colors.text }]} numberOfLines={1}>{doc.name}</Text>
                {doc.sizeBytes > 0 && (
                  <Text style={[styles.chipSize, { color: colors.textTertiary }]}>{formatSize(doc.sizeBytes)}</Text>
                )}
              </View>
              <Pressable onPress={() => handleRemove(doc.id)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
              </Pressable>
            </Animated.View>
          ))}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconBadge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  primaryCameraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  primaryCameraText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold', flexShrink: 1 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  typeChipsRow: { gap: 8, paddingVertical: 4 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  typeChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  chipsContainer: { gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, padding: 8, gap: 10 },
  chipThumb: { width: 40, height: 40, borderRadius: 8 },
  chipInfo: { flex: 1, gap: 2 },
  chipLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },
  chipName: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  chipSize: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});
