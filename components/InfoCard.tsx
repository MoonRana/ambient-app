import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';

interface InfoCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  variant?: 'default' | 'accent' | 'warning';
}

export default function InfoCard({ icon, title, description, variant = 'default' }: InfoCardProps) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);

  const bgColor = variant === 'accent' ? colors.accentLight
    : variant === 'warning' ? colors.warningLight
      : colors.surfaceSecondary;

  const iconColor = variant === 'accent' ? colors.accent
    : variant === 'warning' ? colors.warning
      : colors.tint;

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={[styles.iconContainer, { backgroundColor: `${iconColor}20` }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 14,
    gap: 12,
    alignItems: 'flex-start',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  description: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
});
