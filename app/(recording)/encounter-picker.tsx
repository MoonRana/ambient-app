import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  TextInput, FlatList, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions } from '@/lib/session-context';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

interface PatientRow {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  created_at: string;
  _encounterCount?: number;
  _lastEncounter?: string;
  _activeSession?: any;
}

export default function EncounterPickerScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { createSession, createLinkedSession, resumeFromCloud, setCurrentSession } = useSessions();
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  // Load recent patients on mount
  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = useCallback(async (query?: string) => {
    if (!user) return;
    const isSearch = !!query?.trim();
    if (isSearch) setSearching(true); else setLoading(true);

    try {
      let q = supabase
        .from('patients')
        .select('id, first_name, last_name, date_of_birth, created_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(25);

      if (query?.trim()) {
        // Search by name (first or last)
        const term = `%${query.trim()}%`;
        q = q.or(`first_name.ilike.${term},last_name.ilike.${term}`);
      }

      const { data, error } = await q;
      if (error) throw error;

      // Enrich with encounter count + active sessions in parallel
      const enriched = await Promise.all(
        (data || []).map(async (p: PatientRow) => {
          const [encounterRes, sessionRes] = await Promise.all([
            supabase
              .from('patient_encounters')
              .select('id, encounter_date', { count: 'exact', head: false })
              .eq('patient_id', p.id)
              .order('encounter_date', { ascending: false })
              .limit(1),
            supabase
              .from('ambient_sessions')
              .select('*')
              .eq('patient_id', p.id)
              .eq('status', 'in_progress')
              .order('updated_at', { ascending: false })
              .limit(1),
          ]);

          return {
            ...p,
            _encounterCount: encounterRes.count || 0,
            _lastEncounter: encounterRes.data?.[0]?.encounter_date,
            _activeSession: sessionRes.data?.[0] || null,
          };
        })
      );

      setPatients(enriched);
    } catch (e: any) {
      console.error('Failed to load patients:', e?.message);
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }, [user]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadPatients(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const handleNewPatient = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createSession();
    router.replace('/(recording)/permission');
  };

  const handleSelectPatient = (patient: PatientRow) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (patient._activeSession) {
      // Found an in-progress session — offer resume
      Alert.alert(
        'Resume Encounter?',
        `An in-progress encounter exists for ${patient.first_name} ${patient.last_name}. Would you like to resume it or start a new one?`,
        [
          {
            text: 'Resume',
            onPress: () => {
              resumeFromCloud(patient._activeSession);
              router.replace('/(recording)/review');
            },
          },
          {
            text: 'New Encounter',
            onPress: () => {
              startLinkedSession(patient);
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } else {
      startLinkedSession(patient);
    }
  };

  const startLinkedSession = (patient: PatientRow) => {
    createLinkedSession(patient.id, {
      name: `${patient.first_name} ${patient.last_name}`,
      dateOfBirth: patient.date_of_birth || undefined,
    });
    router.replace('/(recording)/permission');
  };

  const handleDismiss = () => {
    router.dismissAll();
  };

  const webTopInset = Platform.OS === 'web' ? 20 : 0;

  const renderPatient = ({ item, index }: { item: PatientRow; index: number }) => {
    const hasActive = !!item._activeSession;
    return (
      <Animated.View entering={FadeInDown.duration(250).delay(index * 40)}>
        <Pressable
          onPress={() => handleSelectPatient(item)}
          style={({ pressed }) => [
            styles.patientRow,
            {
              backgroundColor: colors.surface,
              borderColor: hasActive ? colors.tint : colors.border,
              borderWidth: hasActive ? 1.5 : 1,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          {/* Avatar */}
          <View style={[styles.avatar, { backgroundColor: hasActive ? `${colors.tint}18` : colors.surfaceSecondary }]}>
            <Ionicons
              name={hasActive ? 'mic' : 'person'}
              size={18}
              color={hasActive ? colors.tint : colors.textTertiary}
            />
          </View>

          {/* Info */}
          <View style={styles.patientInfo}>
            <Text style={[styles.patientName, { color: colors.text }]} numberOfLines={1}>
              {item.first_name} {item.last_name}
            </Text>
            <View style={styles.patientMeta}>
              {item.date_of_birth && (
                <Text style={[styles.metaText, { color: colors.textTertiary }]}>
                  DOB: {item.date_of_birth}
                </Text>
              )}
              {(item._encounterCount ?? 0) > 0 && (
                <Text style={[styles.metaText, { color: colors.textTertiary }]}>
                  {item._encounterCount} encounter{item._encounterCount !== 1 ? 's' : ''}
                </Text>
              )}
            </View>
          </View>

          {/* Right side */}
          <View style={styles.patientRight}>
            {hasActive ? (
              <View style={[styles.resumeBadge, { backgroundColor: `${colors.tint}18` }]}>
                <Ionicons name="play-circle" size={12} color={colors.tint} />
                <Text style={[styles.resumeBadgeText, { color: colors.tint }]}>Resume</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            )}
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <Pressable
          onPress={handleDismiss}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>

        <View style={[styles.titlePill, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="people-outline" size={14} color={colors.tint} />
          <Text style={[styles.titlePillText, { color: colors.text }]}>Start Encounter</Text>
        </View>

        <View style={{ width: 36 }} />
      </View>

      {/* New Patient — Top CTA */}
      <Animated.View entering={FadeIn.duration(400)} style={styles.newSection}>
        <Pressable
          onPress={handleNewPatient}
          style={({ pressed }) => [
            styles.newPatientBtn,
            {
              backgroundColor: colors.recording,
              shadowColor: colors.recording,
              opacity: pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
        >
          <View style={styles.newPatientIcon}>
            <Ionicons name="mic" size={24} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.newPatientTitle}>New Patient</Text>
            <Text style={styles.newPatientSub}>Start a fresh encounter</Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </Animated.View>

      {/* Divider */}
      <Animated.View entering={FadeIn.duration(300).delay(100)} style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        <Text style={[styles.dividerText, { color: colors.textTertiary }]}>or select existing patient</Text>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
      </Animated.View>

      {/* Search Bar */}
      <Animated.View entering={FadeInDown.duration(300).delay(150)} style={styles.searchSection}>
        <View style={[styles.searchWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search patients..."
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="words"
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color={colors.tint} />}
          {search.length > 0 && !searching && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>
      </Animated.View>

      {/* Patient List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading patients...</Text>
        </View>
      ) : (
        <FlatList
          data={patients}
          keyExtractor={item => item.id}
          renderItem={renderPatient}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16) + 16 },
          ]}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Animated.View entering={FadeIn.duration(300)} style={styles.emptyState}>
              <Ionicons name="people-outline" size={40} color={colors.textTertiary} />
              <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
                {search ? 'No patients found' : 'No patients yet'}
              </Text>
              <Text style={[styles.emptySubText, { color: colors.textTertiary }]}>
                {search
                  ? `No results for "${search}". Try a different search or start a new encounter.`
                  : 'Complete your first encounter to see patients here.'
                }
              </Text>
            </Animated.View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  titlePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  titlePillText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  // New Patient CTA
  newSection: { paddingHorizontal: 20, paddingTop: 12 },
  newPatientBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 18, borderRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  newPatientIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  newPatientTitle: {
    fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff',
  },
  newPatientSub: {
    fontSize: 13, fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.75)', marginTop: 2,
  },

  // Divider
  dividerRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, paddingHorizontal: 20, paddingVertical: 18,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  // Search
  searchSection: { paddingHorizontal: 20, paddingBottom: 12 },
  searchWrapper: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: 14, borderWidth: 1,
  },
  searchInput: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular',
  },

  // Patient List
  listContent: { paddingHorizontal: 20 },
  separator: { height: 8 },
  patientRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, borderRadius: 14, gap: 12,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  patientInfo: { flex: 1, gap: 3 },
  patientName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  patientMeta: { flexDirection: 'row', gap: 12 },
  metaText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  patientRight: { alignItems: 'flex-end' },
  resumeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  resumeBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },

  // Loading
  loadingContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  // Empty
  emptyState: {
    alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12,
  },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptySubText: {
    fontSize: 13, fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 19,
  },
});
