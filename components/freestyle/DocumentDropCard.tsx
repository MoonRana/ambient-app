import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform } from 'react-native';
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
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export default function DocumentDropCard({ workflowId, documents }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const addDocument = useFreestyleStore((s) => s.addDocument);
  const removeDocument = useFreestyleStore((s) => s.removeDocument);

  const handlePickImages = useCallback(async () => {
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
        const size = asset.fileSize ?? 0;
        if (size > MAX_FILE_SIZE) {
          Alert.alert('File Too Large', `${asset.fileName ?? 'Image'} exceeds 50MB limit.`);
          continue;
        }
        addDocument(workflowId, {
          uri: asset.uri,
          name: asset.fileName ?? `Photo ${Date.now()}`,
          type: 'image',
          sizeBytes: size,
          thumbnailUri: asset.uri,
        });
      }
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [workflowId, addDocument]);

  const handleCamera = useCallback(async () => {
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
      const asset = result.assets[0];
      addDocument(workflowId, {
        uri: asset.uri,
        name: asset.fileName ?? `Capture ${Date.now()}`,
        type: 'image',
        sizeBytes: asset.fileSize ?? 0,
        thumbnailUri: asset.uri,
      });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [workflowId, addDocument]);

  const handleRemove = useCallback((docId: string) => {
    removeDocument(workflowId, docId);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [workflowId, removeDocument]);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconBadge, { backgroundColor: `${colors.tint}15` }]}>
            <Ionicons name="document-text" size={16} color={colors.tint} />
          </View>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Documents</Text>
            <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
              {documents.length > 0
                ? `${documents.length} file${documents.length !== 1 ? 's' : ''}`
                : 'PDFs, photos, insurance cards'}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handlePickImages}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="images-outline" size={16} color={colors.tint} />
          </Pressable>
          <Pressable
            onPress={handleCamera}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: colors.tint, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="camera" size={16} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Document chips */}
      {documents.length > 0 && (
        <Animated.View entering={FadeInDown.duration(200)} style={styles.chipsContainer}>
          {documents.map((doc) => (
            <Animated.View
              key={doc.id}
              entering={FadeIn.duration(200)}
              style={[styles.chip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            >
              {doc.thumbnailUri ? (
                <Image
                  source={{ uri: doc.thumbnailUri }}
                  style={styles.chipThumb}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.chipThumb, { backgroundColor: `${colors.tint}15`, alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="document" size={14} color={colors.tint} />
                </View>
              )}
              <View style={styles.chipInfo}>
                <Text style={[styles.chipName, { color: colors.text }]} numberOfLines={1}>
                  {doc.name}
                </Text>
                {doc.sizeBytes > 0 && (
                  <Text style={[styles.chipSize, { color: colors.textTertiary }]}>
                    {formatSize(doc.sizeBytes)}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => handleRemove(doc.id)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
              </Pressable>
            </Animated.View>
          ))}
        </Animated.View>
      )}

      {/* Empty state tap target */}
      {documents.length === 0 && (
        <Pressable
          onPress={handlePickImages}
          style={({ pressed }) => [
            styles.emptyDrop,
            {
              borderColor: colors.border,
              backgroundColor: pressed ? `${colors.tint}08` : 'transparent',
            },
          ]}
        >
          <Ionicons name="cloud-upload-outline" size={24} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            Tap to add documents or photos
          </Text>
        </Pressable>
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
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsContainer: {
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
    gap: 10,
  },
  chipThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  chipInfo: {
    flex: 1,
    gap: 2,
  },
  chipName: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  chipSize: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  emptyDrop: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
});
