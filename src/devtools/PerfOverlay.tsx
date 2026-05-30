import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";

const PerfOverlay: React.FC = () => {
  const [fps, setFps] = useState(0);
  const [jsFps, setJsFps] = useState(0);
  const rafHandle = useRef<number | null>(null);
  const lastTick = useRef<number>(Date.now());
  const frameCount = useRef(0);

  // requestAnimationFrame loop to estimate UI thread FPS
  useEffect(() => {
    const loop = () => {
      frameCount.current += 1;
      const now = Date.now();
      const elapsed = now - lastTick.current;
      if (elapsed >= 500) {
        const currentFps = (frameCount.current * 1000) / elapsed;
        setFps(Math.round(currentFps));
        frameCount.current = 0;
        lastTick.current = now;
      }
      rafHandle.current = requestAnimationFrame(loop);
    };
    rafHandle.current = requestAnimationFrame(loop);
    return () => {
      if (rafHandle.current != null) cancelAnimationFrame(rafHandle.current);
    };
  }, []);

  // JS event loop heartbeat (setInterval) to approximate JS responsiveness
  useEffect(() => {
    let ticks = 0;
    let start = Date.now();
    const interval = setInterval(() => {
      ticks += 1;
      const now = Date.now();
      const elapsed = now - start;
      if (elapsed >= 1000) {
        setJsFps(ticks);
        ticks = 0;
        start = now;
      }
    }, 0);
    return () => clearInterval(interval);
  }, []);

  return (
    <View pointerEvents="none" style={styles.container}>
      <Text style={styles.text}>FPS: {fps} | JS: {jsFps}</Text>
    </View>
  );
};

export default PerfOverlay;

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 36,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    zIndex: 9999,
  },
  text: {
    color: "#0f0",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
});
