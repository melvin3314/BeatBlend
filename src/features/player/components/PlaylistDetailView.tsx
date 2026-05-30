import React, { useCallback } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, radii, spacing, typography } from "../../../theme";

interface Track {
  name: string;
  uri: string;
}

interface TrackAnalysis {
  bpm: number;
  energy: number;
  key?: string;
  camelot?: string;
}

interface PlaylistDetailViewProps {
  tracks: Track[];
  currentIndex: number;
  getTrackAnalysis: (uri: string) => TrackAnalysis | null;
  onSelectTrack: (index: number) => void;
}

export const PlaylistDetailView: React.FC<PlaylistDetailViewProps> = React.memo(({
  tracks,
  currentIndex,
  getTrackAnalysis,
  onSelectTrack,
}) => {
  if (tracks.length === 0) return null;

  const renderItem = useCallback(({ item, index }: { item: Track; index: number }) => {
    const isCurrent = index === currentIndex;
    const analysis = getTrackAnalysis(item.uri);
    const isAnalyzed = analysis !== null;
    const energyColor = analysis
      ? analysis.energy > 0.7 ? "#EF4444" : analysis.energy > 0.4 ? "#F59E0B" : "#3B82F6"
      : "#6B7280";

    return (
      <TouchableOpacity
        style={[styles.row, isCurrent && styles.rowActive]}
        onPress={() => onSelectTrack(index)}
        activeOpacity={0.7}
      >
        <View style={styles.numberCol}>
          <Text style={[styles.number, isCurrent && styles.numberActive]}>
            {isCurrent ? "▶" : String(index + 1).padStart(2, "0")}
          </Text>
        </View>

        <View style={styles.infoCol}>
          <Text style={[styles.name, isCurrent && styles.nameActive]} numberOfLines={1}>
            {item.name}
          </Text>
          {isAnalyzed && analysis ? (
            <View style={styles.metaRow}>
              <Text style={styles.meta}>{Math.round(analysis.bpm)} BPM</Text>
              {analysis.camelot && (
                <View style={styles.camelotBadge}>
                  <Text style={styles.camelotText}>{analysis.camelot}</Text>
                </View>
              )}
              <View style={[styles.energyDot, { backgroundColor: energyColor }]} />
            </View>
          ) : (
            <Text style={styles.notAnalyzed}>Non analysé</Text>
          )}
        </View>

        {isAnalyzed && analysis && (
          <View style={styles.energyCol}>
            <View style={styles.energyTrack}>
              <View style={[styles.energyFill, { width: `${analysis.energy * 100}%`, backgroundColor: energyColor }]} />
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  }, [currentIndex, getTrackAnalysis, onSelectTrack]);

  const keyExtractor = useCallback((item: Track, index: number) => `${item.uri}-${index}`, []);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>PLAYLIST</Text>
      <FlatList
        data={tracks}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={14}
        windowSize={7}
        maxToRenderPerBatch={14}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  header: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginLeft: 4,
    letterSpacing: 1.5,
  },
  scroll: {
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.04)",
  },
  rowActive: {
    backgroundColor: "rgba(59,130,246,0.08)",
    borderColor: "rgba(59,130,246,0.2)",
  },
  numberCol: {
    width: 28,
    alignItems: "center",
  },
  number: {
    ...typography.label,
    color: colors.textMuted,
    fontSize: 11,
  },
  numberActive: {
    color: "#3B82F6",
    fontSize: 10,
  },
  infoCol: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  name: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: "500",
    fontSize: 13,
  },
  nameActive: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 3,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  camelotBadge: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  camelotText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "600",
  },
  energyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  notAnalyzed: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
    fontStyle: "italic",
  },
  energyCol: {
    width: 40,
    alignItems: "flex-end",
  },
  energyTrack: {
    width: 36,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 2,
    overflow: "hidden",
  },
  energyFill: {
    height: "100%",
    borderRadius: 2,
  },
});
