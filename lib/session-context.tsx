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
  patientId?: string;
  encounterId?: string;
  savedToCloud?: boolean;
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

// Legacy saveSessionToSupabase removed — we now only write to ambient_sessions via the Review screen's Save & Finish pipeline.

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
