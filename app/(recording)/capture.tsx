import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, useColorScheme, Platform,
  ScrollView, Alert,
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

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export default function CaptureScreen() {
  const colorScheme = useColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { currentSession, updateSession } = useSessions();
  const [images, setImages] = useState<CapturedImage[]>(currentSession?.capturedImages || []);

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
      }
    } catch (err) {
      console.error('Failed to capture image', err);
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleNext = () => {
    if (currentSession) {
      updateSession(currentSession.id, {
        capturedImages: images,
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

        <View style={[styles.stepIndicator, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={[styles.stepDot, { backgroundColor: colors.tint }]} />
          <View style={[styles.stepDot, { backgroundColor: colors.tint }]} />
          <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
        </View>

        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text style={[styles.title, { color: colors.text }]}>Capture Documents</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Photograph medication bottles, insurance cards, or other clinical documents.
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

        {images.length > 0 && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.imageSection}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              {images.length} document{images.length !== 1 ? 's' : ''} captured
            </Text>
            <View style={styles.imageGrid}>
              {images.map((img, idx) => (
                <Animated.View
                  key={img.id}
                  entering={FadeInDown.duration(300).delay(idx * 50)}
                  style={styles.imageWrapper}
                >
                  <Image
                    source={{ uri: img.uri }}
                    style={[styles.image, { borderColor: colors.border }]}
                    contentFit="cover"
                  />
                  <Pressable
                    onPress={() => removeImage(img.id)}
                    style={[styles.removeBtn, { backgroundColor: colors.recording }]}
                    hitSlop={8}
                  >
                    <Ionicons name="close" size={14} color="#fff" />
                  </Pressable>
                </Animated.View>
              ))}
            </View>
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
          </Animated.View>
        )}
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
    borderWidth: 1,
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
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
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
    fontFamily: 'Inter_400Regular',
  },
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
