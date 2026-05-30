import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking } from 'react-native';

const AI_CONSENT_KEY = '@domynote_ai_consent';

/**
 * Check if the user has already consented to third-party AI data sharing.
 */
export async function hasAIConsent(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(AI_CONSENT_KEY);
    return value === 'granted';
  } catch {
    return false;
  }
}

/**
 * Persist the user's AI consent decision.
 */
export async function setAIConsent(granted: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(AI_CONSENT_KEY, granted ? 'granted' : 'denied');
  } catch (e) {
    console.error('Failed to set AI consent', e);
  }
}

/**
 * Request explicit user consent for sharing medical data with HIPAA-compliant third-party AI systems.
 * Uses a clean Native Alert dialog matching standard App Store guidelines.
 */
export function requestAIConsent(options: {
  onAgree: () => void;
  onDisagree?: () => void;
}) {
  Alert.alert(
    'AI Data Sharing Consent',
    'To generate clinical documentation and answer clinical questions, DoMyNote securely processes clinical audio, text, and images using advanced medical AI models. All data is processed in strict compliance with HIPAA privacy standards.\n\nBy continuing, you agree to securely process this encounter\'s data using our HIPAA-compliant AI partners (including AWS HealthScribe and OpenAI). No patient-identifiable data is shared.',
    [
      {
        text: 'View Privacy Policy',
        onPress: () => {
          Linking.openURL('https://domynote.ai/privacy').catch(() => {});
          // Re-trigger after viewing privacy policy so they can still consent
          setTimeout(() => {
            requestAIConsent(options);
          }, 1000);
        },
      },
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: () => {
          options.onDisagree?.();
        },
      },
      {
        text: 'I Agree',
        style: 'default',
        onPress: async () => {
          await setAIConsent(true);
          options.onAgree();
        },
      },
    ],
    { cancelable: false }
  );
}
