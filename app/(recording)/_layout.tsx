import { Stack } from "expo-router";
import React from "react";

export default function RecordingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="permission" />
      <Stack.Screen name="record" />
      <Stack.Screen name="capture" />
      <Stack.Screen name="review" />
      <Stack.Screen name="patient-info" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
