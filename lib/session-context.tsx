import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export interface CapturedImage {
  uri: string;
  id: string;
  timestamp: number;
  s3Uri?: string; // Set when backed up to S3
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
  patientId?: string;
  encounterId?: string;
  savedToCloud?: boolean;
  cloudSessionId?: string; // UUID from Supabase ambient_sessions table
}

interface SessionContextValue {
  sessions: AmbientSession[];
  currentSession: AmbientSession | null;
  isLoading: boolean;
  createSession: () => AmbientSession;
  createLinkedSession: (patientId: string, patientInfo: AmbientSession['patientInfo']) => AmbientSession;
  resumeFromCloud: (cloudSession: any) => AmbientSession;
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

// ─── Cloud session sync (fire-and-forget) ────────────────────────────────────

async function syncSessionToCloud(session: AmbientSession): Promise<string | null> {
  try {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    if (!authSession?.user?.id) return null;

    const payload = {
      user_id: authSession.user.id,
      status: session.status,
      session_data: {
        local_id: session.id,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
        recording_duration: session.recordingDuration,
        recording_uri: session.recordingUri,
        audio_s3_uri: session.audioS3Uri,
        patient_info: session.patientInfo,
        patient_context: session.patientContext,
        captured_image_count: session.capturedImages.length,
        captured_image_s3_uris: session.capturedImages
          .filter(i => i.s3Uri)
          .map(i => i.s3Uri),
        has_soap_note: !!session.soapNote,
        error_message: session.errorMessage,
      },
    };

    if (session.cloudSessionId) {
      // Update existing cloud session
      const { error } = await supabase
        .from('ambient_sessions')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', session.cloudSessionId);
      if (error) throw error;
      return session.cloudSessionId;
    } else {
      // Insert new cloud session
      const { data, error } = await supabase
        .from('ambient_sessions')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      return data?.id || null;
    }
  } catch (e: any) {
    // Non-fatal — local storage is the source of truth
    console.warn('[syncSessionToCloud] Failed (non-fatal):', e?.message);
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<AmbientSession[]>([]);
  const [currentSession, setCurrentSession] = useState<AmbientSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef<Set<string>>(new Set());

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

  // Debounced cloud sync — waits 2s after last change to batch multiple rapid updates
  const scheduleCloudSync = useCallback((sessionId: string) => {
    pendingSyncRef.current.add(sessionId);
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      const ids = Array.from(pendingSyncRef.current);
      pendingSyncRef.current.clear();

      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const currentSessions: AmbientSession[] = JSON.parse(stored);

      for (const id of ids) {
        const session = currentSessions.find(s => s.id === id);
        if (!session) continue;

        const cloudId = await syncSessionToCloud(session);
        if (cloudId && !session.cloudSessionId) {
          setSessions(prev =>
            prev.map(s => s.id === id ? { ...s, cloudSessionId: cloudId } : s)
          );
        }
      }
    }, 2000);
  }, []);

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
    scheduleCloudSync(session.id);
    return session;
  };

  const createLinkedSession = (patientId: string, patientInfo: AmbientSession['patientInfo']): AmbientSession => {
    const now = Date.now();
    const session: AmbientSession = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      status: 'recording',
      recordingDuration: 0,
      capturedImages: [],
      patientId,
      patientInfo,
    };
    setSessions(prev => [session, ...prev]);
    setCurrentSession(session);
    scheduleCloudSync(session.id);
    return session;
  };

  const resumeFromCloud = (cloudSession: any): AmbientSession => {
    const sessionData = cloudSession.session_data || {};
    const now = Date.now();
    // Check if we already have this cloud session locally
    const existing = sessions.find(s => s.cloudSessionId === cloudSession.id);
    if (existing) {
      setCurrentSession(existing);
      return existing;
    }
    const session: AmbientSession = {
      id: sessionData.local_id || generateId(),
      createdAt: sessionData.created_at || now,
      updatedAt: now,
      status: (cloudSession.status === 'in_progress' ? 'captured' : cloudSession.status) as AmbientSession['status'],
      recordingDuration: sessionData.recording_duration || 0,
      recordingUri: sessionData.recording_uri,
      capturedImages: [],
      patientId: cloudSession.patient_id,
      patientInfo: sessionData.patient_info,
      patientContext: sessionData.patient_context,
      audioS3Uri: sessionData.audio_s3_uri || cloudSession.audio_s3_uri,
      transcript: typeof cloudSession.transcript === 'string' ? cloudSession.transcript : undefined,
      fullNote: cloudSession.generated_note,
      cloudSessionId: cloudSession.id,
      savedToCloud: false,
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
    // Auto cloud sync on important changes
    if (updates.status || updates.soapNote || updates.audioS3Uri || updates.patientInfo || updates.errorMessage) {
      scheduleCloudSync(id);
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
    createLinkedSession,
    resumeFromCloud,
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
