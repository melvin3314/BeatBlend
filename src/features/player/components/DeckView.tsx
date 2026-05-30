import React from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "../../../theme";
import { AnimatedArtwork } from "./AnimatedArtwork";
import { BPMDisplay } from "./BPMDisplay";

interface DeckViewProps {
  trackName: string | null;
  energyColor: string;
  bpm?: number;
  energy?: number;
  drops?: number;
  musicKey?: string;
  camelot?: string;
  isPlaying?: boolean;
  isTransitioning?: boolean;
  translateX?: Animated.Value;
  scale?: Animated.Value;
  opacity?: Animated.Value;
  label?: string;
  size?: "normal" | "large";
}

export const DeckView: React.FC<DeckViewProps> = React.memo(({
  trackName,
  energyColor,
  bpm,
  energy,
  drops,
  musicKey,
  camelot,
  isPlaying = false,
  isTransitioning = false,
  translateX,
  scale,
  opacity,
  label,
  size = "normal",
}) => {
  const animatedStyle: any = {};
  if (translateX) animatedStyle.transform = [{ translateX }];
  if (scale) animatedStyle.transform = [...(animatedStyle.transform || []), { scale }];
  if (opacity !== undefined) animatedStyle.opacity = opacity;

  return (
    <Animated.View style={[styles.container, animatedStyle, size === "large" && styles.containerLarge]}>
      {label && (
        <View style={styles.labelBadge}>
          <Text style={styles.labelText}>{label}</Text>
        </View>
      )}
      <View style={styles.inner}>
        <AnimatedArtwork
          name={trackName}
          color={energyColor}
          isPlaying={isPlaying}
          isTransitioning={isTransitioning}
        />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {trackName || "Aucun morceau"}
          </Text>
          <BPMDisplay bpm={bpm} energy={energy} drops={drops} musicKey={musicKey} camelot={camelot} />
        </View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
    overflow: "hidden",
  },
  containerLarge: {
    padding: spacing.xl,
  },
  labelBadge: {
    position: "absolute",
    top: -10,
    left: spacing.lg,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    zIndex: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  labelText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "700",
    letterSpacing: 1,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
  },
  info: {
    flex: 1,
    marginLeft: spacing.lg,
  },
  name: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    fontWeight: "700",
  },
});
