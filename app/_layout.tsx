import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments, useRootNavigationState, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { SessionProvider } from "@/lib/session-context";
import { SettingsProvider, useSettings } from "@/lib/settings-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AIConsentProvider } from "@/components/AIConsentProvider";
import { SCREENSHOT_DEMO, SCREENSHOT_DEMO_AMBIENT_SESSIONS, SCREENSHOT_DEMO_JOBS } from "@/lib/screenshot-demo";
import { useJobsStore } from "@/lib/stores/useJobsStore";
import { useSessions, type AmbientSession } from "@/lib/session-context";

SplashScreen.preventAutoHideAsync();

function parseExpoUrl(url: string): { pathname: string; params: Record<string, string> } | null {
  const marker = '--';
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const rest = url.slice(i + marker.length);
  const qIndex = rest.indexOf('?');
  const pathPart = qIndex === -1 ? rest : rest.slice(0, qIndex);
  const queryPart = qIndex === -1 ? '' : rest.slice(qIndex + 1);
  const pathname =
    !pathPart || pathPart === '/'
      ? '/(tabs)'
      : pathPart.startsWith('/')
        ? pathPart
        : `/${pathPart}`;

  const params: Record<string, string> = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((value, key) => {
      params[key] = value;
    });
  }

  return { pathname, params };
}

function demoSessionForRoute(pathname: string): AmbientSession | null {
  if (pathname.includes('/record')) {
    return SCREENSHOT_DEMO_AMBIENT_SESSIONS.find((s) => s.status === 'recording') ?? null;
  }
  if (pathname.includes('/review')) {
    return SCREENSHOT_DEMO_AMBIENT_SESSIONS.find((s) => s.status === 'reviewing') ?? null;
  }
  if (pathname.includes('/patient-info')) {
    return SCREENSHOT_DEMO_AMBIENT_SESSIONS.find((s) => s.id === 'demo-recording-1') ?? null;
  }
  return null;
}

function ScreenshotDemoSeed() {
  const navigationState = useRootNavigationState();
  const { setCurrentSession } = useSessions();

  useEffect(() => {
    if (!SCREENSHOT_DEMO) return;
    useJobsStore.setState({ jobs: SCREENSHOT_DEMO_JOBS });
  }, []);

  useEffect(() => {
    if (!SCREENSHOT_DEMO || !navigationState?.key) return;

    const go = (url: string | null) => {
      if (!url) return;
      const parsed = parseExpoUrl(url);
      if (!parsed) return;

      const demoSession = demoSessionForRoute(parsed.pathname);
      if (demoSession) setCurrentSession(demoSession);

      if (Object.keys(parsed.params).length > 0) {
        router.replace({
          pathname: parsed.pathname as any,
          params: parsed.params,
        });
        return;
      }

      router.replace(parsed.pathname as Href);
    };

    Linking.getInitialURL().then(go);
    const sub = Linking.addEventListener('url', (e) => go(e.url));
    return () => sub.remove();
  }, [navigationState?.key, setCurrentSession]);

  return null;
}

function RootLayoutNav() {
  const { session, isLoading } = useAuth();
  const { hasCompletedOnboarding, settingsLoaded } = useSettings();
  const segments = useSegments();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (isLoading || !navigationState?.key || !settingsLoaded) return;

    const inLoginScreen = segments[0] === 'login';
    const inOnboarding = (segments[0] as string) === 'onboarding';

    if (!session && !inLoginScreen) {
      router.replace('/login');
    } else if (session && inLoginScreen) {
      router.replace('/(tabs)');
    } else if (
      session &&
      !hasCompletedOnboarding &&
      !inOnboarding &&
      !SCREENSHOT_DEMO
    ) {
      router.replace('/onboarding/clinical-setting' as Href);
    }
  }, [session, isLoading, segments, navigationState?.key, hasCompletedOnboarding, settingsLoaded]);

  return (
    <>
      <ScreenshotDemoSeed />
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="(recording)"
        options={{ presentation: "modal", headerShown: false }}
      />
      <Stack.Screen name="session-detail" options={{ headerShown: false }} />
    </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView>
          <KeyboardProvider>
            <AuthProvider>
              <AIConsentProvider>
              <SettingsProvider>
                <SessionProvider>
                  <RootLayoutNav />
                </SessionProvider>
              </SettingsProvider>
              </AIConsentProvider>
            </AuthProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
