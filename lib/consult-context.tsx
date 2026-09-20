import React, {
    createContext, useContext, useState, useEffect, useRef,
    useCallback, useMemo, ReactNode,
} from 'react';
import {
    fetchSpecialties,
    streamClinicalQA,
    prepareAttachmentBase64,
    type ConsultAttachmentPayload,
    Specialty,
    ConsultSource,
    ConsultMetrics,
} from './supabase-api';
import { Alert } from 'react-native';
import { ensureAIConsent } from './ai-consent';
import {
    isNoteGenerationRequest,
    routeToFreestyleWithDocument,
    routeToFreestyleWithAttachments,
} from './consult-routing';
import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConsultAttachmentMime = 'image/jpeg' | 'application/pdf';

/** A photo or PDF the clinician has attached to the next question. */
export interface ConsultAttachment {
    id: string;
    uri: string;
    mimeType: ConsultAttachmentMime;
    name: string;
    status: 'preparing' | 'ready' | 'failed';
    base64?: string;
}

export interface ConsultMessageAttachment {
    id: string;
    uri: string;
    mimeType: ConsultAttachmentMime;
    name: string;
}

export interface ConsultMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: ConsultMessageAttachment[];
    streaming?: boolean;
    stopped?: boolean;
    metadata?: {
        guidelines: ConsultSource[];
        webSources: ConsultSource[];
        pubmedSources: ConsultSource[];
        metrics: ConsultMetrics;
    };
    doneMetrics?: ConsultMetrics;
    error?: string;
}

interface ConsultContextValue {
    messages: ConsultMessage[];
    isStreaming: boolean;
    selectedSpecialty: string | null;
    specialties: Specialty[];
    specialtiesLoading: boolean;
    setSelectedSpecialty: (id: string | null) => void;
    sendQuestion: (text: string) => void;
    stopStreaming: () => void;
    newCase: () => void;
    attachments: ConsultAttachment[];
    isPreparingAttachments: boolean;
    addAttachment: (uri: string, opts?: { mimeType?: ConsultAttachmentMime; name?: string }) => void;
    removeAttachment: (id: string) => void;
    clearAttachments: () => void;
    openFreestyle: () => void;
}

const ConsultContext = createContext<ConsultContextValue | null>(null);

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const MAX_CONSULT_ATTACHMENTS = 6;

// Legible enough for a lab table; well under Anthropic's per-image ceiling.
const ATTACHMENT_PREP = { maxWidth: 1200, compress: 0.6 };

const CONSULT_STREAM_TIMEOUT_MS = 120_000;

const DEFAULT_ATTACHMENT_QUESTION = 'Please review and interpret the attached document(s).';

