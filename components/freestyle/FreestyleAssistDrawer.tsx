import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, Platform,
  FlatList, ActivityIndicator, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeInUp, SlideInRight } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useFreestyleStore, type FreestyleWorkflow } from '@/lib/stores/useFreestyleStore';
import {
  sendAssistMessage,
  getRecommendations,
  type AssistMode,
  type AssistContext,
  type AssistRecommendation,
  type AssistSource,
  type AssistResponse,
} from '@/lib/api/freestyleAssist';

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  recommendations?: AssistRecommendation[];
  sources?: AssistSource[];
  isLoading?: boolean;
}

interface Props {
  workflow: FreestyleWorkflow;
  visible: boolean;
  onClose: () => void;
}

// ── Quick Actions ────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: '🔍 Diagnoses', prompt: 'What are the possible diagnoses based on the current information?' },
  { label: '💊 Drug interactions', prompt: 'Check for any drug interactions with the listed medications.' },
  { label: '📋 Missing data', prompt: 'What clinical data is missing that I should document?' },
  { label: '🏥 ICD-10 codes', prompt: 'Suggest relevant ICD-10 codes for this encounter.' },
  { label: '📝 Expand HPI', prompt: 'Help me expand the history of present illness based on the notes.' },
  { label: '🧪 Order labs', prompt: 'What labs should be ordered based on the clinical picture?' },
];

// ── Build Context ────────────────────────────────────────────────────────────

function buildContext(workflow: FreestyleWorkflow): AssistContext {
  return {
    notes: workflow.notes || '',
    medications: workflow.medications.map((m) => ({
      name: m.name,
      dose: m.dose,
      frequency: m.frequency,
    })),
    document_summaries: workflow.documents.map((d) => `[${d.type}] ${d.name}`),
    recording_transcripts: workflow.recordings
      .filter((r) => r.transcript)
      .map((r) => r.transcript!),
    patient_info: workflow.patientInfo
      ? {
          chief_complaint: workflow.notes.split('\n')[0]?.slice(0, 100),
        }
      : undefined,
  };
}

// ── Recommendation Card ──────────────────────────────────────────────────────

function RecommendationCard({
  rec,
  colors,
  index,
}: {
  rec: AssistRecommendation;
  colors: ReturnType<typeof useThemeColors>;
  index: number;
}) {
  const typeConfig: Record<string, { icon: string; color: string; label: string }> = {
    diagnosis: { icon: 'medkit', color: colors.tint, label: 'Diagnosis' },
    interaction: { icon: 'warning', color: colors.warning, label: 'Interaction' },
    missing_data: { icon: 'alert-circle', color: '#F39C12', label: 'Missing Data' },
    icd10_code: { icon: 'code-slash', color: colors.accent, label: 'ICD-10' },
  };

  const config = typeConfig[rec.type] || typeConfig.diagnosis;
  const severityColors: Record<string, string> = {
    critical: '#E74C3C',
    high: '#E67E22',
    moderate: '#F39C12',
    low: colors.accent,
    none: colors.textTertiary,
  };

  return (
    <Animated.View
      entering={SlideInRight.duration(200).delay(index * 60)}
      style={[recStyles.card, { backgroundColor: `${config.color}08`, borderColor: `${config.color}25` }]}
    >
      <View style={recStyles.cardHeader}>
        <Ionicons name={config.icon as any} size={14} color={config.color} />
        <Text style={[recStyles.typeLabel, { color: config.color }]}>{config.label}</Text>
        {rec.confidence != null && (
          <Text style={[recStyles.confidence, { color: colors.textTertiary }]}>
            {Math.round(rec.confidence * 100)}%
          </Text>
        )}
        {rec.severity && rec.severity !== 'none' && (
          <View style={[recStyles.severityDot, { backgroundColor: severityColors[rec.severity] || colors.textTertiary }]} />
        )}
      </View>
      <Text style={[recStyles.text, { color: colors.text }]}>{rec.text}</Text>
    </Animated.View>
  );
}

const recStyles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 5,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeLabel: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    flex: 1,
  },
  confidence: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 19,
  },
});

// ── Main Component ───────────────────────────────────────────────────────────

