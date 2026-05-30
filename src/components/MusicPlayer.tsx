import { StyleSheet, Text, View } from "react-native";

interface MusicPlayerProps {
  currentPosition: number;
  duration: number | null;
  trackName: string | null;
}

export const MusicPlayer = ({
  currentPosition,
  duration,
  trackName,
}: MusicPlayerProps) => {
  const progress = duration && duration > 0 ? (currentPosition / duration) * 100 : 0;
  const progressClamped = Math.min(Math.max(progress, 0), 100);

  const formatTime = (seconds: number) => {
    if (!seconds || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.trackName}>{trackName || "Track en lecture"}</Text>
      <View style={styles.progressContainer}>
        <Text style={styles.timeText}>
          {formatTime(currentPosition)}
        </Text>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${progressClamped}%` },
            ]}
          />
        </View>
        <Text style={styles.timeText}>
          {formatTime(duration || 0)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1F2937",
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
  },
  trackName: {
    color: "#F9FAFB",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  timeText: {
    color: "#D1D5DB",
    fontSize: 14,
    minWidth: 45,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: "#374151",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#3B82F6",
    borderRadius: 3,
  },
});