export function ConsultProvider({ children }: { children: ReactNode }) {
    const [messages, setMessages] = useState<ConsultMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
    const [specialties, setSpecialties] = useState<Specialty[]>([]);
    const [specialtiesLoading, setSpecialtiesLoading] = useState(true);

    const abortRef = useRef<AbortController | null>(null);
    const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

    const clearStreamTimeout = useCallback(() => {
        if (streamTimeoutRef.current) {
            clearTimeout(streamTimeoutRef.current);
            streamTimeoutRef.current = null;
        }
    }, []);

    const finalizeStreamingMessage = useCallback((
        updater: (message: ConsultMessage) => ConsultMessage,
    ) => {
        clearStreamTimeout();
        abortRef.current = null;
        setIsStreaming(false);
        setMessages(prev => {
            const updated = prev.map(m => (m.streaming ? updater(m) : m));
            const settled = updated
                .filter(m => !m.streaming && m.content && !m.error && !m.stopped)
                .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
            historyRef.current = settled;
            return updated;
        });
    }, [clearStreamTimeout]);

    const stopStreaming = useCallback(() => {
        if (!abortRef.current && !isStreaming) return;
        abortRef.current?.abort();
        finalizeStreamingMessage((m) => ({
            ...m,
            streaming: false,
            stopped: true,
            content: m.content.trim() || '_Response stopped._',
        }));
    }, [finalizeStreamingMessage, isStreaming]);

    // ── Attachments ──────────────────────────────────────────────────────────
    // No extraction gate: files are resized on-device and sent with the question,
    // and the model reads them directly. The only thing that can fail here is
    // reading the file itself.

    const [attachments, setAttachments] = useState<ConsultAttachment[]>([]);
    const attachmentsRef = useRef<ConsultAttachment[]>([]);
    const prepPromisesRef = useRef<Map<string, Promise<void>>>(new Map());

    const commitAttachments = useCallback((next: ConsultAttachment[]) => {
        attachmentsRef.current = next;
        setAttachments(next);
    }, []);

    const patchAttachment = useCallback((id: string, patch: Partial<ConsultAttachment>) => {
        commitAttachments(attachmentsRef.current.map(a => (a.id === id ? { ...a, ...patch } : a)));
    }, [commitAttachments]);

    const removeAttachment = useCallback((id: string) => {
        commitAttachments(attachmentsRef.current.filter(a => a.id !== id));
        prepPromisesRef.current.delete(id);
    }, [commitAttachments]);

    const clearAttachments = useCallback(() => {
        commitAttachments([]);
        prepPromisesRef.current.clear();
    }, [commitAttachments]);

    const addAttachment = useCallback((uri: string, opts?: { mimeType?: ConsultAttachmentMime; name?: string }) => {
        void (async () => {
            const allowed = await ensureAIConsent();
            if (!allowed) return;

            if (attachmentsRef.current.length >= MAX_CONSULT_ATTACHMENTS) {
                Alert.alert('Attachment limit', `You can attach up to ${MAX_CONSULT_ATTACHMENTS} documents per question.`);
                return;
            }

            const id = uid();
            const mimeType = opts?.mimeType ?? 'image/jpeg';
            const name = opts?.name?.trim() || (mimeType === 'application/pdf' ? 'Document.pdf' : 'Photo');
            commitAttachments([...attachmentsRef.current, { id, uri, mimeType, name, status: 'preparing' }]);

            const prep = (async () => {
                try {
                    const base64 = await prepareAttachmentBase64(uri, { ...ATTACHMENT_PREP, mimeType });
                    patchAttachment(id, { status: 'ready', base64 });
                } catch (e: any) {
                    console.warn('[addAttachment] Failed:', e?.message);
                    removeAttachment(id);
                    Alert.alert('Could Not Attach', e?.message || 'That file could not be read.');
                } finally {
                    prepPromisesRef.current.delete(id);
                }
            })();
            prepPromisesRef.current.set(id, prep);
        })();
    }, [commitAttachments, patchAttachment, removeAttachment]);

    const isPreparingAttachments = useMemo(
        () => attachments.some(a => a.status === 'preparing'),
        [attachments],
    );

    // ── Lifecycle ────────────────────────────────────────────────────────────

    useEffect(() => {
        void supabase.auth.getSession();
        fetchSpecialties()
            .then(data => {
                setSpecialties(data || []);
                setSpecialtiesLoading(false);
            })
            .catch(err => {
                console.warn('[fetchSpecialties] Failed:', err);
                setSpecialties([]);
                setSpecialtiesLoading(false);
            });
        return () => {
            clearStreamTimeout();
            abortRef.current?.abort();
        };
    }, [clearStreamTimeout]);

    const newCase = useCallback(() => {
        clearStreamTimeout();
        abortRef.current?.abort();
        abortRef.current = null;
        historyRef.current = [];
        setMessages([]);
        setIsStreaming(false);
        clearAttachments();
    }, [clearStreamTimeout, clearAttachments]);

    const openFreestyle = useCallback(() => {
        const current = attachmentsRef.current;
        if (current.length > 0) {
            routeToFreestyleWithAttachments(current);
            clearAttachments();
        } else {
            routeToFreestyleWithDocument(null);
        }
    }, [clearAttachments]);

    // ── Ask ──────────────────────────────────────────────────────────────────

    const proceedWithQuestion = useCallback(async (text: string) => {
        // On-device resize is quick; wait for any still in flight rather than dropping them.
        await Promise.all(
            attachmentsRef.current
                .map(a => prepPromisesRef.current.get(a.id))
                .filter((p): p is Promise<void> => !!p),
        );
        await supabase.auth.getSession();

        const ready = attachmentsRef.current.filter(a => a.status === 'ready' && !!a.base64);
        const questionText = text.trim() || (ready.length > 0 ? DEFAULT_ATTACHMENT_QUESTION : '');
        if (!questionText) return;

        const payloadAttachments: ConsultAttachmentPayload[] = ready.map(a => ({
            media_type: a.mimeType,
            data: a.base64!,
            name: a.name,
        }));

        const userMsg: ConsultMessage = {
            id: uid(),
            role: 'user',
            content: text.trim(),
            attachments: ready.map(({ id, uri, mimeType, name }) => ({ id, uri, mimeType, name })),
        };

        const assistantId = uid();
        const assistantMsg: ConsultMessage = {
            id: assistantId,
            role: 'assistant',
            content: '',
            streaming: true,
        };

        setMessages(prev => [...prev, userMsg, assistantMsg]);
        setIsStreaming(true);

        const history = [
            ...historyRef.current,
            { role: 'user' as const, content: questionText },
        ].slice(-8);

        // Batch token updates (~30fps) to avoid re-rendering the whole list per chunk
        let tokenBuffer = '';
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        const flushTokens = () => {
            if (!tokenBuffer) return;
            const chunk = tokenBuffer;
            tokenBuffer = '';
            setMessages(prev => prev.map(m =>
                m.id === assistantId
                    ? { ...m, content: m.content + chunk }
                    : m,
            ));
        };

        const scheduleFlush = () => {
            if (flushTimer) return;
            flushTimer = setTimeout(() => {
                flushTimer = null;
                flushTokens();
            }, 32);
        };

        const drainTokens = () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            flushTokens();
        };

        const controller = streamClinicalQA(
            {
                question: questionText,
                specialty_id: selectedSpecialty,
                conversation_history: history,
                attachments: payloadAttachments,
            },
            {
                onMetadata(guidelines, webSources, pubmedSources, metrics) {
                    setMessages(prev => prev.map(m =>
                        m.id === assistantId
                            ? { ...m, metadata: { guidelines, webSources, pubmedSources, metrics } }
                            : m,
                    ));
                },
                onToken(chunk) {
                    tokenBuffer += chunk;
                    scheduleFlush();
                },
                onDone(doneMetrics) {
                    drainTokens();
                    clearStreamTimeout();
                    abortRef.current = null;
                    setMessages(prev => {
                        const updated = prev.map(m =>
                            m.id === assistantId
                                ? { ...m, streaming: false, doneMetrics }
                                : m,
                        );
                        const settled = updated
                            .filter(m => !m.streaming && m.content && !m.error && !m.stopped)
                            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
                        historyRef.current = settled;
                        return updated;
                    });
                    setIsStreaming(false);
                },
                onError(err) {
                    drainTokens();
                    clearStreamTimeout();
                    abortRef.current = null;
                    setMessages(prev => prev.map(m =>
                        m.id === assistantId
                            ? { ...m, streaming: false, error: err.message || 'Something went wrong.' }
                            : m,
                    ));
                    setIsStreaming(false);
                },
            },
        );

        abortRef.current = controller;
        streamTimeoutRef.current = setTimeout(() => {
            if (!abortRef.current) return;
            abortRef.current.abort();
            setMessages(prev => prev.map(m =>
                m.id === assistantId
                    ? {
                        ...m,
                        streaming: false,
                        error: 'Request timed out. Tap Retry or try a shorter question.',
                    }
                    : m,
            ));
            abortRef.current = null;
            clearStreamTimeout();
            setIsStreaming(false);
        }, CONSULT_STREAM_TIMEOUT_MS);

        clearAttachments();
    }, [selectedSpecialty, clearStreamTimeout, clearAttachments]);

    const sendQuestion = useCallback(async (text: string) => {
        if (isStreaming) return;
        if (!text.trim() && attachmentsRef.current.length === 0) return;

        const allowed = await ensureAIConsent();
        if (!allowed) return;

        if (isNoteGenerationRequest(text)) {
            Alert.alert(
                'Generate a clinical note?',
                'STAT Consult answers clinical questions. To build an H&P or SOAP note from labs and documents, use Freestyle.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Freestyle', onPress: openFreestyle },
                    { text: 'Ask here anyway', onPress: () => proceedWithQuestion(text) },
                ],
            );
            return;
        }

        await proceedWithQuestion(text);
    }, [isStreaming, proceedWithQuestion, openFreestyle]);

    const value = useMemo<ConsultContextValue>(() => ({
        messages,
        isStreaming,
        selectedSpecialty,
        specialties,
        specialtiesLoading,
        setSelectedSpecialty,
        sendQuestion,
        stopStreaming,
        newCase,
        attachments,
        isPreparingAttachments,
        addAttachment,
        removeAttachment,
        clearAttachments,
        openFreestyle,
    }), [
        messages, isStreaming, selectedSpecialty, specialties, specialtiesLoading,
        sendQuestion, stopStreaming, newCase, attachments, isPreparingAttachments,
        addAttachment, removeAttachment, clearAttachments, openFreestyle,
    ]);

    return (
        <ConsultContext.Provider value={value}>
            {children}
        </ConsultContext.Provider>
    );
}

export function useConsult() {
    const ctx = useContext(ConsultContext);
    if (!ctx) throw new Error('useConsult must be used within ConsultProvider');
    return ctx;
}
