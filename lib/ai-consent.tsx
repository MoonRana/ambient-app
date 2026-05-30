import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';

const AI_CONSENT_KEY = '@domynote_ai_consent';
const PRIVACY_URL = 'https://domynote.com/privacy';

type ConsentResolver = {
  resolve: (granted: boolean) => void;
};

let pendingResolver: ConsentResolver | null = null;
let showModalCallback: ((pending: ConsentResolver) => void) | null = null;

/** Register the global modal handler (called from root layout). */
export function registerAIConsentModal(show: (pending: ConsentResolver) => void) {
  showModalCallback = show;
}

export function unregisterAIConsentModal() {
  showModalCallback = null;
}

export async function hasAIConsent(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(AI_CONSENT_KEY);
    return value === 'granted';
  } catch {
    return false;
  }
}

export async function setAIConsent(granted: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(AI_CONSENT_KEY, granted ? 'granted' : 'denied');
  } catch (e) {
    console.error('Failed to set AI consent', e);
  }
}

export function openPrivacyPolicy() {
  Linking.openURL(PRIVACY_URL).catch(() => {});
}

/**
 * Show the in-app AI consent modal and wait for the user's decision.
 * Required by App Store Guideline 5.1.1 before sending data to third-party AI.
 */
export function requestAIConsent(options?: {
  onAgree?: () => void;
  onDisagree?: () => void;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = async (granted: boolean) => {
      if (granted) {
        await setAIConsent(true);
        options?.onAgree?.();
      } else {
        options?.onDisagree?.();
      }
      resolve(granted);
    };

    if (!showModalCallback) {
      // Fallback if modal not mounted yet
      finish(false);
      return;
    }

    pendingResolver = {
      resolve: (granted) => {
        pendingResolver = null;
        finish(granted);
      },
    };
    showModalCallback(pendingResolver);
  });
}

/** Called by AIConsentModal when user taps Agree / Not Now */
export function resolveAIConsent(granted: boolean) {
  pendingResolver?.resolve(granted);
  pendingResolver = null;
}

/** Ensure consent before an AI action; returns true if allowed to proceed. */
export async function ensureAIConsent(): Promise<boolean> {
  if (await hasAIConsent()) return true;
  return requestAIConsent();
}
