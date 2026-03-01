import React, {
    createContext, useContext, useState, useEffect, useRef,
    useCallback, useMemo, ReactNode,
} from 'react';
import {
    fetchSpecialties,
    streamClinicalQA,
    Specialty,
    ConsultSource,
    ConsultMetrics,
} from './supabase-api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConsultMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    /** True while tokens are still arriving */
    streaming?: boolean;
    metadata?: {
        guidelines: ConsultSource[];
        webSources: ConsultSource[];
        pubmedSources: ConsultSource[];
        metrics: ConsultMetrics;
    };
    /** Final performance metrics attached once done */
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
    newCase: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ConsultContext = createContext<ConsultContextValue | null>(null);

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function ConsultProvider({ children }: { children: ReactNode }) {
    const [messages, setMessages] = useState<ConsultMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
    const [specialties, setSpecialties] = useState<Specialty[]>([]);
    const [specialtiesLoading, setSpecialtiesLoading] = useState(true);

    // Hold the AbortController so we can cancel on unmount or newCase
    const abortRef = useRef<AbortController | null>(null);

    // History sent to the API — only settled (non-streaming) messages
    const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

    useEffect(() => {
        fetchSpecialties().then(data => {
            setSpecialties(data);
            setSpecialtiesLoading(false);
        });
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    const newCase = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        historyRef.current = [];
        setMessages([]);
        setIsStreaming(false);
    }, []);

    const sendQuestion = useCallback((text: string) => {
        if (isStreaming || !text.trim()) return;

        const userMsg: ConsultMessage = { id: uid(), role: 'user', content: text.trim() };
        const assistantId = uid();
        const assistantMsg: ConsultMessage = {
            id: assistantId,
            role: 'assistant',
            content: '',
            streaming: true,
        };

        setMessages(prev => [...prev, userMsg, assistantMsg]);
        setIsStreaming(true);

        // Build history from settled messages + this new user turn
        const history = [
            ...historyRef.current,
            { role: 'user' as const, content: text.trim() },
        ];

        const controller = streamClinicalQA(
            {
                question: text.trim(),
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
                    setMessages(prev => {
                        const updated = prev.map(m =>
                            m.id === assistantId
                                ? { ...m, streaming: false, doneMetrics }
                                : m,
                        );
                        // Snapshot history for next turn
                        const settled = updated
                            .filter(m => !m.streaming)
                            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
                        historyRef.current = settled;
                        return updated;
                    });
                    setIsStreaming(false);
                },
                onError(err) {
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
    }, [isStreaming, selectedSpecialty]);

    const value = useMemo<ConsultContextValue>(() => ({
        messages,
        isStreaming,
        selectedSpecialty,
        specialties,
        specialtiesLoading,
        setSelectedSpecialty,
        sendQuestion,
        newCase,
    }), [messages, isStreaming, selectedSpecialty, specialties, specialtiesLoading, sendQuestion, newCase]);

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
