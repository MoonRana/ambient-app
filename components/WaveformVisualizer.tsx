import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  withSequence,
  Easing,
} from 'react-native-reanimated';

interface WaveformVisualizerProps {
  isActive: boolean;
  color: string;
  barCount?: number;
  height?: number;
}

function WaveBar({ index, isActive, color, maxHeight }: {
  index: number;
  isActive: boolean;
  color: string;
  maxHeight: number;
}) {
  const scale = useSharedValue(0.3);

  useEffect(() => {
    if (isActive) {
      const delay = index * 80;
      const duration = 400 + (index % 3) * 150;
      scale.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(0.3 + Math.random() * 0.7, { duration, easing: Easing.inOut(Easing.ease) }),
            withTiming(0.15 + Math.random() * 0.3, { duration: duration * 0.8, easing: Easing.inOut(Easing.ease) }),
          ),
          -1,
          true
        )
      );
    } else {
      scale.value = withTiming(0.15, { duration: 300 });
    }
  }, [isActive]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: maxHeight * scale.value,
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        { backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
}

export default function WaveformVisualizer({
  isActive,
  color,
  barCount = 24,
  height = 80,
}: WaveformVisualizerProps) {
  const bars = Array.from({ length: barCount }, (_, i) => i);

  return (
    <View style={[styles.container, { height }]}>
      {bars.map(i => (
        <WaveBar
          key={i}
          index={i}
          isActive={isActive}
          color={color}
          maxHeight={height}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    width: '100%',
  },
  bar: {
    width: 4,
    borderRadius: 2,
    minHeight: 4,
  },
});
