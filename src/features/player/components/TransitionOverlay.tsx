import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { PRESETS } from "../../../engine/TransitionPresets";
import { colors, typography } from "../../../theme";

interface TransitionOverlayProps {
  progress: number;
  presetName: string | null;
  isActive: boolean;
}

export const TransitionOverlay: React.FC<TransitionOverlayProps> = React.memo(({
  progress,
  presetName,
  isActive,
}) => {
  if (!isActive) return null;

  const pct = Math.round(progress * 100);
  const preset = presetName ? PRESETS[presetName as keyof typeof PRESETS] : null;
  const label = preset?.label ?? presetName?.toUpperCase().replace(/_/g, " ") ?? "TRANSITION";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>TRANSITION</Text>
        <Text style={styles.presetName}>{label}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.percent}>{pct}%</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
  },
  presetName: {
    ...typography.label,
    color: colors.accent,
    fontWeight: "700",
  },
  track: {
    height: 4,
    backgroundColor: colors.surface,
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 4,
  },
  fill: {
    height: "100%",
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  percent: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
  },
});
