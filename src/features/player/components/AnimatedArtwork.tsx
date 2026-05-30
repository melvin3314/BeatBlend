import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { colors, radii } from "../../../theme";

interface AnimatedArtworkProps {
  name: string | null;
  color: string;
  isPlaying?: boolean;
  isTransitioning?: boolean;
}

export const AnimatedArtwork: React.FC<AnimatedArtworkProps> = React.memo(({
  name,
  color,
  isPlaying = false,
  isTransitioning = false,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  // Beat pulse synced to BPM
  useEffect(() => {
    if (!isPlaying || isTransitioning) {
      pulseAnim.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [isPlaying, isTransitioning]);

  // Subtle floating
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: 1, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const floatY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -4],
  });

  const initial = name ? name.charAt(0).toUpperCase() : "?";

  return (
    <View style={styles.wrapper}>
      {/* Ambient glow shadow */}
      <View style={[styles.glowRing, { shadowColor: color }]} />

      <Animated.View
        style={[
          styles.art,
          {
            borderColor: color,
            transform: [{ scale: pulseAnim }, { translateY: floatY }],
          },
        ]}
      >
        <Text style={[styles.initial, { color }]}>{initial}</Text>
        <View style={[styles.bar, { backgroundColor: color }]} />
      </Animated.View>
    </View>
  );
});

const SIZE = 72;

const styles = StyleSheet.create({
  wrapper: {
    width: SIZE,
    height: SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  glowRing: {
    position: "absolute",
    width: SIZE + 20,
    height: SIZE + 20,
    borderRadius: (SIZE + 20) / 2,
    backgroundColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  art: {
    width: SIZE,
    height: SIZE,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  initial: {
    fontSize: 30,
    fontWeight: "800",
  },
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
  },
});
