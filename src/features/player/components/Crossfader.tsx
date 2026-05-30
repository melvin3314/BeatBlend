import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "../../../theme";

interface CrossfaderProps {
  progress: number; // 0–1
  presetName: string | null;
}

export const Crossfader: React.FC<CrossfaderProps> = React.memo(({ progress, presetName }) => {
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: progress,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const left = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["5%", "75%"],
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.labels}>
        <Text style={styles.lbl}>A</Text>
        <Text style={[styles.lbl, { color: colors.warning }]}>
          {presetName?.toUpperCase().replace(/_/g, " ") || "MIX"}
        </Text>
        <Text style={styles.lbl}>B</Text>
      </View>

      <View style={styles.track}>
        <Animated.View
          style={[
            styles.glowA,
            { opacity: animValue.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] }) },
          ]}
        />
        <Animated.View
          style={[
            styles.glowB,
            { opacity: animValue.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
          ]}
        />
        <Animated.View style={[styles.knob, { left }]} />
      </View>

      <Text style={styles.pct}>{Math.round(progress * 100)}%</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  lbl: {
    ...typography.caption,
    color: colors.textMuted,
  },
  track: {
    height: 8,
    backgroundColor: colors.surface,
    borderRadius: 4,
    position: "relative",
    overflow: "hidden",
  },
  glowA: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "55%",
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  glowB: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: "55%",
    backgroundColor: colors.secondary,
    borderRadius: 4,
  },
  knob: {
    position: "absolute",
    top: -6,
    width: 24,
    height: 20,
    borderRadius: 4,
    backgroundColor: colors.textPrimary,
    shadowColor: "#FFFFFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 6,
  },
  pct: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
