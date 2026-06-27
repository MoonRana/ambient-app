import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { CME_CREDITS, CME_DISCLAIMER, type CmeTidbit } from '@/lib/cme/cme-config';
import { logCmeActivity, hasClaimedTidbit } from '@/lib/cme/cme-api';

interface Props {
  jobId: string;
  tidbits: CmeTidbit[];
}

export default function CmeTidbitsPanel({ jobId, tidbits }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const claimed = new Set<string>();
      for (const t of tidbits) {
        if (await hasClaimedTidbit(jobId, t.id)) claimed.add(t.id);
      }
      setClaimedIds(claimed);
    })();
  }, [jobId, tidbits]);

  const handleClaim = useCallback(
    (tidbit: CmeTidbit) => {
      if (claimedIds.has(tidbit.id)) return;

      Alert.alert(
        'Claim learning credit',
        `${tidbit.topic}\n\nI attest that I reviewed this pearl for my practice.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: `Claim ${CME_CREDITS.note_tidbit} hr`,
            onPress: async () => {
              const row = await logCmeActivity({
                activity_type: 'note_tidbit',
                topic: tidbit.topic,
                summary: tidbit.body,
                job_id: jobId,
                tidbit_id: tidbit.id,
              });
              if (row) {
                setClaimedIds((prev) => new Set(prev).add(tidbit.id));
                if (Platform.OS !== 'web') {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
              }
            },
          },
        ],
      );
    },
    [claimedIds, jobId],
  );

  if (!tidbits.length) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(350).delay(200)}
      style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.header}>
        <Ionicons name="school-outline" size={18} color={colors.accent} />
        <Text style={[styles.title, { color: colors.text }]}>Learning tidbits</Text>
        <Text style={[styles.badge, { color: colors.textTertiary }]}>
          {CME_CREDITS.note_tidbit} hr each
        </Text>
      </View>
      <Text style={[styles.disclaimer, { color: colors.textTertiary }]}>{CME_DISCLAIMER}</Text>

      {tidbits.map((t, i) => {
        const claimed = claimedIds.has(t.id);
        return (
          <Pressable
            key={t.id}
            onPress={() => handleClaim(t)}
            style={({ pressed }) => [
              styles.tidbit,
              {
                backgroundColor: claimed ? `${colors.accent}08` : colors.surfaceSecondary,
                borderColor: claimed ? colors.accent : colors.border,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Ionicons
              name={claimed ? 'checkbox' : 'square-outline'}
              size={22}
              color={claimed ? colors.accent : colors.textTertiary}
            />
            <View style={styles.tidbitBody}>
              <Text style={[styles.tidbitTopic, { color: colors.tint }]}>{t.topic}</Text>
              <Text style={[styles.tidbitText, { color: colors.textSecondary }]}>{t.body}</Text>
            </View>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  badge: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  disclaimer: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    lineHeight: 15,
  },
  tidbit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  tidbitBody: { flex: 1, gap: 4 },
  tidbitTopic: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tidbitText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
});
