import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, radii, typography } from "../../../theme";

interface BPMDisplayProps {
  bpm?: number;
  energy?: number;
  drops?: number;
  musicKey?: string;
  camelot?: string;
}

export const BPMDisplay: React.FC<BPMDisplayProps> = React.memo(({ bpm, energy, drops, musicKey, camelot }) => {
  if (!bpm) return null;

  const items = [
    { val: String(Math.round(bpm)), lbl: "BPM" },
    { val: `${Math.round((energy ?? 0.5) * 100)}%`, lbl: "NRG" },
    { val: String(drops ?? 0), lbl: "DROPS" },
    ...(camelot ? [{ val: camelot, lbl: musicKey || "KEY" }] : []),
  ];

  return (
    <View style={styles.container}>
      {items.map((item) => (
        <View key={item.lbl} style={styles.badge}>
          <Text style={styles.val}>{item.val}</Text>
          <Text style={styles.lbl}>{item.lbl}</Text>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 10,
  },
  badge: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  val: {
    ...typography.body,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  lbl: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
