import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, radii, spacing, typography } from "../../../theme";

interface TransportControlsProps {
  isPlaying: boolean;
  energyColor: string;
  bpm?: number;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
}

export const TransportControls: React.FC<TransportControlsProps> = React.memo(({
  isPlaying,
  energyColor,
  bpm,
  onPlayPause,
  onPrevious,
  onNext,
  onSeekForward,
  onSeekBackward,
}) => {
  // Beat pulse animation
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!isPlaying || !bpm || bpm <= 0) {
      pulseScale.setValue(1);
      pulseOpacity.setValue(0);
      return;
    }

    const beatDuration = (60 / bpm) * 1000; // ms per beat

    const pulse = () => {
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 1.25,
            duration: beatDuration * 0.15,
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: beatDuration * 0.85,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, {
            toValue: 0.35,
            duration: beatDuration * 0.15,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0,
            duration: beatDuration * 0.85,
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        if (isPlaying) pulse();
      });
    };

    pulse();
  }, [isPlaying, bpm]);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.seekBtn} onPress={onSeekBackward} activeOpacity={0.6}>
        <Text style={styles.seekText}>-10s</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.navBtn} onPress={onPrevious} activeOpacity={0.6}>
        <Text style={styles.navText}>⏮</Text>
      </TouchableOpacity>

      {/* Play/Pause — center stage with beat pulse ring */}
      <View style={styles.playWrap}>
        {/* Pulse ring */}
        {isPlaying && bpm && bpm > 0 && (
          <Animated.View
            style={[
              styles.pulseRing,
              {
                transform: [{ scale: pulseScale }],
                opacity: pulseOpacity,
                borderColor: energyColor,
              },
            ]}
          />
        )}
        {/* Static glow */}
        <View style={[styles.playGlow, { shadowColor: energyColor }]} />
        <TouchableOpacity
          style={[styles.playBtn, { backgroundColor: energyColor }]}
          onPress={onPlayPause}
          activeOpacity={0.85}
        >
          <Text style={styles.playText}>{isPlaying ? "⏸" : "▶"}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.navBtn} onPress={onNext} activeOpacity={0.6}>
        <Text style={styles.navText}>⏭</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.seekBtn} onPress={onSeekForward} activeOpacity={0.6}>
        <Text style={styles.seekText}>+10s</Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  seekBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backdropFilter: "blur(8px)",
  },
  seekText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  navBtn: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  navText: {
    fontSize: 20,
    color: colors.textPrimary,
  },
  playWrap: {
    width: 72,
    height: 72,
    justifyContent: "center",
    alignItems: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    backgroundColor: "transparent",
  },
  playGlow: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 12,
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: radii.full,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
  playText: {
    fontSize: 28,
    color: "#FFFFFF",
  },
});
