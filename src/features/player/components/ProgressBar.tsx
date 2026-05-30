import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { colors, typography } from "../../../theme";

interface ProgressBarProps {
  position: number;
  duration: number;
  color: string;
  onSeek: (seconds: number) => void;
}

function fmtTime(s: number) {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export const ProgressBar: React.FC<ProgressBarProps> = React.memo(({ position, duration, color, onSeek }) => {
  const [trackWidth, setTrackWidth] = useState(0);

  // Reanimated shared value for normalized progress [0,1]
  const progress = useSharedValue(duration > 0 ? position / duration : 0);

  useEffect(() => {
    const target = duration > 0 ? position / duration : 0;
    progress.value = withTiming(target, { duration: 120 });
  }, [position, duration, progress]);

  const fillStyle = useAnimatedStyle(() => {
    return {
      width: progress.value * trackWidth,
    };
  }, [trackWidth]);

  const thumbStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: progress.value * trackWidth - 7 }],
    };
  }, [trackWidth]);

  const doSeek = useCallback(
    (x: number) => {
      const ratio = Math.max(0, Math.min(1, trackWidth > 0 ? x / trackWidth : 0));
      progress.value = ratio;
      if (duration > 0) onSeek(ratio * duration);
    },
    [trackWidth, duration, onSeek, progress]
  );

  return (
    <View style={styles.row}>
      <Text style={styles.time}>{fmtTime(position)}</Text>
      <View
        style={styles.trackWrap}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(evt) => doSeek(evt.nativeEvent.locationX)}
        onResponderMove={(evt) => doSeek(evt.nativeEvent.locationX)}
      >
        <View style={styles.track} pointerEvents="none">
          <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} pointerEvents="none" />
          <Animated.View
            style={[
              styles.thumb,
              { backgroundColor: color, width: 14, height: 14, borderRadius: 7, top: -5 },
              thumbStyle,
            ]}
            pointerEvents="none"
          />
        </View>
      </View>
      <Text style={styles.time}>{fmtTime(duration)}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  time: {
    ...typography.label,
    color: colors.textMuted,
    width: 40,
    textAlign: "center",
  },
  trackWrap: {
    flex: 1,
    height: 56,
    justifyContent: "center",
    paddingVertical: 20,
    overflow: "visible",
    // Hit area large for easy touch
  },
  track: {
    height: 4,
    backgroundColor: colors.surface,
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },
});
