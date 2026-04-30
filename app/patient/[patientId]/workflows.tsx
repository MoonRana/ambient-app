import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, FlatList,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { listPatientWorkflows } from '@/lib/api/freestyle';
import AddWorkflowSheet from '@/components/patient/AddWorkflowSheet';

interface WorkflowRow {
  id: string;
  workflow_type: string;
  status: string;
  label: string | null;
  created_at: string;
  updated_at: string;
}

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  freestyle: { icon: 'sparkles', label: 'Freestyle', color: '#5B5CFF' },
  document: { icon: 'document-text', label: 'Documents', color: '#2ECC71' },
  ambient: { icon: 'mic', label: 'Ambient', color: '#E74C3C' },
  quicknote: { icon: 'create', label: 'Quick Note', color: '#F39C12' },
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function PatientWorkflowsScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();

  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddSheet, setShowAddSheet] = useState(false);

  useEffect(() => {
    if (patientId) loadWorkflows();
  }, [patientId]);

  const loadWorkflows = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const data = await listPatientWorkflows(patientId);
      setWorkflows(data);
    } catch (e: any) {
      console.error('Failed to load workflows:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const renderWorkflow = ({ item, index }: { item: WorkflowRow; index: number }) => {
    const config = TYPE_CONFIG[item.workflow_type] || TYPE_CONFIG.freestyle;

    return (
      <Animated.View entering={FadeInDown.duration(250).delay(index * 50)}>
        <Pressable
          style={({ pressed }) => [
            styles.workflowCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={[styles.typeIcon, { backgroundColor: `${config.color}15` }]}>
            <Ionicons name={config.icon as any} size={20} color={config.color} />
          </View>
          <View style={styles.workflowInfo}>
            <Text style={[styles.workflowTitle, { color: colors.text }]}>
              {item.label || config.label}
            </Text>
            <Text style={[styles.workflowMeta, { color: colors.textTertiary }]}>
              {config.label} · {formatDate(item.updated_at)} · {item.status}
            </Text>
          </View>
          <View style={[styles.statusDot, {
            backgroundColor: item.status === 'active'
              ? colors.accent
              : item.status === 'completed'
                ? colors.tint
                : colors.textTertiary,
          }]} />
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backBtn,
            { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Workflows</Text>
        <Pressable
          onPress={() => setShowAddSheet(true)}
          hitSlop={12}
          style={({ pressed }) => [
            styles.addBtn,
            { backgroundColor: `${colors.tint}15`, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="add" size={20} color={colors.tint} />
        </Pressable>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.tint} />
        </View>
      ) : (
        <FlatList
          data={workflows}
          keyExtractor={(item) => item.id}
          renderItem={renderWorkflow}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 40 },
          ]}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Animated.View entering={FadeIn.duration(400)} style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="layers-outline" size={36} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
                No workflows yet
              </Text>
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                Add a workflow to start capturing clinical data for this patient.
              </Text>
              <Pressable
                onPress={() => setShowAddSheet(true)}
                style={({ pressed }) => [
                  styles.emptyBtn,
                  { backgroundColor: colors.tint, opacity: pressed ? 0.9 : 1 },
                ]}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.emptyBtnText}>Add Workflow</Text>
              </Pressable>
            </Animated.View>
          }
        />
      )}

      {/* Add Workflow Sheet */}
      <AddWorkflowSheet
        visible={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        patientId={patientId}
      />
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
    paddingBottom: 16,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingHorizontal: 20,
  },
  separator: { height: 8 },
  // Workflow card
  workflowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workflowInfo: {
    flex: 1,
    gap: 3,
  },
  workflowTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  workflowMeta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  emptyBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
