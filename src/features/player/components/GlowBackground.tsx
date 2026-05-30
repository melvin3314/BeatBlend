import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { colors } from "../../../theme";

interface GlowBackgroundProps {
  energyColor: string;
  isPlaying: boolean;
}

export const GlowBackground: React.FC<GlowBackgroundProps> = React.memo(({
  energyColor,
  isPlaying,
}) => {
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 3000, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 3000, useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const opacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 0.22],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          styles.orbTop,
          { backgroundColor: energyColor, opacity },
        ]}
      />
      <Animated.View
        style={[
          styles.orbBottom,
          { backgroundColor: colors.secondary, opacity: Animated.multiply(opacity, 0.6) },
        ]}
      />
      <View style={[styles.vignette, { backgroundColor: colors.bg }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  orbTop: {
    position: "absolute",
    top: -100,
    right: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
  },
  orbBottom: {
    position: "absolute",
    bottom: -120,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  vignette: {
    ...StyleSheet.absoluteFill,
    opacity: 0.85,
  },
});
