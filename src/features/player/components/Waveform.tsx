import React, { useEffect, useMemo } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { colors } from "../../../theme";

const { width: SCREEN_W } = Dimensions.get("window");
const BAR_COUNT = 48; // Plus de barres pour une waveform détaillée

interface WaveformProps {
  progress: number;        // 0–100
  isPlaying: boolean;
  bpm: number;
  energy: number;
  energyColor: string;
  rms?: number[];
  timestamps?: number[];
  duration?: number;
  transitionPointPct: number | null; // 0–100
}

export const Waveform: React.FC<WaveformProps> = React.memo(({
  progress,
  isPlaying,
  bpm,
  energy,
  energyColor,
  rms,
  timestamps,
  duration,
  transitionPointPct,
}) => {
  const progressPct = useSharedValue(progress);

  useEffect(() => {
    progressPct.value = withTiming(progress, { duration: 120 });
  }, [progress, progressPct]);

  const playheadStyle = useAnimatedStyle(() => ({
    left: `${progressPct.value}%`,
  }));
  const now = Date.now();

  const bars = useMemo(() => {
    // Si on a des données RMS réelles, les utiliser
    if (rms && rms.length > 0) {
      // Sous-échantillonner pour avoir BAR_COUNT barres
      const step = Math.max(1, Math.floor(rms.length / BAR_COUNT));
      return Array.from({ length: BAR_COUNT }).map((_, i) => {
        const idx = i * step;
        const val = rms[Math.min(idx, rms.length - 1)];
        // Normaliser : RMS est typiquement 0-0.5, on scale pour la hauteur
        const height = Math.max(3, Math.min(28, val * 80 + 3));
        return height;
      });
    }

    // Fallback : génération procédurale basée sur le BPM
    const beatPhase = (now / 1000) * (bpm / 60) * Math.PI * 2;
    const boost = isPlaying ? energy * 10 : 0;

    return Array.from({ length: BAR_COUNT }).map((_, i) => {
      const baseH = 6 + Math.sin(i * 0.7) * 6 + Math.cos(i * 1.3) * 4;
      const dynamic = isPlaying ? Math.sin(beatPhase + i * 0.5) * boost : 0;
      return Math.max(3, baseH + dynamic);
    });
  }, [rms, timestamps, duration, now, bpm, energy, isPlaying]);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {bars.map((h, i) => {
          const isPast = (i / BAR_COUNT) * 100 < progress;
          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: h,
                  backgroundColor: isPast ? energyColor : "#374151",
                  opacity: isPast ? 0.95 : 0.35,
                },
              ]}
            />
          );
        })}
      </View>

      {/* Playhead */}
      <Animated.View style={[styles.playhead, playheadStyle]} />

      {/* Transition marker */}
      {transitionPointPct !== null && (
        <View style={[styles.marker, { left: `${transitionPointPct}%` }]} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: "relative",
    height: 36,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: "100%",
    gap: 1.5,
  },
  bar: {
    flex: 1,
    borderRadius: 1.5,
    minWidth: 1.5,
  },
  playhead: {
    position: "absolute",
    top: -2,
    width: 2,
    height: "110%",
    backgroundColor: "#FFFFFF",
    shadowColor: "#FFFFFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 10,
  },
  marker: {
    position: "absolute",
    top: -2,
    width: 2,
    height: "110%",
    backgroundColor: colors.warning,
    opacity: 0.8,
    shadowColor: colors.warning,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    zIndex: 5,
  },
});
