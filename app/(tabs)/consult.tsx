import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    View, Text, StyleSheet, Pressable, Platform,
    ScrollView, TextInput, FlatList, Linking, Alert,
    KeyboardAvoidingView, ActivityIndicator, Keyboard,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
    FadeIn, FadeInDown, useSharedValue, withRepeat,
    withSequence, withTiming, useAnimatedStyle,
} from 'react-native-reanimated';
import Markdown from 'react-native-markdown-display';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { ConsultProvider, useConsult, ConsultMessage } from '@/lib/consult-context';
import { ConsultSource, ConsultMetrics } from '@/lib/supabase-api';

// ─── Typing indicator dots ────────────────────────────────────────────────────

function TypingDots({ color }: { color: string }) {
    const dot1 = useSharedValue(0.3);
    const dot2 = useSharedValue(0.3);
    const dot3 = useSharedValue(0.3);

    useEffect(() => {
        const pulse = (sv: typeof dot1, delay: number) => {
            sv.value = withRepeat(
                withSequence(
                    withTiming(1, { duration: 400 }),
                    withTiming(0.3, { duration: 400 }),
                ),
                -1,
                false,
            );
            // stagger — crude but effective
            setTimeout(() => {
                sv.value = withRepeat(
                    withSequence(
                        withTiming(1, { duration: 400 }),
                        withTiming(0.3, { duration: 400 }),
                    ),
                    -1,
                    false,
                );
            }, delay);
        };
        pulse(dot1, 0);
        pulse(dot2, 160);
        pulse(dot3, 320);
    }, []);

    const s1 = useAnimatedStyle(() => ({ opacity: dot1.value }));
    const s2 = useAnimatedStyle(() => ({ opacity: dot2.value }));
    const s3 = useAnimatedStyle(() => ({ opacity: dot3.value }));

    return (
        <View style={styles.dotsRow}>
            {[s1, s2, s3].map((s, i) => (
                <Animated.View key={i} style={[styles.dot, { backgroundColor: color }, s]} />
            ))}
        </View>
    );
}

// ─── Source card ──────────────────────────────────────────────────────────────

function SourceCard({ source, accentColor, colors }: { source: any; accentColor: string; colors: ReturnType<typeof useThemeColors> }) {
    const handlePress = () => {
        if (source?.url) {
            Linking.openURL(source.url).catch(() => { });
        }
    };

    const titleText = source?.title || source?.name || source?.heading || (typeof source === 'string' ? source : JSON.stringify(source));
    const snippetText = source?.snippet || source?.summary;

    return (
        <Pressable
            onPress={source?.url ? handlePress : undefined}
            style={({ pressed }) => [
                styles.sourceCard,
                source?.url && { opacity: pressed ? 0.75 : 1 },
            ]}
        >
            <View style={[styles.sourceAccent, { backgroundColor: accentColor }]} />
            <View style={styles.sourceBody}>
                <Text style={[styles.sourceTitle, { color: colors.text }]} numberOfLines={2}>{titleText}</Text>
                {snippetText && (
                    <Text style={[styles.sourceSnippet, { color: colors.textSecondary }]} numberOfLines={2}>{snippetText}</Text>
                )}
                {(source?.journal || source?.year || source?.pmid) && (
                    <Text style={[styles.sourceMeta, { color: colors.textTertiary }]}>
                        {[source.journal, source.year, source.pmid ? `PMID ${source.pmid}` : null]
                            .filter(Boolean).join(' · ')}
                    </Text>
                )}
                {source?.url && <Ionicons name="open-outline" size={12} color={accentColor} style={{ marginTop: 4 }} />}
            </View>
        </Pressable>
    );
}

// ─── Sources accordion ────────────────────────────────────────────────────────

