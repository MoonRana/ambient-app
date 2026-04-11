import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, Alert, ActivityIndicator,
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
  FadeIn, FadeInDown, FadeOut,
  useSharedValue, useAnimatedStyle, withRepeat,
  withTiming, withSequence, Easing, interpolate,
} from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions, CapturedImage } from '@/lib/session-context';
import WaveformVisualizer from '@/components/WaveformVisualizer';
import { useEffectiveColorScheme } from '@/lib/settings-context';
import { playRecordingStart, playRecordingStop } from '@/lib/recording-sounds';
import { analyzeInsuranceCard, copyToPersistentStorage } from '@/lib/supabase-api';
import { LinearGradient } from 'expo-linear-gradient';

type RecordingState = 'idle' | 'recording' | 'paused';

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export default function RecordScreen() {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { currentSession, updateSession } = useSessions();

  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [showDocStrip, setShowDocStrip] = useState(false);

  // Live dot
  const dotOpacity = useSharedValue(1);
  useEffect(() => {
    dotOpacity.value = withRepeat(
      withSequence(
        withTiming(0.2, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
      ), -1, false,
    );
  }, []);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  // Big stop btn scale pulse when recording
  const stopBtnScale = useSharedValue(1);
  useEffect(() => {
    if (recordingState === 'recording') {
      stopBtnScale.value = withRepeat(
        withSequence(
          withTiming(1.04, { duration: 900, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        ), -1, false,
      );
    } else {
      stopBtnScale.value = withTiming(1, { duration: 200 });
    }
  }, [recordingState]);
  const stopBtnStyle = useAnimatedStyle(() => ({ transform: [{ scale: stopBtnScale.value }] }));

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
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
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
      if (status !== 'granted') throw new Error('Microphone permission is required to record.');

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
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (err) { console.error('Failed to pause', err); }
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
    } catch (err) { console.error('Failed to resume', err); }
  };

  // ── KEY CHANGE: Stop → offer Process or Save for Later ──
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
          // Copy audio to persistent storage so it survives cache clears
          let persistentUri = uri;
          if (uri) {
            try {
              persistentUri = await copyToPersistentStorage(uri, currentSession.id);
            } catch (e) {
              console.warn('Failed to copy to persistent storage, using temp URI:', e);
            }
          }

          updateSession(currentSession.id, {
            recordingDuration: elapsed,
            recordingUri: persistentUri || undefined,
            status: 'captured',
            capturedImages,
          });
        }

        if (Platform.OS !== 'web') {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          await new Promise(r => setTimeout(r, 100));
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }

        playRecordingStop();

        // Offer choice: process now or save for later
        Alert.alert(
          'Recording Saved',
          `${formatTime(elapsed)} recorded${capturedImages.length > 0 ? ` with ${capturedImages.length} document${capturedImages.length !== 1 ? 's' : ''}` : ''}. What would you like to do?`,
          [
            {
              text: 'Generate Note Now',
              onPress: () => {
                if (capturedImages.length > 0) {
                  router.push('/(recording)/capture');
                } else {
                  router.push('/(recording)/review');
                }
              },
            },
            {
              text: 'Save & Continue Later',
              style: 'cancel',
              onPress: () => {
                router.dismissAll();
              },
            },
          ],
        );
      }
    } catch (err) { console.error('Failed to stop recording', err); }
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

  const captureDocument = async (useCamera: boolean) => {
    try {
      let result;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera Access', 'Camera permission is required.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: false });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Photo Access', 'Photo library permission is required.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          quality: 0.85, allowsMultipleSelection: true, selectionLimit: 5,
        });
      }
      if (!result.canceled && result.assets) {
        const newImages: CapturedImage[] = result.assets.map(asset => ({
          uri: asset.uri, id: generateId(), timestamp: Date.now(),
        }));
        setCapturedImages(prev => [...prev, ...newImages]);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) { console.error('Failed to capture document', err); }
  };

  const removeImage = (id: string) => {
    setCapturedImages(prev => prev.filter(img => img.id !== id));
  };

  const quickScanImage = async (img: CapturedImage) => {
    if (scanningId) return;
    setScanningId(img.id);
    try {
      const info = await analyzeInsuranceCard(img.uri);
      const extracted = [
        info.patient_name ? `Name: ${info.patient_name}` : null,
        info.date_of_birth ? `DOB: ${info.date_of_birth}` : null,
        info.payer_name ? `Insurance: ${info.payer_name}` : null,
        info.member_id ? `Member ID: ${info.member_id}` : null,
      ].filter(Boolean).join('\n');
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Document Scanned ✓', extracted || 'Captured — will be processed during review.');
    } catch {
      Alert.alert('Scan Note', 'Document saved — will be processed during review.');
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

  // Background gradient tint shifts when recording
  const bgTop = isDark
    ? (isLive ? '#1A0A0A' : '#0A1118')
    : (isLive ? '#FFF0F0' : '#F8F9FB');
  const bgBot = isDark ? '#0A1118' : '#F8F9FB';

  return (
    <View style={styles.container}>
      <LinearGradient colors={[bgTop, bgBot]} style={StyleSheet.absoluteFill} />

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
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>

        {/* Live pill */}
        <View style={[styles.livePill, {
          backgroundColor: isLive ? `${colors.recording}18` : colors.surfaceSecondary,
          borderColor: isLive ? `${colors.recording}50` : 'transparent',
        }]}>
          {isLive && (
            <Animated.View style={[styles.liveDot, { backgroundColor: colors.recording }, dotStyle]} />
          )}
          <Text style={[styles.liveText, {
            color: isLive ? colors.recording
              : recordingState === 'paused' ? colors.warning
                : colors.textSecondary,
          }]}>
            {isLive ? 'LIVE' : recordingState === 'paused' ? 'PAUSED' : 'READY'}
          </Text>
        </View>

        {/* Doc counter */}
        <Pressable
          onPress={() => isActive && setShowDocStrip(s => !s)}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="documents-outline" size={18} color={capturedImages.length > 0 ? colors.accent : colors.textSecondary} />
          {capturedImages.length > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.accent }]}>
              <Text style={styles.badgeText}>{capturedImages.length}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* ── Center: Timer + Waveform ── */}
      <View style={styles.center}>
        {/* Timer — massive */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.timerBlock}>
          <Text style={[styles.timer, { color: isLive ? colors.recording : colors.text }]}>
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
        <Animated.View entering={FadeInDown.duration(400).delay(80)} style={styles.waveContainer}>
          <WaveformVisualizer
            isActive={isLive}
            color={isLive ? colors.recording : colors.border}
            barCount={36}
            height={110}
          />
        </Animated.View>

        {/* Hint */}
        {!isActive && (
          <Animated.Text
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(200)}
            style={[styles.hint, { color: colors.textTertiary }]}
          >
            Tap the button below to begin
          </Animated.Text>
        )}
      </View>

      {/* ── Doc strip (collapsible) ── */}
      {isActive && showDocStrip && (
        <Animated.View
          entering={FadeInDown.duration(300)}
          style={[styles.docStrip, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.docStripHeader}>
            <View style={styles.docStripLeft}>
              <Ionicons name="documents" size={14} color={colors.accent} />
              <Text style={[styles.docStripTitle, { color: colors.text }]}>Documents</Text>
              <View style={[styles.docCountBadge, { backgroundColor: `${colors.accent}20` }]}>
                <Text style={[{ fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accent }]}>
                  {capturedImages.length}
                </Text>
              </View>
            </View>
            <View style={styles.docActions}>
              <Pressable
                onPress={() => captureDocument(false)}
                style={({ pressed }) => [styles.docBtn, { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 }]}
              >
                <Ionicons name="images-outline" size={16} color={colors.tint} />
              </Pressable>
              <Pressable
                onPress={() => captureDocument(true)}
                style={({ pressed }) => [styles.docBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
              >
                <Ionicons name="camera" size={16} color="#fff" />
              </Pressable>
            </View>
          </View>

          {capturedImages.length > 0 ? (
            <View style={styles.thumbRow}>
              {capturedImages.map((img, idx) => (
                <View key={img.id} style={styles.thumbWrap}>
                  <Image source={{ uri: img.uri }} style={[styles.thumb, { borderColor: colors.border }]} contentFit="cover" />
                  <Pressable
                    onPress={() => quickScanImage(img)}
                    disabled={!!scanningId}
                    style={[styles.thumbScan, { backgroundColor: scanningId === img.id ? colors.accent : colors.surface, borderColor: colors.border }]}
                  >
                    {scanningId === img.id
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="scan-outline" size={10} color={colors.accent} />
                    }
                  </Pressable>
                  <Pressable
                    onPress={() => removeImage(img.id)}
                    style={[styles.thumbRemove, { backgroundColor: colors.recording }]}
                  >
                    <Ionicons name="close" size={10} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.docHint, { color: colors.textTertiary }]}>
              Tap camera to capture insurance cards or documents while recording
            </Text>
          )}
        </Animated.View>
      )}

      {/* ── Bottom controls ── */}
      <View style={[styles.bottom, { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20) + 12 }]}>
        {isActive ? (
          <View style={styles.activeControls}>
            {/* Pause / Resume */}
            <Pressable
              onPress={isLive ? pauseRecording : resumeRecording}
              style={({ pressed }) => [
                styles.secondaryCircle,
                { backgroundColor: colors.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name={isLive ? 'pause' : 'play'} size={22} color={colors.text} />
            </Pressable>

            {/* BIG STOP */}
            <Animated.View style={stopBtnStyle}>
              <Pressable
                onPress={stopRecording}
                style={({ pressed }) => [
                  styles.bigStop,
                  {
                    backgroundColor: colors.recording,
                    shadowColor: colors.recording,
                    transform: [{ scale: pressed ? 0.93 : 1 }],
                  },
                ]}
              >
                <Ionicons name="stop" size={38} color="#fff" />
              </Pressable>
            </Animated.View>

            {/* Doc toggle */}
            <Pressable
              onPress={() => setShowDocStrip(s => !s)}
              style={({ pressed }) => [
                styles.secondaryCircle,
                {
                  backgroundColor: showDocStrip ? `${colors.accent}20` : colors.surfaceSecondary,
                  borderWidth: showDocStrip ? 1 : 0,
                  borderColor: colors.accent,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name={showDocStrip ? 'documents' : 'documents-outline'} size={20}
                color={showDocStrip ? colors.accent : colors.text} />
              {capturedImages.length > 0 && !showDocStrip && (
                <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                  <Text style={styles.badgeText}>{capturedImages.length}</Text>
                </View>
              )}
            </Pressable>
          </View>
        ) : (
          // Idle — big start mic
          <View style={styles.idleControls}>
            <Pressable
              onPress={startRecording}
              style={({ pressed }) => [
                styles.bigMicBtn,
                {
                  backgroundColor: colors.recording,
                  shadowColor: colors.recording,
                  transform: [{ scale: pressed ? 0.93 : 1 }],
                },
              ]}
            >
              <Ionicons name="mic" size={46} color="#fff" />
            </Pressable>
            <Text style={[styles.startHint, { color: colors.textSecondary }]}>
              Tap to start recording
            </Text>
          </View>
        )}

        {isActive && (
          <Text style={[styles.stopHint, { color: colors.textTertiary }]}>
            Stop & Process
          </Text>
        )}

        {recordingState === 'idle' && (
          <Pressable
            onPress={() => {
              if (currentSession) updateSession(currentSession.id, { status: 'captured' });
              router.push('/(recording)/capture');
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, marginTop: 8 }]}
          >
            <Text style={[styles.skipText, { color: colors.textTertiary }]}>
              Skip — capture documents only
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 8,
  },
  headerBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
  },
  liveDot: { width: 7, height: 7, borderRadius: 3.5 },
  liveText: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1.4 },
  badge: {
    position: 'absolute', top: -3, right: -3,
    width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },

  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, gap: 28,
  },
  timerBlock: { alignItems: 'center', gap: 6 },
  timer: {
    fontSize: 80, fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'], letterSpacing: -3,
  },
  stateLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase', letterSpacing: 1.8,
  },
  waveContainer: { width: '100%' },
  hint: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: -8 },

  // Doc strip
  docStrip: {
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 16, borderWidth: 1, padding: 14, gap: 12,
  },
  docStripHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  docStripLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docStripTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  docCountBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  docActions: { flexDirection: 'row', gap: 8 },
  docBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbRow: { flexDirection: 'row', gap: 10 },
  thumbWrap: { position: 'relative', width: 64, height: 64 },
  thumb: { width: 64, height: 64, borderRadius: 10, borderWidth: 1 },
  thumbScan: {
    position: 'absolute', bottom: -4, left: -4,
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, zIndex: 10,
  },
  thumbRemove: {
    position: 'absolute', top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  docHint: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },

  // Bottom
  bottom: {
    alignItems: 'center', paddingTop: 8, gap: 8, paddingHorizontal: 24,
  },
  idleControls: { alignItems: 'center', gap: 16 },
  bigMicBtn: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45, shadowRadius: 20, elevation: 14,
  },
  startHint: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  activeControls: {
    flexDirection: 'row', alignItems: 'center', gap: 28,
  },
  secondaryCircle: {
    width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
  },
  bigStop: {
    width: 92, height: 92, borderRadius: 46,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 12,
  },
  skipText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  stopHint: {
    fontSize: 12, fontFamily: 'Inter_500Medium',
    textTransform: 'uppercase', letterSpacing: 1,
    marginTop: -4,
  },
});