export default function FreestyleAssistDrawer({ workflow, visible, onClose }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sessionKey] = useState(() => `assist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  const context = useMemo(() => buildContext(workflow), [
    workflow.notes,
    workflow.medications,
    workflow.documents,
    workflow.recordings,
    workflow.patientInfo,
  ]);

  const conversationHistory = useMemo(
    () => messages.filter((m) => !m.isLoading).map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isSending) return;

    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!text) setInput('');
    Keyboard.dismiss();
    setIsSending(true);

    // Add user message + loading indicator
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: msg,
    };
    const loadingMsg: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      isLoading: true,
    };
    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const result = await sendAssistMessage({
        mode: 'chat',
        message: msg,
        session_key: sessionKey,
        workflow_id: workflow.workflowId,
        context,
        conversation_history: conversationHistory.slice(-10), // Last 10 turns
      });

      const assistantMsg: ChatMessage = {
        id: result.message_id || `asst-${Date.now()}`,
        role: 'assistant',
        content: result.reply,
        recommendations: result.recommendations?.length > 0 ? result.recommendations : undefined,
        sources: result.sources?.length > 0 ? result.sources : undefined,
      };

      setMessages((prev) => [...prev.filter((m) => !m.isLoading), assistantMsg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ ${e?.message || 'Something went wrong. Please try again.'}`,
      };
      setMessages((prev) => [...prev.filter((m) => !m.isLoading), errorMsg]);
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, sessionKey, workflow.workflowId, context, conversationHistory]);

  const handleGetRecommendations = useCallback(async () => {
    if (isSending) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSending(true);

    const loadingMsg: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      isLoading: true,
    };
    setMessages((prev) => [...prev, loadingMsg]);

    try {
      const result = await getRecommendations(context, sessionKey, workflow.workflowId);

      const assistantMsg: ChatMessage = {
        id: result.message_id || `rec-${Date.now()}`,
        role: 'assistant',
        content: result.reply,
        recommendations: result.recommendations,
        sources: result.sources,
      };

      setMessages((prev) => [...prev.filter((m) => !m.isLoading), assistantMsg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ ${e?.message || 'Failed to get recommendations.'}`,
      };
      setMessages((prev) => [...prev.filter((m) => !m.isLoading), errorMsg]);
    } finally {
      setIsSending(false);
    }
  }, [isSending, context, sessionKey, workflow.workflowId]);

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    if (item.isLoading) {
      return (
        <View style={styles.loadingBubble}>
          <ActivityIndicator size="small" color={colors.tint} />
          <Text style={[styles.loadingText, { color: colors.textTertiary }]}>Thinking...</Text>
        </View>
      );
    }

    if (item.role === 'user') {
      return (
        <Animated.View entering={FadeInDown.duration(150)}>
          <View style={[styles.userBubble, { backgroundColor: colors.tint }]}>
            <Text style={styles.userBubbleText}>{item.content}</Text>
          </View>
        </Animated.View>
      );
    }

    return (
      <Animated.View entering={FadeInDown.duration(200)} style={styles.assistantSection}>
        <View style={[styles.assistantBubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.assistantText, { color: colors.text }]}>{item.content}</Text>
        </View>

        {/* Recommendation cards */}
        {item.recommendations && item.recommendations.length > 0 && (
          <View style={styles.recsContainer}>
            {item.recommendations.map((rec, i) => (
              <RecommendationCard key={i} rec={rec} colors={colors} index={i} />
            ))}
          </View>
        )}

        {/* Source citations */}
        {item.sources && item.sources.length > 0 && (
          <View style={styles.sourcesRow}>
            <Ionicons name="book-outline" size={10} color={colors.textTertiary} />
            <Text style={[styles.sourcesText, { color: colors.textTertiary }]} numberOfLines={2}>
              {item.sources.map((s) => s.title).join(' · ')}
            </Text>
          </View>
        )}
      </Animated.View>
    );
  };

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeInUp.duration(300)}
      style={[styles.container, { backgroundColor: colors.background, borderColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.aiIcon, { backgroundColor: `${colors.tint}15` }]}>
            <Ionicons name="sparkles" size={14} color={colors.tint} />
          </View>
          <View>
            <Text style={[styles.headerTitle, { color: colors.text }]}>AI Assistant</Text>
            <Text style={[styles.headerSub, { color: colors.textTertiary }]}>
              RAG-grounded · 326 guidelines
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => [
            styles.closeBtn,
            { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="chevron-down" size={18} color={colors.text} />
        </Pressable>
      </View>

      {/* Messages area */}
      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
            How can I help?
          </Text>

          {/* Auto-recommend button */}
          <Pressable
            onPress={handleGetRecommendations}
            disabled={isSending}
            style={({ pressed }) => [
              styles.recommendBtn,
              {
                backgroundColor: `${colors.tint}10`,
                borderColor: colors.tint,
                opacity: isSending ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons name="bulb-outline" size={16} color={colors.tint} />
            <Text style={[styles.recommendBtnText, { color: colors.tint }]}>
              Auto-analyze workspace
            </Text>
          </Pressable>

          {/* Quick action chips */}
          <View style={styles.quickActions}>
            {QUICK_ACTIONS.map((action) => (
              <Pressable
                key={action.label}
                onPress={() => handleSend(action.prompt)}
                disabled={isSending}
                style={({ pressed }) => [
                  styles.quickChip,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.border,
                    opacity: isSending ? 0.5 : pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[styles.quickChipText, { color: colors.textSecondary }]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Disclaimer */}
          <Text style={[styles.disclaimer, { color: colors.textTertiary }]}>
            Suggestions only — clinician judgment required
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Input bar */}
      <View style={[styles.inputBar, { borderTopColor: colors.border }]}>
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          ]}
          placeholder="Ask about this patient..."
          placeholderTextColor={colors.textTertiary}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={1000}
          editable={!isSending}
          onSubmitEditing={() => handleSend()}
          blurOnSubmit
        />
        <Pressable
          onPress={() => handleSend()}
          disabled={!input.trim() || isSending}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: input.trim() && !isSending ? colors.tint : colors.surfaceSecondary,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          {isSending ? (
            <ActivityIndicator size="small" color={colors.textTertiary} />
          ) : (
            <Ionicons name="arrow-up" size={18} color={input.trim() ? '#fff' : colors.textTertiary} />
          )}
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    maxHeight: 480,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  headerSub: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  recommendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  recommendBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 4,
  },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickChipText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  disclaimer: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
    marginTop: 4,
  },
  // Messages
  messagesList: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    padding: 12,
  },
  loadingText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomRightRadius: 4,
  },
  userBubbleText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  assistantSection: {
    gap: 8,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    borderRadius: 16,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    padding: 12,
  },
  assistantText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  recsContainer: {
    gap: 6,
    paddingLeft: 8,
    paddingRight: 20,
  },
  sourcesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 8,
  },
  sourcesText: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },
  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    maxHeight: 72,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
