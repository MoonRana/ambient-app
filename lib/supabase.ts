import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SCREENSHOT_DEMO } from './screenshot-demo';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL — check your .env file and restart Expo with: npx expo start --clear');
}

const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY — check your .env file and restart Expo with: npx expo start --clear');
}

/** In-memory storage so demo mode never reads stale refresh tokens from the device. */
const demoAuthStorage = {
  getItem: async (_key: string) => null,
  setItem: async (_key: string, _value: string) => {},
  removeItem: async (_key: string) => {},
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SCREENSHOT_DEMO ? demoAuthStorage : AsyncStorage,
    autoRefreshToken: !SCREENSHOT_DEMO,
    persistSession: !SCREENSHOT_DEMO,
    detectSessionInUrl: false,
  },
});
