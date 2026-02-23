import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withSequence, Easing, FadeInDown, FadeInUp,
} from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions } from '@/lib/session-context';
import InfoCard from '@/components/InfoCard';
import { useEffectiveColorScheme } from '@/lib/settings-context';

export default function PermissionScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { createSession } = useSessions();
  const [permissionResponse, requestPermission] = Audio.usePermissions();

  const micPulse = useSharedValue(1);

  useEffect(() => {
    micPulse.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: micPulse.value }],
  }));

  const handleRequestPermission = async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const result = await requestPermission();
    if (result?.granted) {
      createSession();
      router.replace('/(recording)/record');
    }
  };

  const handleOpenSettings = () => {
    if (Platform.OS !== 'web') {
      try {
        Linking.openSettings();
      } catch { }
    }
  };

  const handleDismiss = () => {
    router.dismissAll();
  };

  useEffect(() => {
    if (permissionResponse?.granted) {
      createSession();
      router.replace('/(recording)/record');
    }
  }, []);

  const permissionDeniedPermanently =
    permissionResponse &&
    !permissionResponse.granted &&
    permissionResponse.status === 'denied' &&
    !permissionResponse.canAskAgain;

  const webTopInset = Platform.OS === 'web' ? 20 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <Pressable
          onPress={handleDismiss}
          hitSlop={12}
          style={({ pressed }) => [
            styles.closeBtn,
            { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <Animated.View entering={FadeInDown.duration(600).delay(100)} style={styles.micSection}>
          <Animated.View
            style={[
              styles.micOuter,
              { backgroundColor: `${colors.tint}15` },
              pulseStyle,
            ]}
          >
            <View style={[styles.micInner, { backgroundColor: `${colors.tint}25` }]}>
              <Ionicons name="mic" size={48} color={colors.tint} />
            </View>
          </Animated.View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(600).delay(200)} style={styles.textSection}>
          <Text style={[styles.title, { color: colors.text }]}>
            Microphone Access
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            DoMyNote needs access to your microphone to record patient encounters for clinical documentation.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(600).delay(300)} style={styles.infoCards}>
          <InfoCard
            icon="shield-checkmark-outline"
            title="Secure Recording"
            description="Audio is processed locally and never shared without your consent"
            variant="accent"
          />
          <InfoCard
            icon="lock-closed-outline"
            title="HIPAA Compliant"
            description="All recordings follow healthcare privacy standards"
          />
          <InfoCard
            icon="trash-outline"
            title="You're in Control"
            description="Delete recordings at any time from your session history"
            variant="warning"
          />
        </Animated.View>
      </View>

      <Animated.View
        entering={FadeInUp.duration(600).delay(400)}
        style={[styles.footer, { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16) + 8 }]}
      >
        {permissionDeniedPermanently && Platform.OS !== 'web' ? (
          <Pressable
            onPress={handleOpenSettings}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: colors.tint, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Ionicons name="settings-outline" size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleRequestPermission}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: colors.tint, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Ionicons name="mic" size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>Allow Microphone</Text>
          </Pressable>
        )}
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
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 32,
  },
  micSection: {
    alignItems: 'center',
  },
  micOuter: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textSection: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  infoCards: {
    gap: 10,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  primaryButtonText: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
