import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { Session, User } from '@supabase/supabase-js';
import { SCREENSHOT_DEMO, SCREENSHOT_DEMO_SESSION } from './screenshot-demo';

interface AuthContextValue {
    session: Session | null;
    user: User | null;
    isLoading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string, name?: string) => Promise<void>;
    signOut: () => Promise<void>;
    deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (SCREENSHOT_DEMO) {
            // Ignore real Supabase auth events — demo uses a local mock session only.
            setSession(SCREENSHOT_DEMO_SESSION);
            setIsLoading(false);
            return;
        }

        supabase.auth.getSession().then(({ data: { session }, error }) => {
            if (error) {
                // Stale / invalid refresh token — clear the session and force re-login
                supabase.auth.signOut({ scope: 'local' }).catch(() => { });
                setSession(null);
            } else {
                setSession(session);
            }
            setIsLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    };

    const signUp = async (email: string, password: string, name?: string) => {
        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } },
        });
        if (error) throw error;
    };

    const signOut = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    };

    const deleteAccount = async () => {
        const accessToken = session?.access_token;
        if (!accessToken) throw new Error('No active session');

        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
        const response = await fetch(
            `${supabaseUrl}/functions/v1/delete-account`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            },
        );

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete account');
        }

        // Clear all local data
        await AsyncStorage.clear();
        // Sign out locally
        await supabase.auth.signOut();
    };

    return (
        <AuthContext.Provider value={{
            session,
            user: session?.user ?? null,
            isLoading,
            signIn,
            signUp,
            signOut,
            deleteAccount,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
}
