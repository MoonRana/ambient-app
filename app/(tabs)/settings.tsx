import React from 'react';
import {
  View, Text, StyleSheet, Switch, Pressable, useColorScheme, Platform, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeColors } from '@/constants/colors';
import { useSettings } from '@/lib/settings-context';
import { useSessions } from '@/lib/session-context';

function SettingRow({
  icon,
  iconColor,
  title,
  subtitle,
  toggle,
  value,
  onValueChange,
  onPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  subtitle?: string;
  toggle?: boolean;
  value?: boolean;
  onValueChange?: (v: boolean) => void;
  onPress?: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const content = (
    <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.settingIcon, { backgroundColor: `${iconColor}20` }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.settingContent}>
        <Text style={[styles.settingTitle, { color: colors.text }]}>{title}</Text>
        {subtitle && (
          <Text style={[styles.settingSubtitle, { color: colors.textTertiary }]}>{subtitle}</Text>
        )}
      </View>
      {toggle && (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: colors.border, true: colors.tint }}
          thumbColor="#fff"
        />
      )}
      {onPress && !toggle && (
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      )}
    </View>
  );

  if (onPress && !toggle) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
        {content}
      </Pressable>
    );
  }

  return content;
}

export default function SettingsTab() {
  const colorScheme = useColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const { sessions } = useSessions();

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const handleClearData = () => {
    Alert.alert(
      'Clear All Data',
      'This will delete all sessions and reset settings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.clear();
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 16,
            paddingBottom: Platform.OS === 'web' ? 84 + 34 : insets.bottom + 100,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Recording</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <SettingRow
              icon="mic"
              iconColor={colors.tint}
              title="High Quality Audio"
              subtitle="Records at higher bitrate for better transcription"
              toggle
              value={settings.highQualityAudio}
              onValueChange={settings.setHighQualityAudio}
              colors={colors}
            />
            <SettingRow
              icon="save"
              iconColor={colors.accent}
              title="Auto-Save Sessions"
              subtitle="Automatically save recordings when stopped"
              toggle
              value={settings.autoSave}
              onValueChange={settings.setAutoSave}
              colors={colors}
            />
            <SettingRow
              icon="phone-portrait"
              iconColor={colors.warning}
              title="Haptic Feedback"
              subtitle="Vibration feedback on key actions"
              toggle
              value={settings.hapticFeedback}
              onValueChange={settings.setHapticFeedback}
              colors={colors}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Data</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <SettingRow
              icon="folder"
              iconColor={colors.tint}
              title="Local Storage"
              subtitle={`${sessions.length} session${sessions.length !== 1 ? 's' : ''} stored on device`}
              colors={colors}
            />
            <SettingRow
              icon="trash"
              iconColor={colors.recording}
              title="Clear All Data"
              subtitle="Delete all sessions and reset settings"
              onPress={handleClearData}
              colors={colors}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>About</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <SettingRow
              icon="shield-checkmark"
              iconColor={colors.accent}
              title="HIPAA Compliance"
              subtitle="All data is stored locally and encrypted"
              colors={colors}
            />
            <SettingRow
              icon="information-circle"
              iconColor={colors.tint}
              title="Version"
              subtitle="1.0.0"
              colors={colors}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingLeft: 4,
  },
  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingContent: {
    flex: 1,
    gap: 2,
  },
  settingTitle: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  settingSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
