import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
} from 'react-native-reanimated';

interface RecordButtonProps {
  isRecording: boolean;
  isPaused: boolean;
  onPress: () => void;
  size?: number;
}

export default function RecordButton({
  isRecording,
  isPaused,
  onPress,
  size = 80,
}: RecordButtonProps) {
  const pulse = useSharedValue(1);
  const innerScale = useSharedValue(1);

  useEffect(() => {
    if (isRecording && !isPaused) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.2, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
      innerScale.value = withTiming(0.35, { duration: 200 });
    } else if (isPaused) {
      pulse.value = withTiming(1, { duration: 300 });
      innerScale.value = withTiming(0.35, { duration: 200 });
    } else {
      pulse.value = withTiming(1, { duration: 300 });
      innerScale.value = withTiming(1, { duration: 200 });
    }
  }, [isRecording, isPaused]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: interpolate(pulse.value, [1, 1.2], [0.3, 0]),
  }));

  const innerStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(innerScale.value, [0.35, 1], [6, size / 2 - 8]),
    transform: [{ scale: innerScale.value }],
  }));

  const outerSize = size + 24;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.wrapper,
        { width: outerSize, height: outerSize },
        pressed && { opacity: 0.8 },
      ]}
    >
      {isRecording && !isPaused && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              width: outerSize,
              height: outerSize,
              borderRadius: outerSize / 2,
              borderColor: '#E53935',
            },
            pulseStyle,
          ]}
        />
      )}
      <View
        style={[
          styles.outerRing,
          {
            width: size + 8,
            height: size + 8,
            borderRadius: (size + 8) / 2,
            borderColor: isRecording ? '#E53935' : 'rgba(229, 57, 53, 0.4)',
          },
        ]}
      >
        <View
          style={[
            styles.innerContainer,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.inner,
              {
                width: size - 16,
                height: size - 16,
                backgroundColor: '#E53935',
              },
              innerStyle,
            ]}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 3,
  },
  outerRing: {
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {},
});
