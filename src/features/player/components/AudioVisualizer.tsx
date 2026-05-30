import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { colors } from "../../../theme";

const BAR_COUNT = 20;

interface AudioVisualizerProps {
  isPlaying: boolean;
  bpm: number;
  energy: number;
  color: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = React.memo(({
  isPlaying,
  bpm,
  energy,
  color,
}) => {
  const now = Date.now();

  const bars = useMemo(() => {
    const beatPhase = (now / 1000) * (bpm / 60) * Math.PI * 2;
    const boost = isPlaying ? energy * 14 : 2;

    return Array.from({ length: BAR_COUNT }).map((_, i) => {
      const base = 4 + Math.sin(i * 0.8) * 4;
      const wave = isPlaying ? Math.sin(beatPhase + i * 0.4) * boost : 0;
      return Math.max(2, Math.min(28, base + wave));
    });
  }, [now, bpm, energy, isPlaying]);

  return (
    <View style={styles.container}>
      {bars.map((h, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: h,
              backgroundColor: color,
              opacity: isPlaying ? 0.7 + (i / BAR_COUNT) * 0.3 : 0.2,
            },
          ]}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 32,
    gap: 2,
    paddingHorizontal: 2,
  },
  bar: {
    flex: 1,
    borderRadius: 2,
    minWidth: 2,
  },
});
