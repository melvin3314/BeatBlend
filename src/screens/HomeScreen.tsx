import React, { useCallback, useRef, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { DJDebugOverlay } from "../components/DJDebugOverlay";
import { ModernPlayer } from "../features/player/ModernPlayer";
import { useAutoDJ } from "../hooks/useAutoDJ";
import { useMediaControls } from "../services/audio/mediaControlsService";
import { colors, radii, spacing, typography } from "../theme";

interface PlaylistTrack {
  name: string;
  uri: string;
}

interface PlaylistTrackAnalysis {
  bpm: number;
  energy: number;
  key?: string;
  camelot?: string;
}

const GAP = 6;
const ESTIMATED_ROW_HEIGHT = 64; // fallback

const PlaylistDetailView: React.FC<{
  tracks: PlaylistTrack[];
  currentIndex: number;
  getTrackAnalysis: (uri: string) => PlaylistTrackAnalysis | null;
  onSelectTrack: (index: number) => void;
  onReorderTracks: (fromIndex: number, toIndex: number) => void;
  isReordering: boolean;
}> = React.memo(({ tracks, currentIndex, getTrackAnalysis, onSelectTrack, onReorderTracks, isReordering }) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [itemHeight, setItemHeight] = useState(ESTIMATED_ROW_HEIGHT);
  const [dragY, setDragY] = useState(0);
  const targetIndexRef = useRef<number | null>(null);
  const startYRef = useRef(0);

  const itemTotalHeight = itemHeight + GAP;

  const getTargetIndex = useCallback((fromIdx: number, dy: number) => {
    const newY = fromIdx * itemTotalHeight + dy;
    let target = Math.round(newY / itemTotalHeight);
    target = Math.max(0, Math.min(target, tracks.length - 1));
    return target;
  }, [itemTotalHeight, tracks.length]);

  const onDragStart = useCallback((index: number, pageY: number) => {
    setDragIndex(index);
    targetIndexRef.current = index;
    startYRef.current = pageY;
    setDragY(0);
  }, []);

  const onDragMove = useCallback((index: number, pageY: number) => {
    const dy = pageY - startYRef.current;
    setDragY(dy);
    const t = getTargetIndex(index, dy);
    targetIndexRef.current = t;
  }, [getTargetIndex]);

  const onDragEnd = useCallback((index: number) => {
    const t = targetIndexRef.current ?? index;
    if (t !== index) {
      onReorderTracks(index, t);
    }
    setDragIndex(null);
    targetIndexRef.current = null;
    setDragY(0);
  }, [onReorderTracks]);

  if (tracks.length === 0) return null;

  return (
    <View style={plStyles.container}>
      <View style={plStyles.list}>
        {tracks.map((track, idx) => {
          const isCurrent = idx === currentIndex;
          const analysis = getTrackAnalysis(track.uri);
          const isAnalyzed = analysis !== null;
          const energyColor = analysis
            ? analysis.energy > 0.7 ? "#EF4444" : analysis.energy > 0.4 ? "#F59E0B" : "#3B82F6"
            : "#6B7280";
          const isDragging = dragIndex === idx;

          return (
            <View
              key={`${track.uri}-${idx}`}
              style={[plStyles.row, isCurrent && plStyles.rowActive, isDragging && { opacity: 0.25 }]}
              onLayout={(e) => idx === 0 && setItemHeight(e.nativeEvent.layout.height)}
              {...(isReordering ? {
                onStartShouldSetResponder: () => true,
                onStartShouldSetResponderCapture: () => true,
                onResponderGrant: (e: any) => onDragStart(idx, e.nativeEvent.pageY),
                onResponderMove: (e: any) => onDragMove(idx, e.nativeEvent.pageY),
                onResponderRelease: () => onDragEnd(idx),
                onResponderTerminate: () => onDragEnd(idx),
              } : {})}
            >
              {/* Drag handle */}
              <View style={plStyles.handle}>
                <Text style={plStyles.handleText}>⋮⋮</Text>
              </View>

              {isReordering ? (
                <View style={plStyles.rowContent}>
                  <View style={plStyles.infoCol}>
                    <Text style={[plStyles.name, isCurrent && plStyles.nameActive]} numberOfLines={1}>
                      {track.name}
                    </Text>
                  </View>
                  <View style={plStyles.reorderBtns}>
                    <TouchableOpacity style={plStyles.reorderBtn} onPress={() => onReorderTracks(idx, Math.max(0, idx - 1))} activeOpacity={0.6}>
                      <Text style={plStyles.reorderBtnText}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={plStyles.reorderBtn} onPress={() => onReorderTracks(idx, Math.min(tracks.length - 1, idx + 1))} activeOpacity={0.6}>
                      <Text style={plStyles.reorderBtnText}>↓</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={plStyles.rowContent}
                  onPress={() => onSelectTrack(idx)}
                  activeOpacity={0.7}
                >
                  <View style={plStyles.numberCol}>
                    <Text style={[plStyles.number, isCurrent && plStyles.numberActive]}>
                      {isCurrent ? "▶" : String(idx + 1).padStart(2, "0")}
                    </Text>
                  </View>

                  <View style={plStyles.infoCol}>
                    <Text style={[plStyles.name, isCurrent && plStyles.nameActive]} numberOfLines={1}>
                      {track.name}
                    </Text>
                    {isAnalyzed && analysis ? (
                      <View style={plStyles.metaRow}>
                        <Text style={plStyles.meta}>{Math.round(analysis.bpm)} BPM</Text>
                        {analysis.camelot && (
                          <View style={plStyles.camelotBadge}>
                            <Text style={plStyles.camelotText}>{analysis.camelot}</Text>
                          </View>
                        )}
                        <View style={[plStyles.energyDot, { backgroundColor: energyColor }]} />
                      </View>
                    ) : (
                      <Text style={plStyles.notAnalyzed}>Non analysé</Text>
                    )}
                  </View>

                  {isAnalyzed && analysis && (
                    <View style={plStyles.energyCol}>
                      <View style={plStyles.energyTrack}>
                        <View style={[plStyles.energyFill, { width: `${analysis.energy * 100}%`, backgroundColor: energyColor }]} />
                      </View>
                    </View>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* Ghost row */}
        {dragIndex !== null && (
          <View
            style={[
              plStyles.ghostRow,
              {
                transform: [{ translateY: dragY }],
                top: dragIndex * itemTotalHeight,
                height: itemHeight,
              },
            ]}
            pointerEvents="none"
          >
            <View style={plStyles.handleGhost}>
              <Text style={plStyles.handleText}>⋮⋮</Text>
            </View>
            <View style={plStyles.numberCol}>
              <Text style={plStyles.number}>
                {String((targetIndexRef.current ?? dragIndex) + 1).padStart(2, "0")}
              </Text>
            </View>
            <View style={plStyles.infoCol}>
              <Text style={plStyles.name} numberOfLines={1}>
                {tracks[dragIndex]?.name}
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
});

function getAnalysisProgress(msg: string): number {
  if (msg.includes("✓")) return 100;
  if (msg.includes("...")) return 15;
  const match = msg.match(/(\d+)\/(\d+)/);
  if (match) {
    return (parseInt(match[1]) / parseInt(match[2])) * 100;
  }
  return msg.includes("erreur") ? 0 : 50;
}

interface HomeScreenProps {
  onOpenMixScreen?: (tracks: { uri: string; name: string }[]) => void;
  onOpenMultiMixScreen?: (tracks: { uri: string; name: string }[]) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onOpenMixScreen, onOpenMultiMixScreen }) => {
  const dj = useAutoDJ();
  const [showDebug, setShowDebug] = useState(false);
  const [isReordering, setIsReordering] = useState(false);

  // Dynamic background color based on energy
  const bgColor = dj.currentAnalysis
    ? dj.currentAnalysis.energy > 0.75
      ? "#1a0a0a" // High energy: dark red tint
      : dj.currentAnalysis.energy > 0.45
        ? "#0f0a1a" // Mid energy: dark purple tint
        : "#0a121a" // Low energy: dark blue tint
    : colors.bg;

  // Native media controls (lock screen, notification)
  useMediaControls(
    dj.currentTrack?.name ?? null,
    dj.isPlaying,
    dj.currentPosition,
    dj.currentDuration,
    {
      onPlay: dj.play,
      onPause: dj.pause,
      onNext: dj.skipToNext,
      onPrevious: dj.skipToPrevious,
      onSeek: dj.seekTo,
    }
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bgColor }]}>
      <ScrollView contentContainerStyle={styles.container} scrollEnabled={!isReordering}>
        <Text style={styles.title}>BeatBlend</Text>
        <Text style={styles.subtitle}>Auto-DJ intelligent</Text>

        {/* Import section */}
        <View style={styles.importCard}>
          <View style={styles.importHeader}>
            <View>
              <Text style={styles.importTitle}>Playlist</Text>
              <Text style={styles.importCount}>{dj.tracks.length} morceaux</Text>
            </View>
            <TouchableOpacity
              style={styles.importMainBtn}
              onPress={dj.importTracks}
              activeOpacity={0.8}
            >
              <Text style={styles.importMainText}>+ Importer</Text>
            </TouchableOpacity>
          </View>

          {/* Analysis Progress */}
          {dj.analysisMessage && (
            <View style={styles.analyzeProgress}>
              <View style={styles.analyzeHeader}>
                <Text style={styles.analyzeLabel}>ANALYSE</Text>
                <Text style={styles.analyzeStatus}>{dj.analysisMessage}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${getAnalysisProgress(dj.analysisMessage)}%` }]} />
              </View>
            </View>
          )}

          {dj.statusMessage && (
            <View style={styles.statusRow}>
              <View style={styles.statusBadge}>
                <View style={[styles.statusDot, { backgroundColor: dj.isPlaying ? "#10B981" : "#6B7280" }]} />
                <Text style={styles.statusText}>{dj.statusMessage}</Text>
              </View>
            </View>
          )}

          {dj.tracks.length >= 2 && (
            <View style={styles.actionGrid}>
              <TouchableOpacity style={styles.actionBtn} onPress={dj.analyzeCurrentAndNext} activeOpacity={0.7}>
                <Text style={styles.actionIcon}>🔍</Text>
                <Text style={styles.actionLabel}>Analyser</Text>
                <Text style={styles.actionSublabel}>courant + suivant</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} onPress={dj.analyzeAllTracks} activeOpacity={0.7}>
                <Text style={styles.actionIcon}>⚡</Text>
                <Text style={styles.actionLabel}>Tout analyser</Text>
                <Text style={styles.actionSublabel}>playlist complète</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnAccent]} onPress={dj.smartOrderPlaylist} activeOpacity={0.7}>
                <Text style={styles.actionIcon}>🎲</Text>
                <Text style={[styles.actionLabel, styles.actionLabelAccent]}>Smart Order</Text>
                <Text style={styles.actionSublabel}>Camelot + énergie</Text>
              </TouchableOpacity>

              {onOpenMixScreen && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: "rgba(139,92,246,0.12)", borderColor: "rgba(139,92,246,0.25)" }]}
                  onPress={() => onOpenMixScreen(dj.tracks)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.actionIcon}>🎛️</Text>
                  <Text style={[styles.actionLabel, { color: "#A78BFA" }]}>AI Mix</Text>
                  <Text style={styles.actionSublabel}>2 tracks</Text>
                </TouchableOpacity>
              )}

              {onOpenMultiMixScreen && dj.tracks.length >= 2 && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: "rgba(59,130,246,0.12)", borderColor: "rgba(59,130,246,0.25)" }]}
                  onPress={() => onOpenMultiMixScreen(dj.tracks)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.actionIcon}>🎧</Text>
                  <Text style={[styles.actionLabel, { color: "#60A5FA" }]}>AI DJ Set</Text>
                  <Text style={styles.actionSublabel}>{dj.tracks.length} tracks</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Playlist header + toggle */}
        {dj.tracks.length > 0 && (
          <View style={styles.playlistHeader}>
            <Text style={styles.playlistHeaderText}>PLAYLIST</Text>
            <TouchableOpacity onPress={() => setIsReordering(p => !p)} activeOpacity={0.7}>
              <Text style={styles.reorderToggle}>{isReordering ? "✓ Terminer" : "☰ Réordonner"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Playlist Detail */}
        {dj.tracks.length > 0 && (
          <PlaylistDetailView
            tracks={dj.tracks}
            currentIndex={dj.currentIndex}
            getTrackAnalysis={dj.getTrackAnalysis}
            onSelectTrack={dj.jumpToTrack}
            onReorderTracks={dj.reorderTracks}
            isReordering={isReordering}
          />
        )}

        {/* Start playback */}
        {dj.tracks.length >= 2 && !dj.isPlaying && (
          <View style={styles.startCard}>
            <Text style={styles.startIcon}>🎧</Text>
            <Text style={styles.startTitle}>Prêt à mixer</Text>
            <Text style={styles.startSubtitle}>
              {dj.tracks.length} morceaux analysés
              {dj.currentTrack ? ` — ${dj.currentTrack.name}` : ""}
            </Text>
            <TouchableOpacity style={styles.startBtn} onPress={dj.startPlayback} activeOpacity={0.85}>
              <Text style={styles.startBtnText}>▶  Lancer la lecture</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Player (always visible when tracks loaded) */}
        {dj.tracks.length > 0 && (
          <ModernPlayer
            currentTrack={dj.currentTrack}
            nextTrack={dj.nextTrack}
            previousTrack={dj.previousTrack}
            currentAnalysis={dj.currentAnalysis}
            nextAnalysis={dj.nextAnalysis}
            isPlaying={dj.isPlaying}
            currentPosition={dj.currentPosition}
            duration={dj.currentDuration}
            currentIndex={dj.currentIndex}
            totalTracks={dj.tracks.length}
            autoplay={dj.autoplay}
            repeat={dj.repeat}
            shuffle={dj.shuffle}
            transitionState={dj.transitionState}
            isTransitioning={dj.isTransitioning}
            transitionPoint={dj.transitionPoint}
            selectedPreset={dj.selectedPreset}
            compatibilityScores={dj.compatibilityScores}
            isLooping={dj.isLooping}
            loopBeats={dj.loopBeats}
            onSetLoop={dj.setLoop}
            onClearLoop={dj.clearLoop}
            onPlayPause={dj.togglePlayPause}
            onSeek={dj.seekTo}
            onSeekForward={dj.seekForward}
            onSeekBackward={dj.seekBackward}
            onNext={dj.skipToNext}
            onPrevious={dj.skipToPrevious}
            onToggleAutoplay={dj.toggleAutoplay}
            onToggleRepeat={dj.toggleRepeat}
            onToggleShuffle={dj.toggleShuffle}
            onStartTransition={dj.startTransition}
          />
        )}

        {/* Debug overlay */}
        {dj.isPlaying && (
          <DJDebugOverlay
            currentAnalysis={dj.currentAnalysis}
            nextAnalysis={dj.nextAnalysis}
            currentPosition={dj.currentPosition}
            transitionPoint={dj.transitionPoint}
            isTransitioning={dj.isTransitioning}
            visible={showDebug}
          />
        )}

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  title: {
    ...typography.headline,
    color: colors.textPrimary,
    letterSpacing: -0.5,
    textShadowColor: "rgba(59,130,246,0.3)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  cardText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  infoText: {
    ...typography.body,
    color: colors.accent,
    marginTop: spacing.xs,
  },
  stopSection: {
    marginTop: spacing.sm,
  },
  ctrlRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  debugBtn: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  debugBtnActive: {
    borderColor: colors.success,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  debugTxt: {
    ...typography.label,
    color: colors.textSecondary,
  },
  importCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: radii.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  importHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  importTitle: {
    ...typography.title,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  importCount: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 2,
  },
  importMainBtn: {
    backgroundColor: "#3B82F6",
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  importMainText: {
    ...typography.label,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  statusRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: "wrap",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actionGrid: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
  },
  actionBtnAccent: {
    backgroundColor: "rgba(139,92,246,0.08)",
    borderColor: "rgba(139,92,246,0.2)",
  },
  actionIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  actionLabel: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: "600",
    fontSize: 11,
  },
  actionLabelAccent: {
    color: "#A78BFA",
  },
  actionSublabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 2,
  },
  analyzeProgress: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  analyzeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  analyzeLabel: {
    ...typography.caption,
    color: "#F59E0B",
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  analyzeStatus: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 10,
  },
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#F59E0B",
    borderRadius: 2,
  },
  startCard: {
    backgroundColor: "rgba(139,92,246,0.06)",
    borderRadius: radii.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.15)",
    alignItems: "center",
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  startIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  startTitle: {
    ...typography.title,
    color: colors.textPrimary,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  startSubtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  startBtn: {
    backgroundColor: "#8B5CF6",
    borderRadius: radii.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  startBtnText: {
    ...typography.label,
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  playlistHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  playlistHeaderText: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.5,
  },
  reorderToggle: {
    ...typography.caption,
    color: "#3B82F6",
    fontWeight: "600",
    fontSize: 12,
  },
});

const plStyles = StyleSheet.create({
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
  list: {
    gap: 6,
    position: "relative",
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
  handle: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
    paddingVertical: 12,
  },
  handleText: {
    fontSize: 14,
    color: colors.textMuted,
    letterSpacing: 2,
    lineHeight: 18,
    fontWeight: "700",
  },
  rowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  ghostRow: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(59,130,246,0.15)",
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.3)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 100,
  },
  handleGhost: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },
  reorderBtns: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: spacing.sm,
  },
  reorderBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  reorderBtnText: {
    fontSize: 16,
    color: colors.textSecondary,
    fontWeight: "700",
  },
});
