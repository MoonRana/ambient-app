import { Stack } from "expo-router";
import React from "react";

export default function RecordingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade_from_bottom",
        animationDuration: 250,
      }}
    >
      <Stack.Screen name="encounter-picker" options={{ animation: "fade" }} />
      <Stack.Screen name="permission" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="record" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="capture" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="review" options={{ animation: "fade_from_bottom" }} />
      <Stack.Screen name="patient-info" options={{ presentation: 'modal', animation: "slide_from_bottom" }} />
    </Stack>
  );
}
