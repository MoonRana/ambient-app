import React, {
    createContext, useContext, useState, useEffect, useRef,
    useCallback, useMemo, ReactNode,
} from 'react';
import {
    fetchSpecialties,
    streamClinicalQA,
    extractClinicalDocument,
    type ExtractProgressPhase,
    Specialty,
    ConsultSource,
    ConsultMetrics,
} from './supabase-api';
import { Alert } from 'react-native';
import { ensureAIConsent } from './ai-consent';
import { isNoteGenerationRequest, routeToFreestyleWithDocument } from './consult-routing';
import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConsultMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
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

export type ConsultExtractPhase = ExtractProgressPhase | 'idle' | 'waiting';

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
    attachedDocument: string | null;
    isExtracting: boolean;
    extractPhase: ConsultExtractPhase;
    attachDocument: (imageUri: string) => void;
    clearDocument: () => void;
    openFreestyle: () => void;
}

const ConsultContext = createContext<ConsultContextValue | null>(null);

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const CONSULT_EXTRACT_OPTS = {
    maxWidth: 900,
    compress: 0.55,
    timeout: 90_000,
};

const CONSULT_STREAM_TIMEOUT_MS = 120_000;

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

    const [attachedDocument, setAttachedDocument] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractPhase, setExtractPhase] = useState<ConsultExtractPhase>('idle');
    const attachedDocumentRef = useRef<string | null>(null);
    const extractPromiseRef = useRef<Promise<string | null> | null>(null);

    useEffect(() => {
        attachedDocumentRef.current = attachedDocument;
    }, [attachedDocument]);

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
        setAttachedDocument(null);
        attachedDocumentRef.current = null;
    }, [clearStreamTimeout]);

    const runExtraction = useCallback(async (imageUri: string) => {
        setIsExtracting(true);
        setExtractPhase('preparing');

        const promise = extractClinicalDocument(imageUri, {
            ...CONSULT_EXTRACT_OPTS,
            onProgress: (phase) => setExtractPhase(phase),
        });
        extractPromiseRef.current = promise;

        try {
            const extractedText = await promise;
            if (extractedText) {
                setAttachedDocument(extractedText);
                attachedDocumentRef.current = extractedText;
            } else {
                Alert.alert('Extraction Failed', 'Could not read the document. Please try again with a clearer photo.');
            }
        } catch (e: any) {
            console.warn('[attachDocument] Failed:', e?.message);
            Alert.alert('Scan Error', 'Failed to process document image.');
        } finally {
            setIsExtracting(false);
            setExtractPhase('idle');
            extractPromiseRef.current = null;
        }
    }, []);

    const attachDocument = useCallback((imageUri: string) => {
        void (async () => {
            const allowed = await ensureAIConsent();
            if (!allowed) return;
            void runExtraction(imageUri);
        })();
    }, [runExtraction]);

    const clearDocument = useCallback(() => {
        setAttachedDocument(null);
        attachedDocumentRef.current = null;
    }, [clearStreamTimeout]);

    const openFreestyle = useCallback(() => {
        routeToFreestyleWithDocument(attachedDocumentRef.current);
    }, []);

    const resolveAttachedDocument = useCallback(async (): Promise<string | null> => {
        if (attachedDocumentRef.current) return attachedDocumentRef.current;
        if (extractPromiseRef.current) {
            setExtractPhase('waiting');
            try {
                const text = await extractPromiseRef.current;
                if (text) {
                    setAttachedDocument(text);
                    attachedDocumentRef.current = text;
                }
                return text;
            } finally {
                if (!extractPromiseRef.current) {
                    setExtractPhase('idle');
                }
            }
        }
        return null;
    }, []);

    const proceedWithQuestion = useCallback(async (text: string) => {
        const [doc] = await Promise.all([
            resolveAttachedDocument(),
            supabase.auth.getSession(),
        ]);
        const userMsg: ConsultMessage = { id: uid(), role: 'user', content: text.trim() };

        let enrichedQuestion = text.trim();
        if (doc) {
            enrichedQuestion =
                `**Scanned Clinical Document:**\n${doc}\n\n` +
                `**Question:** ${text.trim()}`;
        }

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
            { role: 'user' as const, content: text.trim() },
        ];

        const controller = streamClinicalQA(
            {
                question: enrichedQuestion,
                specialty_id: selectedSpecialty,
                conversation_history: history,
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
                    setMessages(prev => prev.map(m =>
                        m.id === assistantId
                            ? { ...m, content: m.content + chunk }
                            : m,
                    ));
                },
                onDone(doneMetrics) {
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
        setAttachedDocument(null);
        attachedDocumentRef.current = null;
    }, [selectedSpecialty, resolveAttachedDocument, clearStreamTimeout, finalizeStreamingMessage]);

    const sendQuestion = useCallback(async (text: string) => {
        if (isStreaming || !text.trim()) return;

        const allowed = await ensureAIConsent();
        if (!allowed) return;

        if (isNoteGenerationRequest(text)) {
            Alert.alert(
                'Generate a clinical note?',
                'STAT Consult answers clinical questions. To build an H&P or SOAP note from labs and documents, use Freestyle.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Open Freestyle',
                        onPress: async () => {
                            const doc = await resolveAttachedDocument();
                            routeToFreestyleWithDocument(doc);
                        },
                    },
                    { text: 'Ask here anyway', onPress: () => proceedWithQuestion(text) },
                ],
            );
            return;
        }

        await proceedWithQuestion(text);
    }, [isStreaming, proceedWithQuestion, resolveAttachedDocument]);

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
        attachedDocument,
        isExtracting,
        extractPhase,
        attachDocument,
        clearDocument,
        openFreestyle,
    }), [
        messages, isStreaming, selectedSpecialty, specialties, specialtiesLoading,
        sendQuestion, stopStreaming, newCase, attachedDocument, isExtracting, extractPhase,
        attachDocument, clearDocument, openFreestyle,
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
