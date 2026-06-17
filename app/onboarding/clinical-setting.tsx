import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme, useSettings } from '@/lib/settings-context';
import type { ClinicalSetting } from '@/lib/clinical-settings';
import { BrandMark } from '@/components/BrandLogo';

const OPTIONS: Array<{
  id: ClinicalSetting;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  {
    id: 'clinic',
    title: 'Clinic',
    description: 'Upload labs, medications, and prior notes — generate H&P notes fast.',
    icon: 'business-outline',
  },
  {
    id: 'nursing_home',
    title: 'Nursing Home',
    description: 'Document-heavy rounds — photo labs and med lists, skip recording when possible.',
    icon: 'bed-outline',
  },
  {
    id: 'assisted_living',
    title: 'Assisted Living',
    description: 'Often solo visits — ambient recording helps when you work alone.',
    icon: 'home-outline',
  },
];

export default function ClinicalSettingOnboarding() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useSettings();
  const [selected, setSelected] = useState<ClinicalSetting>('clinic');

  const handleContinue = () => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    completeOnboarding(selected);
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
          <BrandMark size={36} tintColor={colors.tint} />
          <Text style={[styles.title, { color: colors.text }]}>Where do you practice?</Text>
          <Text style={[styles.lead, { color: colors.textSecondary }]}>
            We&apos;ll tailor your home screen and note workflows. You can change this anytime in Settings.
          </Text>
        </Animated.View>

        <View style={styles.options}>
          {OPTIONS.map((opt, i) => {
            const isActive = selected === opt.id;
            return (
              <Animated.View key={opt.id} entering={FadeInDown.duration(350).delay(80 + i * 60)}>
                <Pressable
                  onPress={() => {
                    setSelected(opt.id);
                    if (Platform.OS !== 'web') Haptics.selectionAsync();
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: isActive ? `${colors.tint}10` : colors.surface,
                      borderColor: isActive ? colors.tint : colors.border,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <View style={[styles.optionIcon, { backgroundColor: isActive ? colors.tintLight : colors.surfaceSecondary }]}>
                    <Ionicons name={opt.icon} size={24} color={isActive ? colors.tint : colors.textSecondary} />
                  </View>
                  <View style={styles.optionText}>
                    <Text style={[styles.optionTitle, { color: colors.text }]}>{opt.title}</Text>
                    <Text style={[styles.optionDesc, { color: colors.textSecondary }]}>{opt.description}</Text>
                  </View>
                  {isActive && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.tint} />
                  )}
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <Pressable
          onPress={handleContinue}
          style={({ pressed }) => [
            styles.continueBtn,
            { backgroundColor: colors.tint, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={styles.continueText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, gap: 24 },
  header: { alignItems: 'center', gap: 12, paddingTop: 24 },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  lead: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, textAlign: 'center' },
  options: { gap: 12 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, gap: 4 },
  optionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  optionDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  continueBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  continueText: { color: '#fff', fontSize: 17, fontFamily: 'Inter_600SemiBold' },
});
