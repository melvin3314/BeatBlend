import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, radii, spacing, typography } from "../../../theme";

interface LoopControlsProps {
  isLooping: boolean;
  loopBeats: number; // 4, 8, 16
  onSetLoop: (beats: number) => void;
  onClearLoop: () => void;
  activeDeckId: string;
}

export const LoopControls: React.FC<LoopControlsProps> = React.memo(({
  isLooping,
  loopBeats,
  onSetLoop,
  onClearLoop,
  activeDeckId,
}) => {
  const [selected, setSelected] = useState<number | null>(null);

  const handleLoop = (beats: number) => {
    setSelected(beats);
    onSetLoop(beats);
  };

  const handleClear = () => {
    setSelected(null);
    onClearLoop();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>LOOP</Text>
      <View style={styles.row}>
        {[4, 8, 16].map((beats) => {
          const isActive = isLooping && (selected === beats || loopBeats === beats);
          return (
            <TouchableOpacity
              key={beats}
              style={[
                styles.btn,
                isActive && styles.btnActive,
              ]}
              onPress={() => handleLoop(beats)}
              activeOpacity={0.7}
            >
              <Text style={[styles.text, isActive && styles.textActive]}>
                {beats}B
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.btn, styles.clearBtn, isLooping && styles.clearBtnActive]}
          onPress={handleClear}
          activeOpacity={0.7}
        >
          <Text style={[styles.text, styles.clearText]}>
            EXIT
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    letterSpacing: 2,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  btn: {
    width: 44,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  btnActive: {
    backgroundColor: "#8B5CF6",
    borderColor: "#A78BFA",
  },
  text: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 11,
  },
  textActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  clearBtn: {
    backgroundColor: colors.surfaceElevated,
    borderColor: "#EF4444",
    width: 48,
  },
  clearBtnActive: {
    backgroundColor: "#EF4444",
    borderColor: "#F87171",
  },
  clearText: {
    color: "#F87171",
    fontSize: 9,
    fontWeight: "700",
  },
});
