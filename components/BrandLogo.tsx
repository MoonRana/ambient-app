import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface BrandLogoProps {
  size?: 'small' | 'medium' | 'large';
  showTagline?: boolean;
  color?: string;
  tintColor?: string;
}

const SIZES = {
  small: { icon: 20, iconBox: 32, iconRadius: 10, name: 16, tagline: 0 },
  medium: { icon: 26, iconBox: 48, iconRadius: 14, name: 20, tagline: 12 },
  large: { icon: 32, iconBox: 72, iconRadius: 22, name: 28, tagline: 14 },
};

/**
 * Branded DoMyNote logo component used across the app.
 * Replaces generic Ionicon usage with a distinctive, consistent brand mark.
 */
export default function BrandLogo({
  size = 'medium',
  showTagline = false,
  color,
  tintColor = '#0B6E99',
}: BrandLogoProps) {
  const s = SIZES[size];

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.iconBox,
          {
            width: s.iconBox,
            height: s.iconBox,
            borderRadius: s.iconRadius,
            backgroundColor: tintColor,
          },
        ]}
      >
        {/* Stacked icons: stethoscope + sparkle to convey "AI + Clinical" */}
        <View style={styles.iconStack}>
          <Ionicons name="pulse" size={s.icon * 0.65} color="#fff" style={styles.pulseIcon} />
          <Ionicons name="sparkles" size={s.icon * 0.45} color="rgba(255,255,255,0.9)" style={styles.sparkleIcon} />
        </View>
      </View>
      <View style={styles.textWrap}>
        <Text
          style={[
            styles.brandName,
            { fontSize: s.name, color: color || '#0A1628' },
          ]}
        >
          DoMy<Text style={[styles.brandAccent, { color: tintColor }]}>Note</Text>
        </Text>
        {showTagline && s.tagline > 0 && (
          <Text style={[styles.tagline, { fontSize: s.tagline, color: color ? `${color}99` : '#5A6578' }]}>
            AI Clinical Documentation
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Compact inline logo for headers and tab bars.
 */
export function BrandMark({
  size = 28,
  tintColor = '#0B6E99',
}: {
  size?: number;
  tintColor?: string;
}) {
  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: size * 0.3,
          backgroundColor: tintColor,
        },
      ]}
    >
      <View style={styles.markStack}>
        <Ionicons name="pulse" size={size * 0.5} color="#fff" />
        <Ionicons
          name="sparkles"
          size={size * 0.28}
          color="rgba(255,255,255,0.85)"
          style={{ position: 'absolute', top: -2, right: -3 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 10,
  },
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  iconStack: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseIcon: {
    // Main icon centered
  },
  sparkleIcon: {
    position: 'absolute',
    top: -6,
    right: -8,
  },
  textWrap: {
    alignItems: 'center',
    gap: 2,
  },
  brandName: {
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  brandAccent: {
    fontFamily: 'Inter_700Bold',
  },
  tagline: {
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  // Mark (compact)
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markStack: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
