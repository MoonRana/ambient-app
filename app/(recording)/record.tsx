import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn, FadeInDown,
  useSharedValue, useAnimatedStyle, withRepeat,
  withTiming, withSequence, Easing,
} from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions, CapturedImage } from '@/lib/session-context';
import RecordButton from '@/components/RecordButton';
import WaveformVisualizer from '@/components/WaveformVisualizer';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { playRecordingStart, playRecordingStop } from '@/lib/recording-sounds';
import { analyzeInsuranceCard } from '@/lib/supabase-api';

type RecordingState = 'idle' | 'recording' | 'paused';

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export default function RecordScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();
  const { currentSession, updateSession } = useSessions();

  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Document capture state (captured DURING recording) ──────────────────
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [scanningId, setScanningId] = useState<string | null>(null);

  // Pulsing red dot for "live" indicator
  const dotOpacity = useSharedValue(1);
  useEffect(() => {
    dotOpacity.value = withRepeat(
      withSequence(
        withTiming(0.3, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      deactivateKeepAwake();
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => { });
        recordingRef.current = null;
      }
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
        staysActiveInBackground: true,
      });

      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch { }
        recordingRef.current = null;
      }

      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Microphone permission is required to record.');
      }

      if (Platform.OS !== 'web') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        await new Promise(r => setTimeout(r, 80));
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }

      await playRecordingStart();
      await new Promise(r => setTimeout(r, 300));

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;

      setRecordingState('recording');
      setElapsed(0);
      startTimer();

      try { await activateKeepAwakeAsync(); } catch { }
    } catch (err: any) {
      console.error('Failed to start recording', err);
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => { });
    }
  };

  const pauseRecording = async () => {
    try {
      if (recordingRef.current) {
        await recordingRef.current.pauseAsync();
        setRecordingState('paused');
        stopTimer();
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          await new Promise(r => setTimeout(r, 70));
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
            // Carry captured images into the session so the Capture screen pre-fills them
            capturedImages: capturedImages,
          });
        }

        if (Platform.OS !== 'web') {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          await new Promise(r => setTimeout(r, 100));
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }

        playRecordingStop();

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
      recordingRef.current.stopAndUnloadAsync().catch(() => { });
      recordingRef.current = null;
    }
    stopTimer();
    deactivateKeepAwake();
    router.dismissAll();
  };

  // ── Document capture during recording ─────────────────────────────────
  const captureDocument = async (useCamera: boolean) => {
    try {
      let result;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera Access', 'Camera permission is required to capture documents.');
          return;
        }
        // Recording continues in background while camera is open
        result = await ImagePicker.launchCameraAsync({
          quality: 0.85,
          allowsEditing: false,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Photo Access', 'Photo library permission is required.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          quality: 0.85,
          allowsMultipleSelection: true,
          selectionLimit: 5,
        });
      }

      if (!result.canceled && result.assets) {
        const newImages: CapturedImage[] = result.assets.map(asset => ({
          uri: asset.uri,
          id: generateId(),
          timestamp: Date.now(),
        }));
        setCapturedImages(prev => [...prev, ...newImages]);

        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (err) {
      console.error('Failed to capture document', err);
    }
  };

  const removeImage = (id: string) => {
    setCapturedImages(prev => prev.filter(img => img.id !== id));
  };

  const quickScanImage = async (img: CapturedImage) => {
    if (scanningId) return;
    setScanningId(img.id);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    try {
      const info = await analyzeInsuranceCard(img.uri);
      const extracted = [
        info.patient_name ? `Name: ${info.patient_name}` : null,
        info.date_of_birth ? `DOB: ${info.date_of_birth}` : null,
        info.payer_name ? `Insurance: ${info.payer_name}` : null,
        info.member_id ? `Member ID: ${info.member_id}` : null,
      ].filter(Boolean).join('\n');

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Document Scanned ✓', extracted || 'Captured — will be processed during review.');
    } catch {
      Alert.alert('Scan Note', 'Document saved — will be fully processed during review.');
    } finally {
      setScanningId(null);
    }
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
  const isLive = recordingState === 'recording';
  const isActive = recordingState !== 'idle';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
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

        {/* Live indicator pill */}
        <View style={[styles.livePill, {
          backgroundColor: isLive ? colors.recordingLight : colors.surfaceSecondary,
          borderColor: isLive ? colors.recording : 'transparent',
        }]}>
          {isLive && (
            <Animated.View style={[styles.liveDot, { backgroundColor: colors.recording }, dotStyle]} />
          )}
          <Text style={[styles.liveText, {
            color: isLive ? colors.recording : colors.textSecondary,
          }]}>
            {isLive ? 'LIVE' : recordingState === 'paused' ? 'PAUSED' : 'READY'}
          </Text>
        </View>

        {/* Doc count badge — tapping scrolls the eye to the strip below */}
        <Pressable
          onPress={() => { /* doc strip is always visible while recording */ }}
          style={({ pressed }) => [
            styles.docBadgeBtn,
            { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="documents-outline" size={18} color={capturedImages.length > 0 ? colors.accent : colors.text} />
          {capturedImages.length > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.accent }]}>
              <Text style={styles.badgeText}>{capturedImages.length}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* ── Main content ── */}
      <View style={styles.content}>
        {/* Timer */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.timerSection}>
          <Text style={[styles.timer, { color: colors.text }]}>
            {formatTime(elapsed)}
          </Text>
          <Text style={[styles.stateLabel, {
            color: isLive ? colors.recording
              : recordingState === 'paused' ? colors.warning
                : colors.textSecondary,
          }]}>
            {isLive ? 'Recording in Progress'
              : recordingState === 'paused' ? 'Paused'
                : 'Ready to Record'}
          </Text>
        </Animated.View>

        {/* Waveform */}
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.waveSection}>
          <WaveformVisualizer
            isActive={isLive}
            color={isLive ? colors.recording : colors.border}
            barCount={28}
            height={60}
          />
        </Animated.View>

        {/* Controls row */}
        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.controlsSection}>
          <View style={styles.controlsRow}>
            {/* Left: pause/resume */}
            {isActive ? (
              <Pressable
                onPress={isLive ? pauseRecording : resumeRecording}
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
              isRecording={isActive}
              isPaused={recordingState === 'paused'}
              onPress={handleRecordPress}
              size={80}
            />

            {/* Right: stop (when active) */}
            {isActive ? (
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

        {/* ── Document capture strip (shown when recording or paused) ── */}
        {isActive && (
          <Animated.View
            entering={FadeInDown.duration(350).delay(100)}
            style={[styles.docStrip, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={styles.docStripHeader}>
              <View style={styles.docStripLeft}>
                <Ionicons name="documents" size={16} color={colors.accent} />
                <Text style={[styles.docStripTitle, { color: colors.text }]}>
                  Documents Captured
                </Text>
                <View style={[styles.docCountPill, { backgroundColor: colors.accentLight }]}>
                  <Text style={[styles.docCountText, { color: colors.accent }]}>
                    {capturedImages.length}
                  </Text>
                </View>
              </View>
              <View style={styles.docActions}>
                <Pressable
                  onPress={() => captureDocument(false)}
                  style={({ pressed }) => [
                    styles.docActionBtn,
                    { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
                  ]}
                  hitSlop={8}
                >
                  <Ionicons name="images-outline" size={18} color={colors.tint} />
                </Pressable>
                <Pressable
                  onPress={() => captureDocument(true)}
                  style={({ pressed }) => [
                    styles.docActionBtn,
                    styles.docActionBtnPrimary,
                    { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
                  ]}
                  hitSlop={8}
                >
                  <Ionicons name="camera" size={18} color="#fff" />
                </Pressable>
              </View>
            </View>

            {capturedImages.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.thumbnailScroll}
                contentContainerStyle={styles.thumbnailContent}
              >
                {capturedImages.map((img, idx) => (
                  <Animated.View
                    key={img.id}
                    entering={FadeIn.duration(250).delay(idx * 30)}
                    style={styles.thumbWrapper}
                  >
                    <Image
                      source={{ uri: img.uri }}
                      style={[styles.thumb, { borderColor: colors.border }]}
                      contentFit="cover"
                    />
                    {/* Quick scan button */}
                    <Pressable
                      onPress={() => quickScanImage(img)}
                      disabled={!!scanningId}
                      style={[
                        styles.thumbScanBtn,
                        { backgroundColor: scanningId === img.id ? colors.accent : colors.surface, borderColor: colors.border },
                      ]}
                    >
                      {scanningId === img.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name="scan-outline" size={11} color={colors.accent} />
                      )}
                    </Pressable>
                    {/* Remove button */}
                    <Pressable
                      onPress={() => removeImage(img.id)}
                      style={[styles.thumbRemoveBtn, { backgroundColor: colors.recording }]}
                      hitSlop={6}
                    >
                      <Ionicons name="close" size={11} color="#fff" />
                    </Pressable>
                    {/* Index label */}
                    <View style={[styles.thumbIndex, { backgroundColor: colors.overlay }]}>
                      <Text style={styles.thumbIndexText}>{idx + 1}</Text>
                    </View>
                  </Animated.View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.docEmptyHint}>
                <Ionicons name="camera-outline" size={18} color={colors.textTertiary} />
                <Text style={[styles.docEmptyText, { color: colors.textTertiary }]}>
                  Tap the camera button to capture insurance cards, Rx labels, or other documents while recording.
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </View>

      {/* ── Footer ── */}
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
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  liveText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.2,
  },
  docBadgeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 36,
  },
  timerSection: {
    alignItems: 'center',
    gap: 6,
  },
  timer: {
    fontSize: 56,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  stateLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  waveSection: {
    width: '100%',
    paddingHorizontal: 16,
  },
  controlsSection: {
    alignItems: 'center',
    gap: 20,
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
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  // Document strip
  docStrip: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  docStripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  docStripLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  docStripTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  docCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  docCountText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  docActions: {
    flexDirection: 'row',
    gap: 8,
  },
  docActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docActionBtnPrimary: {
    width: 40,
    height: 40,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  thumbnailScroll: {
    flexGrow: 0,
  },
  thumbnailContent: {
    gap: 10,
    paddingRight: 4,
  },
  thumbWrapper: {
    position: 'relative',
    width: 68,
    height: 68,
  },
  thumb: {
    width: 68,
    height: 68,
    borderRadius: 10,
    borderWidth: 1,
  },
  thumbScanBtn: {
    position: 'absolute',
    bottom: -5,
    left: -5,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    zIndex: 10,
  },
  thumbRemoveBtn: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  thumbIndex: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  thumbIndexText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  docEmptyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  docEmptyText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 17,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 8,
  },
  skipText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
});
