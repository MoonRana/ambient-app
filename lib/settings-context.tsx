import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import {
  type ClinicalSetting,
  type DefaultHomeAction,
  getDefaultsForClinicalSetting,
} from '@/lib/clinical-settings';
import { SCREENSHOT_DEMO } from '@/lib/screenshot-demo';

export type { ClinicalSetting, DefaultHomeAction };

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
  clinicalSetting: ClinicalSetting;
  setClinicalSetting: (v: ClinicalSetting) => void;
  hasCompletedOnboarding: boolean;
  completeOnboarding: (setting: ClinicalSetting) => void;
  defaultHomeAction: DefaultHomeAction;
  setDefaultHomeAction: (v: DefaultHomeAction) => void;
  freestyleShowRecording: boolean;
  setFreestyleShowRecording: (v: boolean) => void;
  defaultEmLevel: string | null;
  setDefaultEmLevel: (v: string | null) => void;
  settingsLoaded: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const SETTINGS_KEY = '@domynote_settings';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [autoSave, setAutoSave] = useState(true);
  const [highQualityAudio, setHighQualityAudio] = useState(true);
  const [hapticFeedback, setHapticFeedback] = useState(true);
  const [sessionCount, setSessionCount] = useState(0);
  const [themePreference, setThemePreference] = useState<'system' | 'light' | 'dark'>('system');
  const [clinicalSetting, setClinicalSettingState] = useState<ClinicalSetting>('clinic');
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(SCREENSHOT_DEMO);
  const [defaultHomeAction, setDefaultHomeAction] = useState<DefaultHomeAction>('freestyle_capture');
  const [freestyleShowRecording, setFreestyleShowRecording] = useState(false);
  const [defaultEmLevel, setDefaultEmLevel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (loaded) {
      saveSettings();
    }
  }, [
    autoSave,
    highQualityAudio,
    hapticFeedback,
    themePreference,
    clinicalSetting,
    hasCompletedOnboarding,
    defaultHomeAction,
    freestyleShowRecording,
    defaultEmLevel,
    loaded,
  ]);

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
        setClinicalSettingState(parsed.clinicalSetting ?? 'clinic');
        setHasCompletedOnboarding(SCREENSHOT_DEMO || parsed.hasCompletedOnboarding === true);
        setDefaultHomeAction(parsed.defaultHomeAction ?? 'freestyle_capture');
        setFreestyleShowRecording(parsed.freestyleShowRecording ?? false);
        setDefaultEmLevel(parsed.defaultEmLevel ?? null);
      } else if (SCREENSHOT_DEMO) {
        setHasCompletedOnboarding(true);
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
        clinicalSetting,
        hasCompletedOnboarding,
        defaultHomeAction,
        freestyleShowRecording,
        defaultEmLevel,
      }));
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  };

  const setClinicalSetting = useCallback((setting: ClinicalSetting) => {
    setClinicalSettingState(setting);
  }, []);

  const completeOnboarding = useCallback((setting: ClinicalSetting) => {
    const defaults = getDefaultsForClinicalSetting(setting);
    setClinicalSettingState(setting);
    setDefaultHomeAction(defaults.defaultHomeAction);
    setFreestyleShowRecording(defaults.freestyleShowRecording);
    setHasCompletedOnboarding(true);
  }, []);

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
    clinicalSetting,
    setClinicalSetting,
    hasCompletedOnboarding,
    completeOnboarding,
    defaultHomeAction,
    setDefaultHomeAction,
    freestyleShowRecording,
    setFreestyleShowRecording,
    defaultEmLevel,
    setDefaultEmLevel,
    settingsLoaded: loaded,
  }), [
    autoSave,
    highQualityAudio,
    hapticFeedback,
    sessionCount,
    themePreference,
    clinicalSetting,
    hasCompletedOnboarding,
    completeOnboarding,
    defaultHomeAction,
    freestyleShowRecording,
    defaultEmLevel,
    loaded,
  ]);

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
