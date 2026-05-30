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
import { SettingsProvider } from "@/lib/settings-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AIConsentProvider } from "@/components/AIConsentProvider";
import { SCREENSHOT_DEMO, SCREENSHOT_DEMO_JOBS } from "@/lib/screenshot-demo";
import { useJobsStore } from "@/lib/stores/useJobsStore";

SplashScreen.preventAutoHideAsync();

function routeFromExpoUrl(url: string): string | null {
  const marker = '--';
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = url.slice(i + marker.length).split('?')[0];
  if (!path || path === '/') return '/(tabs)';
  return path.startsWith('/') ? path : `/${path}`;
}

function ScreenshotDemoSeed() {
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (!SCREENSHOT_DEMO) return;
    useJobsStore.setState({ jobs: SCREENSHOT_DEMO_JOBS });
  }, []);

  useEffect(() => {
    if (!SCREENSHOT_DEMO || !navigationState?.key) return;

    const go = (url: string | null) => {
      if (!url) return;
      const route = routeFromExpoUrl(url);
      if (route) router.replace(route as Href);
    };

    Linking.getInitialURL().then(go);
    const sub = Linking.addEventListener('url', (e) => go(e.url));
    return () => sub.remove();
  }, [navigationState?.key]);

  return null;
}

function RootLayoutNav() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    // Wait until both auth check and navigator are ready
    if (isLoading || !navigationState?.key) return;

    const inLoginScreen = segments[0] === 'login';

    if (!session && !inLoginScreen) {
      // Not authenticated — go to login
      router.replace('/login');
    } else if (session && inLoginScreen) {
      // Authenticated but stuck on login — go to main app
      router.replace('/(tabs)');
    }
    // Otherwise: correct screen, do nothing
  }, [session, isLoading, segments, navigationState?.key]);

  return (
    <>
      <ScreenshotDemoSeed />
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
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
