import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, Platform,
  FlatList, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { sendChatMessage, getChatHistory, applyChatDiff, type ChatMessage, type ChatDiff } from '@/lib/api/freestyleChat';

interface Props {
  jobId: string;
  currentNote: string;
  onNoteUpdate: (updatedNote: string) => void;
}

export default function NoteChatDrawer({ jobId, currentNote, onNoteUpdate }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(false);

  const snapPoints = ['6%', '45%', '90%'];

  // Load chat history on mount
  useEffect(() => {
    loadHistory();
  }, [jobId]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const history = await getChatHistory(jobId);
      setMessages(history);
    } catch (e: any) {
      console.error('Failed to load chat history:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isSending) return;

    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    setIsSending(true);

    // Optimistic user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      job_id: jobId,
      user_id: '',
      role: 'user',
      content: text,
      diff: null,
      applied: false,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const result = await sendChatMessage({
        job_id: jobId,
        message: text,
        current_note: currentNote,
      });

      // Add assistant response
      const assistantMsg: ChatMessage = {
        id: result.message_id,
        job_id: jobId,
        user_id: '',
        role: 'assistant',
        content: result.reply,
        diff: result.diff,
        applied: false,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      console.error('Chat failed:', e?.message);
      // Add error message
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        job_id: jobId,
        user_id: '',
        role: 'assistant',
        content: `⚠️ ${e?.message || 'Failed to process request.'}`,
        diff: null,
        applied: false,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, jobId, currentNote]);

  const handleAcceptDiff = useCallback(async (msg: ChatMessage) => {
    if (!msg.diff) return;

    try {
      // Apply the updated note
      const response = await sendChatMessage({
        job_id: jobId,
        message: '',
        current_note: currentNote,
      });
      onNoteUpdate(response.updated_note);
      await applyChatDiff(msg.id);

      // Mark as applied locally
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, applied: true } : m)),
      );

      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      console.error('Failed to apply diff:', e?.message);
    }
  }, [jobId, currentNote, onNoteUpdate]);

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';

    return (
      <Animated.View entering={FadeInDown.duration(200)} style={styles.messageRow}>
        {isUser ? (
          <View style={[styles.userBubble, { backgroundColor: colors.tint }]}>
            <Text style={styles.userBubbleText}>{item.content}</Text>
          </View>
        ) : (
          <View style={[styles.assistantBubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.assistantText, { color: colors.text }]}>{item.content}</Text>

            {/* Diff cards */}
            {item.diff && item.diff.length > 0 && !item.applied && (
              <View style={styles.diffContainer}>
                {item.diff.map((d, i) => (
                  <DiffCard key={i} diff={d} colors={colors} />
                ))}
                <View style={styles.diffActions}>
                  <Pressable
                    onPress={() => handleAcceptDiff(item)}
                    style={({ pressed }) => [
                      styles.diffBtn,
                      { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    <Ionicons name="checkmark" size={14} color="#fff" />
                    <Text style={styles.diffBtnText}>Accept</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setMessages((prev) =>
                        prev.map((m) => (m.id === item.id ? { ...m, diff: null } : m)),
                      );
                    }}
                    style={({ pressed }) => [
                      styles.diffBtn,
                      { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    <Ionicons name="close" size={14} color={colors.text} />
                    <Text style={[styles.diffBtnText, { color: colors.text }]}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {item.applied && (
              <View style={[styles.appliedBadge, { backgroundColor: `${colors.accent}15` }]}>
                <Ionicons name="checkmark-circle" size={12} color={colors.accent} />
                <Text style={[styles.appliedText, { color: colors.accent }]}>Applied</Text>
              </View>
            )}
          </View>
        )}
      </Animated.View>
    );
  };

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={0} appearsOnIndex={1} opacity={0.4} />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      index={0}
      enablePanDownToClose={false}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: colors.textTertiary }}
      backgroundStyle={{ backgroundColor: colors.background }}
    >
      <BottomSheetView style={styles.sheetContent}>
        {/* Header */}
        <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
          <Ionicons name="chatbubbles-outline" size={16} color={colors.tint} />
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Refine Note</Text>
        </View>

        {/* Messages */}
        {loading ? (
          <View style={styles.loadingCenter}>
            <ActivityIndicator color={colors.tint} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyChatState}>
            <Text style={[styles.emptyChatText, { color: colors.textTertiary }]}>
              Ask me to adjust any section of your note
            </Text>
            <View style={styles.exampleChips}>
              {['Expand the HPI', 'Add social history', 'Shorten the plan'].map((q) => (
                <Pressable
                  key={q}
                  onPress={() => setInput(q)}
                  style={({ pressed }) => [
                    styles.exampleChip,
                    { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Text style={[styles.exampleChipText, { color: colors.textSecondary }]}>{q}</Text>
                </Pressable>
              ))}
            </View>
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
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            placeholder="e.g., Make the plan more specific..."
            placeholderTextColor={colors.textTertiary}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={1000}
            editable={!isSending}
          />
          <Pressable
            onPress={handleSend}
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
      </BottomSheetView>
    </BottomSheet>
  );
}

// ── Diff Card ───────────────────────────────────────────────────────────────

function DiffCard({ diff, colors }: { diff: ChatDiff; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View style={[diffStyles.card, { borderColor: colors.border }]}>
      <Text style={[diffStyles.sectionLabel, { color: colors.tint }]}>{diff.section}</Text>
      <View style={[diffStyles.beforeBlock, { backgroundColor: `${colors.recording}10` }]}>
        <Text style={[diffStyles.diffLabel, { color: colors.recording }]}>Before</Text>
        <Text style={[diffStyles.diffText, { color: colors.textSecondary }]} numberOfLines={3}>
          {diff.before}
        </Text>
      </View>
      <View style={[diffStyles.afterBlock, { backgroundColor: `${colors.accent}10` }]}>
        <Text style={[diffStyles.diffLabel, { color: colors.accent }]}>After</Text>
        <Text style={[diffStyles.diffText, { color: colors.text }]} numberOfLines={3}>
          {diff.after}
        </Text>
      </View>
    </View>
  );
}

const diffStyles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    padding: 8,
    paddingBottom: 4,
  },
  beforeBlock: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  afterBlock: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  diffLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  diffText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
});

const styles = StyleSheet.create({
  sheetContent: {
    flex: 1,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  loadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyChatState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  emptyChatText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  exampleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  exampleChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  exampleChipText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  messageRow: {},
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
  assistantBubble: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    borderRadius: 16,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  assistantText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  diffContainer: {
    gap: 8,
  },
  diffActions: {
    flexDirection: 'row',
    gap: 8,
  },
  diffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  diffBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  appliedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  appliedText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    maxHeight: 80,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
