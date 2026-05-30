import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, radii, typography } from "../../../theme";

interface ModeTogglesProps {
  autoplay: boolean;
  repeat: boolean;
  shuffle: boolean;
  onToggleAutoplay: () => void;
  onToggleRepeat: () => void;
  onToggleShuffle: () => void;
}

export const ModeToggles: React.FC<ModeTogglesProps> = React.memo(({
  autoplay,
  repeat,
  shuffle,
  onToggleAutoplay,
  onToggleRepeat,
  onToggleShuffle,
}) => {
  const items = [
    { label: "AP", active: autoplay, color: colors.success, onPress: onToggleAutoplay },
    { label: "RP", active: repeat, color: colors.secondary, onPress: onToggleRepeat },
    { label: "SH", active: shuffle, color: colors.energyMid, onPress: onToggleShuffle },
  ];

  return (
    <View style={styles.container}>
      {items.map((item) => (
        <TouchableOpacity
          key={item.label}
          style={[
            styles.btn,
            item.active && { backgroundColor: item.color + "30", borderColor: item.color },
          ]}
          onPress={item.onPress}
          activeOpacity={0.7}
        >
          <Text style={[styles.text, item.active && { color: item.color }]}>
            {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