function SourcesAccordion({
    guidelines, webSources, pubmedSources, colors,
}: {
    guidelines: any[];
    webSources: any[];
    pubmedSources: any[];
    colors: ReturnType<typeof useThemeColors>;
}) {
    const [open, setOpen] = useState(false);
    const safeArray = (arr: any) => Array.isArray(arr) ? arr : [];

    const validGuidelines = safeArray(guidelines);
    const validWebSources = safeArray(webSources);
    const validPubmedSources = safeArray(pubmedSources);

    const total = validGuidelines.length + validWebSources.length + validPubmedSources.length;
    if (total === 0) return null;

    const sections = [
        { label: 'Guidelines', items: validGuidelines.slice(0, 3), color: colors.tint },
        { label: 'PubMed', items: validPubmedSources.slice(0, 3), color: colors.accent },
        { label: 'Web', items: validWebSources.slice(0, 3), color: colors.warning },
    ].filter(s => s.items.length > 0);

    return (
        <View style={[styles.accordion, { borderColor: colors.border }]}>
            <Pressable
                onPress={() => setOpen(p => !p)}
                style={styles.accordionHeader}
            >
                <View style={styles.accordionLeft}>
                    <Ionicons name="library-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.accordionLabel, { color: colors.textSecondary }]}>
                        {total} source{total !== 1 ? 's' : ''}
                    </Text>
                </View>
                <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.textTertiary}
                />
            </Pressable>

            {open && (
                <Animated.View entering={FadeInDown.duration(200)} style={styles.accordionBody}>
                    {sections.map(section => (
                        <View key={section.label} style={styles.sourceSection}>
                            <Text style={[styles.sourceSectionLabel, { color: section.color }]}>
                                {section.label}
                            </Text>
                            {section.items.map((src, i) => (
                                <SourceCard key={i} source={src} accentColor={section.color} colors={colors} />
                            ))}
                        </View>
                    ))}
                </Animated.View>
            )}
        </View>
    );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
    message, colors,
}: {
    message: ConsultMessage;
    colors: ReturnType<typeof useThemeColors>;
}) {
    const isUser = message.role === 'user';
    const isEmpty = !message.content && message.streaming;

    const markdownStyles = {
        body: { color: colors.text, fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 },
        heading1: { color: colors.text, fontFamily: 'Inter_700Bold', fontSize: 18, marginTop: 8, marginBottom: 4 },
        heading2: { color: colors.text, fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 6, marginBottom: 4 },
        strong: { fontFamily: 'Inter_700Bold' },
        em: { fontStyle: 'italic' as const },
        link: { color: colors.tint },
        code_inline: {
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            backgroundColor: colors.surfaceSecondary,
            color: colors.accent,
            fontSize: 13,
            paddingHorizontal: 4,
            borderRadius: 4,
        },
        fence: {
            backgroundColor: colors.surfaceSecondary,
            borderRadius: 10,
            padding: 12,
            marginVertical: 6,
        },
        code_block: {
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            color: colors.text,
            fontSize: 13,
        },
        bullet_list_icon: {
            color: colors.tint,
            fontSize: 20,
            lineHeight: 22,
            marginRight: 8,
            marginTop: Platform.OS === 'ios' ? -1 : 0
        },
        ordered_list_icon: {
            color: colors.tint,
            fontSize: 15,
            lineHeight: 22,
            marginRight: 8,
            fontFamily: 'Inter_500Medium'
        },
        blockquote: {
            borderLeftWidth: 3,
            borderLeftColor: colors.tint,
            paddingLeft: 10,
            marginVertical: 4,
            opacity: 0.85,
        },
        hr: { backgroundColor: colors.border, height: 1, marginVertical: 8 },
    };

    if (isUser) {
        return (
            <Animated.View entering={FadeIn.duration(200)} style={styles.userBubbleRow}>
                <View style={[styles.userBubble, { backgroundColor: colors.tint }]}>
                    <Text style={styles.userBubbleText}>{message.content}</Text>
                </View>
            </Animated.View>
        );
    }

    return (
        <Animated.View entering={FadeIn.duration(300)} style={styles.assistantBubbleRow}>
            {/* Avatar */}
            <View style={[styles.avatar, { backgroundColor: colors.tintLight }]}>
                <Ionicons name="medical" size={14} color={colors.tint} />
            </View>

            <View style={styles.assistantContent}>
                <View style={[styles.assistantBubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    {/* Error state */}
                    {message.error && (
                        <View style={styles.errorRow}>
                            <Ionicons name="alert-circle-outline" size={16} color={colors.recording} />
                            <Text style={[styles.errorText, { color: colors.recording }]}>{message.error}</Text>
                        </View>
                    )}

                    {/* Typing dots while waiting for first token */}
                    {isEmpty && !message.error && (
                        <TypingDots color={colors.textTertiary} />
                    )}

                    {/* Streaming / settled content */}
                    {!!message.content && !message.error && (
                        <Markdown style={markdownStyles as any}>
                            {message.content + (message.streaming ? '▋' : '')}
                        </Markdown>
                    )}

                    {/* Done metrics */}
                    {!message.streaming && message.doneMetrics && (
                        <Text style={[styles.metricsText, { color: colors.textTertiary }]}>
                            ⚡ {message.doneMetrics.totalTime ?? '—'}ms
                            {message.doneMetrics.chunksRetrieved != null
                                ? ` · ${message.doneMetrics.chunksRetrieved} chunks`
                                : ''}
                        </Text>
                    )}
                </View>

                {/* Sources accordion */}
                {!message.streaming && message.metadata && (
                    <SourcesAccordion
                        guidelines={message.metadata.guidelines}
                        webSources={message.metadata.webSources}
                        pubmedSources={message.metadata.pubmedSources}
                        colors={colors}
                    />
                )}
            </View>
        </Animated.View>
    );
}

// ─── Specialty chip ───────────────────────────────────────────────────────────

function SpecialtyChip({
    label, active, onPress, colors,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
    colors: ReturnType<typeof useThemeColors>;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.chip,
                {
                    backgroundColor: active ? colors.tint : colors.surfaceSecondary,
                    borderColor: active ? colors.tint : colors.border,
                    opacity: pressed ? 0.8 : 1,
                },
            ]}
        >
            <Text style={[styles.chipText, { color: active ? '#fff' : colors.textSecondary }]}>
                {label}
            </Text>
        </Pressable>
    );
}

