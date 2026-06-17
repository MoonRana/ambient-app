import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, Linking, ScrollView, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withSequence, Easing, FadeInDown,
} from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions } from '@/lib/session-context';
import InfoCard from '@/components/InfoCard';
import { useEffectiveColorScheme, useSettings } from '@/lib/settings-context';
import { permissionContextCopy } from '@/lib/clinical-settings';

export default function PermissionScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isCompact = height < 700 || width > 500;
  const { createSession, currentSession } = useSessions();
  const { clinicalSetting } = useSettings();
  const [permissionResponse, requestPermission] = Audio.usePermissions();

  const micPulse = useSharedValue(1);

  useEffect(() => {
    micPulse.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
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
      if (!currentSession) createSession();
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
      if (!currentSession) createSession();
      router.replace('/(recording)/record');
    }
  }, [permissionResponse?.granted]);

  const permissionDeniedPermanently =
    permissionResponse &&
    !permissionResponse.granted &&
    permissionResponse.status === 'denied' &&
    !permissionResponse.canAskAgain;

  const webTopInset = Platform.OS === 'web' ? 20 : 0;
  const micOuterSize = isCompact ? 110 : 140;
  const micInnerSize = isCompact ? 80 : 100;
  const micIconSize = isCompact ? 40 : 48;

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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        bounces
      >
        <View style={[styles.content, { maxWidth: Math.min(width - 48, 520) }]}>
          <Animated.View entering={FadeInDown.duration(400)} style={styles.micSection}>
            <Animated.View
              style={[
                styles.micOuter,
                { backgroundColor: `${colors.tint}15`, width: micOuterSize, height: micOuterSize, borderRadius: micOuterSize / 2 },
                pulseStyle,
              ]}
            >
              <View style={[styles.micInner, { backgroundColor: `${colors.tint}25`, width: micInnerSize, height: micInnerSize, borderRadius: micInnerSize / 2 }]}>
                <Ionicons name="mic" size={micIconSize} color={colors.tint} />
              </View>
            </Animated.View>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(400).delay(80)} style={styles.textSection}>
            <Text style={[styles.title, { color: colors.text, fontSize: isCompact ? 22 : 24 }]}>
              Microphone Access
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              DoMyNote needs microphone access to record patient encounters for clinical documentation.
            </Text>
            <Text style={[styles.contextLine, { color: colors.textTertiary }]}>
              {permissionContextCopy(clinicalSetting)}
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(400).delay(160)} style={styles.infoCards}>
            <InfoCard
              icon="shield-checkmark-outline"
              title="Secure Recording"
              description="Audio is processed securely and only shared with AI services after your consent"
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
      </ScrollView>

      <View style={[
        styles.footer,
        {
          paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16) + 8,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
      ]}>
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
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
        )}
      </View>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: 8,
    alignItems: 'center',
  },
  content: {
    width: '100%',
    paddingHorizontal: 24,
    gap: 20,
  },
  micSection: {
    alignItems: 'center',
    paddingTop: 8,
  },
  micOuter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  micInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textSection: {
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  contextLine: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 4,
  },
  infoCards: {
    gap: 10,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
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
