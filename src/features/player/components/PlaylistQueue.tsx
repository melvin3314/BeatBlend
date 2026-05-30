import React, { useCallback } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, radii, typography } from "../../../theme";

interface Track {
  name: string;
  uri: string;
}

interface PlaylistQueueProps {
  tracks: Track[];
  currentIndex: number;
  onSelectTrack: (index: number) => void;
}

export const PlaylistQueue: React.FC<PlaylistQueueProps> = React.memo(({
  tracks,
  currentIndex,
  onSelectTrack,
}) => {
  if (tracks.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>QUEUE</Text>
      <FlatList
        horizontal
        data={tracks}
        keyExtractor={(item, index) => item.uri + "-" + index}
        renderItem={({ item, index }) => {
          const isCurrent = index === currentIndex;
          const isPast = index < currentIndex;
          return (
            <TouchableOpacity
              style={[
                styles.card,
                isCurrent && styles.cardActive,
                isPast && styles.cardPast,
              ]}
              onPress={() => onSelectTrack(index)}
              activeOpacity={0.7}
            >
              <Text style={[styles.initial, isCurrent && styles.initialActive]}>
                {item.name.charAt(0).toUpperCase()}
              </Text>
              <Text
                style={[styles.name, isCurrent && styles.nameActive]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {isCurrent && <View style={styles.indicator} />}
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.scroll}
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={8}
        windowSize={5}
        maxToRenderPerBatch={8}
        getItemLayout={useCallback((_: unknown, index: number) => ({ length: CARD_W + 10, offset: (CARD_W + 10) * index, index }), [])}
      />
    </View>
  );
});

const CARD_W = 80;

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  header: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: 10,
    marginLeft: 4,
  },
  scroll: {
    gap: 10,
    paddingHorizontal: 4,
  },
  card: {
    width: CARD_W,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardActive: {
    borderColor: colors.accent,
    backgroundColor: "rgba(59, 130, 246, 0.15)",
  },
  cardPast: {
    opacity: 0.4,
  },
  initial: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.textSecondary,
    marginBottom: 6,
  },
  initialActive: {
    color: colors.accent,
  },
  name: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: "center",
  },
  nameActive: {
    color: colors.textPrimary,
  },
  indicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 6,
  },
});
