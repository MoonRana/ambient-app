import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  FlatList, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useFreestyleStore } from '@/lib/stores/useFreestyleStore';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

interface Props {
  workflowId: string;
  patientId: string | null;
  patientInfo?: {
    name?: string;
    dateOfBirth?: string;
  };
}

interface PatientRow {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
}

export default function PatientLinkCard({ workflowId, patientId, patientInfo }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const { user } = useAuth();
  const setPatientId = useFreestyleStore((s) => s.setPatientId);
  const setPatientInfoStore = useFreestyleStore((s) => s.setPatientInfo);

  const [mode, setMode] = useState<'linked' | 'search' | 'create'>( 
    patientId ? 'linked' : 'search',
  );
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Load patients when search opens
  useEffect(() => {
    if (showSearch && user) {
      loadPatients();
    }
  }, [showSearch]);

  // Debounced search
  useEffect(() => {
    if (!showSearch || !user) return;
    const timer = setTimeout(() => loadPatients(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const loadPatients = useCallback(async (query?: string) => {
    if (!user) return;
    setLoading(true);
    try {
      let q = supabase
        .from('patients')
        .select('id, first_name, last_name, date_of_birth')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(15);

      if (query?.trim()) {
        const term = `%${query.trim()}%`;
        q = q.or(`first_name.ilike.${term},last_name.ilike.${term}`);
      }

      const { data, error } = await q;
      if (error) throw error;
      setPatients(data || []);
    } catch (e: any) {
      console.error('Patient search failed:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const handleSelectPatient = (patient: PatientRow) => {
    setPatientId(workflowId, patient.id);
    setPatientInfoStore(workflowId, {
      name: `${patient.first_name} ${patient.last_name}`,
      dateOfBirth: patient.date_of_birth || undefined,
    });
    setMode('linked');
    setShowSearch(false);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleUnlink = () => {
    setPatientId(workflowId, null);
    setPatientInfoStore(workflowId, undefined);
    setMode('search');
    setShowSearch(false);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSkip = () => {
    setShowSearch(false);
    setMode('search');
  };

  // ── Linked state ──
  if (mode === 'linked' && patientId) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.tint }]}>
        <View style={styles.linkedRow}>
          <View style={[styles.avatar, { backgroundColor: `${colors.tint}15` }]}>
            <Ionicons name="person" size={16} color={colors.tint} />
          </View>
          <View style={styles.linkedInfo}>
            <Text style={[styles.linkedName, { color: colors.text }]}>
              {patientInfo?.name || 'Linked Patient'}
            </Text>
            {patientInfo?.dateOfBirth && (
              <Text style={[styles.linkedDob, { color: colors.textTertiary }]}>
                DOB: {patientInfo.dateOfBirth}
              </Text>
            )}
          </View>
          <Pressable
            onPress={handleUnlink}
            hitSlop={8}
            style={({ pressed }) => [
              styles.unlinkBtn,
              { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="close" size={14} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Search / unlinked state ──
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconBadge, { backgroundColor: `${colors.tint}15` }]}>
            <Ionicons name="person-add" size={16} color={colors.tint} />
          </View>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Patient</Text>
            <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
              Optional — link or skip
            </Text>
          </View>
        </View>
      </View>

      {!showSearch ? (
        <View style={styles.btnRow}>
          <Pressable
            onPress={() => setShowSearch(true)}
            style={({ pressed }) => [
              styles.linkBtn,
              { backgroundColor: `${colors.tint}10`, borderColor: colors.tint, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="search-outline" size={16} color={colors.tint} />
            <Text style={[styles.linkBtnText, { color: colors.tint }]}>Link Patient</Text>
          </Pressable>
        </View>
      ) : (
        <Animated.View entering={FadeInDown.duration(200)} style={styles.searchSection}>
          {/* Search input */}
          <View style={[styles.searchBar, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search patients..."
              placeholderTextColor={colors.textTertiary}
              value={search}
              onChangeText={setSearch}
              autoFocus
              autoCapitalize="words"
            />
            {loading && <ActivityIndicator size="small" color={colors.tint} />}
          </View>

          {/* Results */}
          {patients.length > 0 && (
            <View style={styles.resultsList}>
              {patients.slice(0, 5).map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => handleSelectPatient(p)}
                  style={({ pressed }) => [
                    styles.resultRow,
                    { backgroundColor: pressed ? colors.surfaceSecondary : 'transparent' },
                  ]}
                >
                  <View style={[styles.resultAvatar, { backgroundColor: colors.surfaceSecondary }]}>
                    <Ionicons name="person-outline" size={14} color={colors.textTertiary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.resultName, { color: colors.text }]}>
                      {p.first_name} {p.last_name}
                    </Text>
                    {p.date_of_birth && (
                      <Text style={[styles.resultDob, { color: colors.textTertiary }]}>
                        DOB: {p.date_of_birth}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          )}

          {/* Skip button */}
          <Pressable onPress={handleSkip} style={{ padding: 8, alignSelf: 'center' }}>
            <Text style={[styles.skipText, { color: colors.textTertiary }]}>Skip for now</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  linkBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  linkBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  // Linked state
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkedInfo: {
    flex: 1,
    gap: 2,
  },
  linkedName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  linkedDob: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  unlinkBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Search
  searchSection: {
    gap: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  resultsList: {
    gap: 2,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
  },
  resultAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultName: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  resultDob: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  skipText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
});
