import React, { useState, useCallback } from 'react';
import { Text, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { CME_CREDITS } from '@/lib/cme/cme-config';
import { logCmeActivity, hasClaimedConsultMessage } from '@/lib/cme/cme-api';
import type { ConsultMessage } from '@/lib/consult-context';

interface Props {
  message: ConsultMessage;
  userQuestion?: string;
}

export default function CmeClaimChip({ message, userQuestion }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const [claimed, setClaimed] = useState(false);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    hasClaimedConsultMessage(message.id).then(setClaimed);
  }, [message.id]);

  const handleClaim = useCallback(async () => {
    if (claimed || loading) return;

    Alert.alert(
      'Claim CME credit',
      `Log ${CME_CREDITS.consult_search} hour for this clinical search?\n\nI attest that I reviewed this information for my practice.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Claim credit',
          onPress: async () => {
            setLoading(true);
            try {
              const sources = [
                ...(message.metadata?.guidelines ?? []),
                ...(message.metadata?.pubmedSources ?? []),
              ].map((s) => ({ title: s.title, url: s.url, pmid: s.pmid }));

              const row = await logCmeActivity({
                activity_type: 'consult_search',
                topic: userQuestion?.slice(0, 200) || 'Clinical consult search',
                summary: message.content.slice(0, 500),
                source_refs: sources,
                consult_message_id: message.id,
              });

              if (row) {
                setClaimed(true);
                if (Platform.OS !== 'web') {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                Alert.alert(
                  'CME logged',
                  `+${CME_CREDITS.consult_search} hr added to My CME.`,
                );
              }
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }, [claimed, loading, message, userQuestion]);

  if (message.streaming || message.error || !message.content) return null;

  return (
    <Animated.View entering={FadeInDown.duration(200)}>
      <Pressable
        onPress={claimed ? undefined : handleClaim}
        style={({ pressed }) => [
          styles.chip,
          {
            backgroundColor: claimed ? `${colors.accent}15` : `${colors.tint}12`,
            borderColor: claimed ? colors.accent : colors.tint,
            opacity: pressed && !claimed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons
          name={claimed ? 'checkmark-circle' : 'school-outline'}
          size={16}
          color={claimed ? colors.accent : colors.tint}
        />
        <Text style={[styles.chipText, { color: claimed ? colors.accent : colors.tint }]}>
          {claimed
            ? `${CME_CREDITS.consult_search} hr claimed`
            : loading
              ? 'Logging…'
              : `Claim ${CME_CREDITS.consult_search} CME hr`}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  chipText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
});
