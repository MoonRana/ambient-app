import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export interface CapturedImage {
  uri: string;
  id: string;
  timestamp: number;
}

export interface InsuranceInfo {
  memberId?: string;
  groupNumber?: string;
  payerName?: string;
  patientName?: string;
}

export interface AmbientSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: 'recording' | 'captured' | 'reviewing' | 'processing' | 'completed' | 'error';
  recordingDuration: number;
  recordingUri?: string;
  capturedImages: CapturedImage[];
  patientContext?: string;
  patientInfo?: {
    name?: string;
    dateOfBirth?: string;
    memberId?: string;
    groupNumber?: string;
    payerName?: string;
    address?: string;
  };
  audioS3Uri?: string;
  healthscribeJobName?: string;
  transcript?: string;
  soapNote?: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    followUp?: string;
  };
  fullNote?: string;
  errorMessage?: string;
}

interface SessionContextValue {
  sessions: AmbientSession[];
  currentSession: AmbientSession | null;
  isLoading: boolean;
  createSession: () => AmbientSession;
  updateSession: (id: string, updates: Partial<AmbientSession>) => void;
  deleteSession: (id: string) => void;
  setCurrentSession: (session: AmbientSession | null) => void;
  getSession: (id: string) => AmbientSession | undefined;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const STORAGE_KEY = '@domynote_sessions';

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

/** Fire-and-forget upsert of a session to Supabase. Never throws. */
async function saveSessionToSupabase(session: AmbientSession): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // not signed in — skip silently

    const row = {
      id: session.id,
      user_id: user.id,
      created_at: new Date(session.createdAt).toISOString(),
      updated_at: new Date(session.updatedAt).toISOString(),
      status: session.status,
      recording_duration: session.recordingDuration,
      patient_context: session.patientContext ?? null,
      // Patient info — flattened for easier querying
      patient_name: session.patientInfo?.name ?? null,
      patient_dob: session.patientInfo?.dateOfBirth ?? null,
      patient_address: session.patientInfo?.address ?? null,
      member_id: session.patientInfo?.memberId ?? null,
      group_number: session.patientInfo?.groupNumber ?? null,
      payer_name: session.patientInfo?.payerName ?? null,
      // SOAP note
      soap_subjective: session.soapNote?.subjective ?? null,
      soap_objective: session.soapNote?.objective ?? null,
      soap_assessment: session.soapNote?.assessment ?? null,
      soap_plan: session.soapNote?.plan ?? null,
      soap_follow_up: session.soapNote?.followUp ?? null,
      full_note: session.fullNote ?? null,
      transcript: session.transcript ?? null,
      error_message: session.errorMessage ?? null,
    };

    const { error } = await supabase.from('sessions').upsert(row, { onConflict: 'id' });
    if (error) {
      console.warn('[SessionContext] Supabase upsert failed (session still saved locally):', error.message);
    } else {
      console.log('[SessionContext] Session synced to Supabase:', session.id);
    }
  } catch (e: any) {
    // Never block the local flow
    console.warn('[SessionContext] saveSessionToSupabase error:', e?.message);
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<AmbientSession[]>([]);
  const [currentSession, setCurrentSession] = useState<AmbientSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      saveSessions();
    }
  }, [sessions]);

  const loadSessions = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSessions(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load sessions', e);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSessions = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.error('Failed to save sessions', e);
    }
  };

  const createSession = (): AmbientSession => {
    const now = Date.now();
    const session: AmbientSession = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      status: 'recording',
      recordingDuration: 0,
      capturedImages: [],
    };
    setSessions(prev => [session, ...prev]);
    setCurrentSession(session);
    return session;
  };

  const updateSession = (id: string, updates: Partial<AmbientSession>) => {
    setSessions(prev =>
      prev.map(s =>
        s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s
      )
    );
    if (currentSession?.id === id) {
      setCurrentSession(prev => prev ? { ...prev, ...updates, updatedAt: Date.now() } : prev);
    }

    // Persist to Supabase whenever a session reaches 'completed' or when
    // patient info / soap note is updated on an already-completed session.
    const shouldSync =
      updates.status === 'completed' ||
      updates.patientInfo !== undefined ||
      updates.soapNote !== undefined;

    if (shouldSync) {
      setSessions(prev => {
        const session = prev.find(s => s.id === id);
        if (session) saveSessionToSupabase({ ...session, ...updates, updatedAt: Date.now() });
        return prev; // no-op state mutation — just piggybacks on the read
      });
    }
  };

  const deleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSession?.id === id) {
      setCurrentSession(null);
    }
  };

  const getSession = (id: string) => {
    return sessions.find(s => s.id === id);
  };

  const value = useMemo(() => ({
    sessions,
    currentSession,
    isLoading,
    createSession,
    updateSession,
    deleteSession,
    setCurrentSession,
    getSession,
  }), [sessions, currentSession, isLoading]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessions() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessions must be used within a SessionProvider');
  }
  return context;
}