// ─── Main chat screen ─────────────────────────────────────────────────────────

function ConsultScreen() {
    const colorScheme = useEffectiveColorScheme();
    const colors = useThemeColors(colorScheme);
    const insets = useSafeAreaInsets();

    const {
        messages,
        isStreaming,
        selectedSpecialty,
        specialties,
        specialtiesLoading,
        setSelectedSpecialty,
        sendQuestion,
        newCase,
        attachedDocument,
        isExtracting,
        attachDocument,
        clearDocument,
    } = useConsult();

    const [input, setInput] = useState('');
    const listRef = useRef<FlatList<ConsultMessage>>(null);
    const inputRef = useRef<TextInput>(null);

    const [keyboardOpen, setKeyboardOpen] = useState(false);
    const isNearBottomRef = useRef(true);
    const userScrolledRef = useRef(false);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);

    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const show = Keyboard.addListener(showEvent, () => setKeyboardOpen(true));
        const hide = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false));
        return () => { show.remove(); hide.remove(); };
    }, []);

    // Smart auto-scroll: only scroll if user is near the bottom
    useEffect(() => {
        if (messages.length > 0 && isNearBottomRef.current && !userScrolledRef.current) {
            setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
        }
    }, [messages.length, messages[messages.length - 1]?.content]);

    // When user sends a new message, always scroll to bottom
    const scrollToBottom = useCallback(() => {
        isNearBottomRef.current = true;
        userScrolledRef.current = false;
        setShowScrollToBottom(false);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }, []);

    // Track user scroll position
    const handleScroll = useCallback((e: any) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
        const nearBottom = distanceFromBottom < 80;
        isNearBottomRef.current = nearBottom;
        setShowScrollToBottom(!nearBottom && isStreaming);
    }, [isStreaming]);

    const handleScrollBeginDrag = useCallback(() => {
        // User intentionally scrolled
        userScrolledRef.current = true;
    }, []);

    const handleScrollEndDrag = useCallback(() => {
        // If user scrolled back to bottom, resume auto-scroll
        if (isNearBottomRef.current) {
            userScrolledRef.current = false;
            setShowScrollToBottom(false);
        }
    }, []);

    const handleSend = useCallback(() => {
        const text = input.trim();
        if (!text || isStreaming) return;
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        sendQuestion(text);
        setInput('');
        inputRef.current?.blur();
        // Always scroll to bottom when sending
        scrollToBottom();
    }, [input, isStreaming, sendQuestion, scrollToBottom]);

    const handleNewCase = useCallback(() => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        newCase();
        setInput('');
    }, [newCase]);

    const handleCameraCapture = useCallback(async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission Needed', 'Camera access is required to scan documents.');
            return;
        }
        const result = await ImagePicker.launchCameraAsync({
            quality: 0.8,
            allowsEditing: false,
        });
        if (result.canceled || !result.assets?.[0]?.uri) return;
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        await attachDocument(result.assets[0].uri);
    }, [attachDocument]);

    const webTopInset = Platform.OS === 'web' ? 67 : 0;

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
            {/* ── Header ── */}
            <View style={[
                styles.header,
                {
                    paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8,
                    borderBottomColor: colors.border,
                    backgroundColor: colors.background,
                },
            ]}>
                <View style={styles.headerLeft}>
                    <View style={[styles.headerIcon, { backgroundColor: colors.tintLight }]}>
                        <Ionicons name="medical" size={18} color={colors.tint} />
                    </View>
                    <View>
                        <Text style={[styles.headerTitle, { color: colors.text }]}>STAT Consult</Text>
                        <Text style={[styles.headerSub, { color: colors.textTertiary }]}>
                            RAG-powered clinical Q&A
                        </Text>
                    </View>
                </View>
                {messages.length > 0 && (
                    <Pressable
                        onPress={handleNewCase}
                        style={({ pressed }) => [
                            styles.newCaseBtn,
                            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                        ]}
                    >
                        <Ionicons name="add" size={14} color={colors.tint} />
                        <Text style={[styles.newCaseBtnText, { color: colors.tint }]}>New Case</Text>
                    </Pressable>
                )}
            </View>

            {/* ── Specialty picker ── */}
            <View style={[styles.specialtyBar, { borderBottomColor: colors.border }]}>
                {specialtiesLoading ? (
                    <ActivityIndicator size="small" color={colors.tint} style={{ marginLeft: 16 }} />
                ) : (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.specialtyScroll}
                    >
                        <SpecialtyChip
                            label="All Specialties"
                            active={selectedSpecialty === null}
                            onPress={() => setSelectedSpecialty(null)}
                            colors={colors}
                        />
                        {specialties.map(sp => (
                            <SpecialtyChip
                                key={sp.id}
                                label={sp.name}
                                active={selectedSpecialty === sp.id}
                                onPress={() => setSelectedSpecialty(sp.id)}
                                colors={colors}
                            />
                        ))}
                    </ScrollView>
                )}
            </View>

            {/* ── Message list ── */}
            {messages.length === 0 ? (
                <View style={styles.emptyState}>
                    <Animated.View entering={FadeInDown.duration(500)} style={styles.emptyInner}>
                        <View style={[styles.emptyIcon, { backgroundColor: colors.tintLight }]}>
                            <Ionicons name="medical" size={36} color={colors.tint} />
                        </View>
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>Ask a Clinical Question</Text>
                        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                            Evidence-based answers with guidelines, PubMed citations, and medical society sources.
                        </Text>
                        <View style={styles.examplesContainer}>
                            {[
                                'First-line treatment for hypertensive emergency?',
                                'Diagnostic criteria for septic shock?',
                                'When to initiate anticoagulation in AFib?',
                            ].map((q, i) => (
                                <Pressable
                                    key={i}
                                    onPress={() => { setInput(q); inputRef.current?.focus(); }}
                                    style={({ pressed }) => [
                                        styles.exampleChip,
                                        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                                    ]}
                                >
                                    <Text style={[styles.exampleText, { color: colors.textSecondary }]} numberOfLines={1}>{q}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </Animated.View>
                </View>
            ) : (
                <>
                <FlatList
                    ref={listRef}
                    data={messages}
                    keyExtractor={m => m.id}
                    renderItem={({ item }) => <MessageBubble message={item} colors={colors} />}
                    contentContainerStyle={[
                        styles.messageList,
                        { paddingBottom: 12 },
                    ]}
                    showsVerticalScrollIndicator={false}
                    onScroll={handleScroll}
                    onScrollBeginDrag={handleScrollBeginDrag}
                    onScrollEndDrag={handleScrollEndDrag}
                    scrollEventThrottle={100}
                    onContentSizeChange={() => {
                        if (isNearBottomRef.current && !userScrolledRef.current) {
                            listRef.current?.scrollToEnd({ animated: true });
                        }
                    }}
                />

                {/* Scroll-to-bottom FAB when user scrolled up during streaming */}
                {showScrollToBottom && (
                    <Pressable
                        onPress={scrollToBottom}
                        style={({ pressed }) => [
                            styles.scrollFab,
                            {
                                backgroundColor: colors.tint,
                                opacity: pressed ? 0.8 : 0.95,
                            },
                        ]}
                    >
                        <Ionicons name="chevron-down" size={20} color="#fff" />
                    </Pressable>
                )}
                </>
            )}

            {/* ── Input bar ── */}
            <View style={[
                styles.inputBar,
                {
                    paddingBottom: Platform.OS === 'web'
                        ? 24
                        : (keyboardOpen ? 12 : Math.max(insets.bottom, 12) + 68),
                    borderTopColor: colors.border,
                    backgroundColor: colors.background,
                },
            ]}>
                {/* Attachment banner */}
                {attachedDocument && (
                    <Animated.View
                        entering={FadeInDown.duration(200)}
                        style={[
                            styles.attachBanner,
                            { backgroundColor: `${colors.accent}12`, borderColor: colors.accent },
                        ]}
                    >
                        <Ionicons name="document-text" size={16} color={colors.accent} />
                        <Text
                            style={[styles.attachText, { color: colors.accent }]}
                            numberOfLines={2}
                        >
                            Clinical document attached
                        </Text>
                        <Pressable onPress={clearDocument} hitSlop={8}>
                            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                        </Pressable>
                    </Animated.View>
                )}

                {/* Extracting indicator */}
                {isExtracting && (
                    <View style={[styles.extractingBar, { backgroundColor: colors.surfaceSecondary }]}>
                        <ActivityIndicator size="small" color={colors.tint} />
                        <Text style={[styles.extractingText, { color: colors.textSecondary }]}>
                            Scanning document...
                        </Text>
                    </View>
                )}

                <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    {/* Camera button */}
                    <Pressable
                        onPress={handleCameraCapture}
                        disabled={isExtracting || isStreaming}
                        style={({ pressed }) => [
                            styles.cameraBtn,
                            { opacity: (isExtracting || isStreaming) ? 0.4 : pressed ? 0.7 : 1 },
                        ]}
                    >
                        <Ionicons
                            name="camera-outline"
                            size={22}
                            color={attachedDocument ? colors.accent : colors.textTertiary}
                        />
                    </Pressable>

                    <TextInput
                        ref={inputRef}
                        style={[styles.textInput, { color: colors.text }]}
                        placeholder={attachedDocument ? "Ask about this document..." : "Ask a clinical question..."}
                        placeholderTextColor={colors.textTertiary}
                        value={input}
                        onChangeText={setInput}
                        multiline
                        maxLength={2000}
                        editable={!isStreaming && !isExtracting}
                        onSubmitEditing={handleSend}
                        blurOnSubmit={false}
                    />
                    <Pressable
                        onPress={handleSend}
                        disabled={(!input.trim() && !attachedDocument) || isStreaming || isExtracting}
                        style={({ pressed }) => [
                            styles.sendBtn,
                            {
                                backgroundColor: (input.trim() || attachedDocument) && !isStreaming
                                    ? colors.tint
                                    : colors.surfaceSecondary,
                                opacity: pressed ? 0.8 : 1,
                            },
                        ]}
                    >
                        {isStreaming ? (
                            <ActivityIndicator size="small" color={colors.textTertiary} />
                        ) : (
                            <Ionicons
                                name="arrow-up"
                                size={20}
                                color={(input.trim() || attachedDocument) ? '#fff' : colors.textTertiary}
                            />
                        )}
                    </Pressable>
                </View>
                <Text style={[styles.disclaimer, { color: colors.textTertiary }]}>
                    For clinical decision support only — not a substitute for clinical judgment.
                </Text>
            </View>
        </KeyboardAvoidingView>
    );
}

// ─── Wrapped export with provider ─────────────────────────────────────────────

export default function ConsultTab() {
    return (
        <ConsultProvider>
            <ConsultScreen />
        </ConsultProvider>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1 },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerIcon: {
        width: 38, height: 38, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
    headerSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
    newCaseBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 20, borderWidth: 1,
    },
    newCaseBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

    // Specialty picker
    specialtyBar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
    specialtyScroll: { paddingHorizontal: 16, gap: 8 },
    chip: {
        paddingHorizontal: 14, paddingVertical: 6,
        borderRadius: 20, borderWidth: 1,
    },
    chipText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

    // Message list
    messageList: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },

    // User bubble
    userBubbleRow: { alignItems: 'flex-end' },
    userBubble: {
        maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10,
        borderRadius: 18, borderBottomRightRadius: 4,
    },
    userBubbleText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#fff', lineHeight: 22 },

    // Assistant bubble
    assistantBubbleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    avatar: {
        width: 30, height: 30, borderRadius: 15,
        alignItems: 'center', justifyContent: 'center',
        marginTop: 2,
    },
    assistantContent: { flex: 1, gap: 8 },
    assistantBubble: {
        borderRadius: 18, borderTopLeftRadius: 4,
        borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12,
        gap: 8,
    },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    errorText: { fontSize: 14, fontFamily: 'Inter_400Regular', flex: 1 },
    metricsText: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'right', marginTop: 4 },

    // Typing dots
    dotsRow: { flexDirection: 'row', gap: 5, paddingVertical: 4, paddingHorizontal: 2 },
    dot: { width: 8, height: 8, borderRadius: 4 },

    // Sources accordion
    accordion: {
        borderRadius: 12, borderWidth: 1, overflow: 'hidden',
    },
    accordionHeader: {
        flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12, paddingVertical: 10,
    },
    accordionLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    accordionLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },
    accordionBody: { paddingHorizontal: 10, paddingBottom: 10, gap: 12 },
    sourceSection: { gap: 6 },
    sourceSectionLabel: {
        fontSize: 11, fontFamily: 'Inter_700Bold',
        textTransform: 'uppercase', letterSpacing: 0.8,
        marginBottom: 2,
    },
    sourceCard: {
        flexDirection: 'row', borderRadius: 8, overflow: 'hidden',
        backgroundColor: 'transparent',
    },
    sourceAccent: { width: 3 },
    sourceBody: { flex: 1, paddingLeft: 8, paddingVertical: 4 },
    sourceTitle: { fontSize: 13, fontFamily: 'Inter_500Medium' },
    sourceSnippet: { fontSize: 12, fontFamily: 'Inter_400Regular', opacity: 0.75, marginTop: 2 },
    sourceMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', opacity: 0.55, marginTop: 2 },

    // Empty state
    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
    emptyInner: { alignItems: 'center', gap: 16, width: '100%' },
    emptyIcon: {
        width: 80, height: 80, borderRadius: 24,
        alignItems: 'center', justifyContent: 'center',
    },
    emptyTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', textAlign: 'center' },
    emptySubtitle: {
        fontSize: 14, fontFamily: 'Inter_400Regular',
        textAlign: 'center', lineHeight: 21,
    },
    examplesContainer: { width: '100%', gap: 8, marginTop: 8 },
    exampleChip: {
        borderWidth: 1, borderRadius: 12,
        paddingHorizontal: 14, paddingVertical: 10,
    },
    exampleText: { fontSize: 13, fontFamily: 'Inter_400Regular' },

    // Input bar
    inputBar: {
        paddingHorizontal: 16, paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 6,
    },
    inputWrapper: {
        flexDirection: 'row', alignItems: 'flex-end',
        borderRadius: 22, borderWidth: 1,
        paddingLeft: 16, paddingRight: 6, paddingVertical: 6,
        gap: 8, minHeight: 48,
    },
    textInput: {
        flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular',
        maxHeight: 120, lineHeight: 22,
        paddingTop: Platform.OS === 'ios' ? 6 : 0,
    },
    sendBtn: {
        width: 36, height: 36, borderRadius: 18,
        alignItems: 'center', justifyContent: 'center',
        alignSelf: 'flex-end',
    },
    disclaimer: { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center' },

    // Camera / attachment styles
    attachBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 12, paddingVertical: 8,
        borderRadius: 12, borderWidth: 1, marginBottom: 6,
    },
    attachText: {
        flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium',
    },
    extractingBar: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 8, paddingVertical: 10, borderRadius: 12, marginBottom: 6,
    },
    extractingText: {
        fontSize: 13, fontFamily: 'Inter_400Regular',
    },
    cameraBtn: {
        padding: 4,
    },
    scrollFab: {
        position: 'absolute', alignSelf: 'center',
        bottom: 8,
        width: 40, height: 40, borderRadius: 20,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25, shadowRadius: 4, elevation: 4,
    },
});
