import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn, FadeOut,
  useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming, Easing,
} from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { useFreestyleStore, type RecordingInput, type RecordingState as RecState } from '@/lib/stores/useFreestyleStore';
import { copyToPersistentStorage } from '@/lib/supabase-api';
import WaveformVisualizer from '@/components/WaveformVisualizer';

interface Props {
  workflowId: string;
  recording: RecordingInput;
  index: number;
}

export default function RecordingRow({ workflowId, recording, index }: Props) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const updateRecording = useFreestyleStore((s) => s.updateRecording);
  const removeRecording = useFreestyleStore((s) => s.removeRecording);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(recording.duration);
  const [localState, setLocalState] = useState<RecState>(recording.state);

  // Blinking dot
  const dotOpacity = useSharedValue(1);
  useEffect(() => {
    if (localState === 'recording') {
      dotOpacity.value = withRepeat(
        withSequence(
          withTiming(0.2, { duration: 500, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    } else {
      dotOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [localState]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
    };
  }, []);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleStart = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Microphone access is needed to record.');
        return;
      }

      if (Platform.OS !== 'web') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = rec;
      setLocalState('recording');
      setElapsed(0);
      startTimer();
      updateRecording(workflowId, recording.id, {
        state: 'recording',
        startedAt: Date.now(),
      });
      try { await activateKeepAwakeAsync(); } catch {}
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      Alert.alert('Recording Error', err.message || 'Could not start recording.');
    }
  };

  const handlePause = async () => {
    try {
      if (recordingRef.current) {
        await recordingRef.current.pauseAsync();
        setLocalState('paused');
        stopTimer();
        updateRecording(workflowId, recording.id, { state: 'paused', duration: elapsed });
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (err) {
      console.error('Failed to pause:', err);
    }
  };

  const handleResume = async () => {
    try {
      if (recordingRef.current) {
        await recordingRef.current.startAsync();
        setLocalState('recording');
        startTimer();
        updateRecording(workflowId, recording.id, { state: 'recording' });
        if (Platform.OS !== 'web') {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }
    } catch (err) {
      console.error('Failed to resume:', err);
    }
  };

  const handleStop = async () => {
    try {
      stopTimer();
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;
        setLocalState('stopped');

        // Copy to persistent storage
        let persistentUri = uri;
        if (uri) {
          try {
            persistentUri = await copyToPersistentStorage(uri, `${workflowId}_${recording.id}`);
          } catch (e) {
            console.warn('Failed to copy to persistent storage:', e);
          }
        }

        updateRecording(workflowId, recording.id, {
          state: 'stopped',
          duration: elapsed,
          uri: persistentUri || undefined,
          stoppedAt: Date.now(),
        });

        if (Platform.OS !== 'web') {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        deactivateKeepAwake();
      }
    } catch (err) {
      console.error('Failed to stop:', err);
    }
  };

  const handleDelete = () => {
    if (localState === 'recording' || localState === 'paused') {
      Alert.alert('Stop Recording', 'Stop the recording before deleting.', [{ text: 'OK' }]);
      return;
    }
    removeRecording(workflowId, recording.id);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isLive = localState === 'recording';
  const isPaused = localState === 'paused';
  const isIdle = localState === 'idle';
  const isStopped = localState === 'stopped' || localState === 'transcribed';

  const stateColor = isLive
    ? colors.recording
    : isPaused
      ? colors.warning
      : isStopped
        ? colors.accent
        : colors.textTertiary;

  const stateLabel = isLive
    ? 'Recording'
    : isPaused
      ? 'Paused'
      : isStopped
        ? `Recorded · ${formatTime(recording.duration || elapsed)}`
        : 'Ready';

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={[styles.row, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
    >
      {/* Left: status + info */}
      <View style={styles.info}>
        <View style={styles.labelRow}>
          {isLive && (
            <Animated.View style={[styles.liveDot, { backgroundColor: colors.recording }, dotStyle]} />
          )}
          <Text style={[styles.recLabel, { color: colors.text }]}>
            Recording {index + 1}
          </Text>
        </View>
        <Text style={[styles.stateText, { color: stateColor }]}>{stateLabel}</Text>

        {/* Timer for active recordings */}
        {(isLive || isPaused) && (
          <Text style={[styles.timer, { color: isLive ? colors.recording : colors.warning }]}>
            {formatTime(elapsed)}
          </Text>
        )}

        {/* Mini waveform */}
        {isLive && (
          <View style={styles.waveContainer}>
            <WaveformVisualizer isActive={true} color={colors.recording} barCount={20} height={30} />
          </View>
        )}
      </View>

      {/* Right: controls */}
      <View style={styles.controls}>
        {isIdle && (
          <Pressable
            onPress={handleStart}
            style={({ pressed }) => [
              styles.controlBtn,
              { backgroundColor: colors.recording, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="mic" size={18} color="#fff" />
          </Pressable>
        )}

        {isLive && (
          <>
            <Pressable
              onPress={handlePause}
              style={({ pressed }) => [
                styles.controlBtn,
                { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="pause" size={16} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={handleStop}
              style={({ pressed }) => [
                styles.controlBtn,
                { backgroundColor: colors.recording, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="stop" size={16} color="#fff" />
            </Pressable>
          </>
        )}

        {isPaused && (
          <>
            <Pressable
              onPress={handleResume}
              style={({ pressed }) => [
                styles.controlBtn,
                { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="play" size={16} color="#fff" />
            </Pressable>
            <Pressable
              onPress={handleStop}
              style={({ pressed }) => [
                styles.controlBtn,
                { backgroundColor: colors.recording, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="stop" size={16} color="#fff" />
            </Pressable>
          </>
        )}

        {isStopped && (
          <View style={[styles.doneBadge, { backgroundColor: `${colors.accent}15` }]}>
            <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
          </View>
        )}

        {/* Delete (always visible unless recording) */}
        {!isLive && (
          <Pressable onPress={handleDelete} hitSlop={8} style={{ padding: 4 }}>
            <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  recLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  stateText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  timer: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  waveContainer: {
    marginTop: 4,
    height: 30,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
