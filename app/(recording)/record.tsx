import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, useColorScheme, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions } from '@/lib/session-context';
import RecordButton from '@/components/RecordButton';
import WaveformVisualizer from '@/components/WaveformVisualizer';

type RecordingState = 'idle' | 'recording' | 'paused';

export default function RecordScreen() {
  const colorScheme = useColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { currentSession, updateSession } = useSessions();

  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      deactivateKeepAwake();
    };
  }, []);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startRecording = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setRecordingState('recording');
      setElapsed(0);
      startTimer();

      try { await activateKeepAwakeAsync(); } catch {}

      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const pauseRecording = async () => {
    try {
      if (recordingRef.current) {
        await recordingRef.current.pauseAsync();
        setRecordingState('paused');
        stopTimer();
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }
    } catch (err) {
      console.error('Failed to pause recording', err);
    }
  };

  const resumeRecording = async () => {
    try {
      if (recordingRef.current) {
        await recordingRef.current.startAsync();
        setRecordingState('recording');
        startTimer();
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }
    } catch (err) {
      console.error('Failed to resume recording', err);
    }
  };

  const stopRecording = async () => {
    try {
      stopTimer();
      deactivateKeepAwake();

      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;
        setRecordingState('idle');

        if (currentSession) {
          updateSession(currentSession.id, {
            recordingDuration: elapsed,
            recordingUri: uri || undefined,
            status: 'captured',
          });
        }

        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }

        router.push('/(recording)/capture');
      }
    } catch (err) {
      console.error('Failed to stop recording', err);
    }
  };

  const handleRecordPress = () => {
    if (recordingState === 'idle') {
      startRecording();
    } else if (recordingState === 'recording') {
      stopRecording();
    } else if (recordingState === 'paused') {
      stopRecording();
    }
  };

  const handleCancel = () => {
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    stopTimer();
    deactivateKeepAwake();
    router.dismissAll();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) {
      return `${hrs}:${(mins % 60).toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const webTopInset = Platform.OS === 'web' ? 20 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <Pressable
          onPress={handleCancel}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>

        <View style={[styles.stepIndicator, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={[styles.stepDot, { backgroundColor: colors.tint }]} />
          <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
          <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
        </View>

        <View style={{ width: 36 }} />
      </View>

      <View style={styles.content}>
        <Animated.View entering={FadeIn.duration(400)} style={styles.timerSection}>
          <Text style={[styles.stateLabel, {
            color: recordingState === 'recording' ? colors.recording
              : recordingState === 'paused' ? colors.warning
              : colors.textSecondary,
          }]}>
            {recordingState === 'recording' ? 'Recording'
              : recordingState === 'paused' ? 'Paused'
              : 'Ready to Record'}
          </Text>
          <Text style={[styles.timer, { color: colors.text }]}>
            {formatTime(elapsed)}
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.waveSection}>
          <WaveformVisualizer
            isActive={recordingState === 'recording'}
            color={recordingState === 'recording' ? colors.recording : colors.border}
            barCount={28}
            height={60}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.controlsSection}>
          <View style={styles.controlsRow}>
            {recordingState !== 'idle' ? (
              <Pressable
                onPress={recordingState === 'recording' ? pauseRecording : resumeRecording}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons
                  name={recordingState === 'paused' ? 'play' : 'pause'}
                  size={24}
                  color={colors.text}
                />
              </Pressable>
            ) : (
              <View style={{ width: 52 }} />
            )}

            <RecordButton
              isRecording={recordingState !== 'idle'}
              isPaused={recordingState === 'paused'}
              onPress={handleRecordPress}
              size={80}
            />

            {recordingState !== 'idle' ? (
              <Pressable
                onPress={stopRecording}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="stop" size={24} color={colors.recording} />
              </Pressable>
            ) : (
              <View style={{ width: 52 }} />
            )}
          </View>

          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {recordingState === 'idle'
              ? 'Tap the button to begin recording'
              : recordingState === 'recording'
              ? 'Tap stop when the encounter is complete'
              : 'Tap to stop or resume recording'}
          </Text>
        </Animated.View>
      </View>

      <View style={[styles.footer, { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16) + 8 }]}>
        {recordingState === 'idle' && (
          <Pressable
            onPress={() => {
              if (currentSession) {
                updateSession(currentSession.id, { status: 'captured' });
              }
              router.push('/(recording)/capture');
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[styles.skipText, { color: colors.tint }]}>Skip recording</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndicator: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 48,
  },
  timerSection: {
    alignItems: 'center',
    gap: 8,
  },
  stateLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  timer: {
    fontSize: 56,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  waveSection: {
    width: '100%',
    paddingHorizontal: 16,
  },
  controlsSection: {
    alignItems: 'center',
    gap: 24,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  secondaryBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 12,
  },
  skipText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
});
