import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';

interface SettingsContextValue {
  autoSave: boolean;
  setAutoSave: (v: boolean) => void;
  highQualityAudio: boolean;
  setHighQualityAudio: (v: boolean) => void;
  hapticFeedback: boolean;
  setHapticFeedback: (v: boolean) => void;
  sessionCount: number;
  themePreference: 'system' | 'light' | 'dark';
  setThemePreference: (v: 'system' | 'light' | 'dark') => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const SETTINGS_KEY = '@domynote_settings';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [autoSave, setAutoSave] = useState(true);
  const [highQualityAudio, setHighQualityAudio] = useState(true);
  const [hapticFeedback, setHapticFeedback] = useState(true);
  const [sessionCount, setSessionCount] = useState(0);
  const [themePreference, setThemePreference] = useState<'system' | 'light' | 'dark'>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (loaded) {
      saveSettings();
    }
  }, [autoSave, highQualityAudio, hapticFeedback, themePreference]);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setAutoSave(parsed.autoSave ?? true);
        setHighQualityAudio(parsed.highQualityAudio ?? true);
        setHapticFeedback(parsed.hapticFeedback ?? true);
        setSessionCount(parsed.sessionCount ?? 0);
        setThemePreference(parsed.themePreference ?? 'system');
      }
    } catch (e) {
      console.error('Failed to load settings', e);
    } finally {
      setLoaded(true);
    }
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({
        autoSave,
        highQualityAudio,
        hapticFeedback,
        sessionCount,
        themePreference,
      }));
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  };

  const value = useMemo(() => ({
    autoSave,
    setAutoSave,
    highQualityAudio,
    setHighQualityAudio,
    hapticFeedback,
    setHapticFeedback,
    sessionCount,
    themePreference,
    setThemePreference,
  }), [autoSave, highQualityAudio, hapticFeedback, sessionCount, themePreference]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

export function useEffectiveColorScheme(): 'light' | 'dark' {
  const systemScheme = useColorScheme();
  let themePreference: 'system' | 'light' | 'dark' = 'system';
  try {
    const context = useContext(SettingsContext);
    if (context) themePreference = context.themePreference;
  } catch {
    // outside of provider, fall back to system
  }
  if (themePreference === 'system') return systemScheme ?? 'light';
  return themePreference;
}
