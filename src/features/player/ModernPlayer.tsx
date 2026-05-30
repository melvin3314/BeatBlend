import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { TransitionProgress } from "../../engine/TransitionEngine";
import { colors, radii, spacing, typography } from "../../theme";

import { AudioVisualizer } from "./components/AudioVisualizer";
import { Crossfader } from "./components/Crossfader";
import { DeckView } from "./components/DeckView";
import { GlowBackground } from "./components/GlowBackground";
import { ModeToggles } from "./components/ModeToggles";
import { PlaylistQueue } from "./components/PlaylistQueue";
import { ProgressBar } from "./components/ProgressBar";
import { TransitionOverlay } from "./components/TransitionOverlay";
import { TransportControls } from "./components/TransportControls";
import { Waveform } from "./components/Waveform";

interface TrackInfo {
  name: string;
  uri: string;
}

// Avoid re-rendering the whole player for tiny timeline drift
const areEqual = (prev: ModernPlayerProps, next: ModernPlayerProps) => {
  const posEqual = Math.abs(prev.currentPosition - next.currentPosition) < 0.25; // ~200ms
  return (
    posEqual &&
    prev.duration === next.duration &&
    prev.isPlaying === next.isPlaying &&
    prev.currentTrack === next.currentTrack &&
    prev.nextTrack === next.nextTrack &&
    prev.previousTrack === next.previousTrack &&
    prev.currentAnalysis === next.currentAnalysis &&
    prev.nextAnalysis === next.nextAnalysis &&
    prev.currentIndex === next.currentIndex &&
    prev.totalTracks === next.totalTracks &&
    prev.autoplay === next.autoplay &&
    prev.repeat === next.repeat &&
    prev.shuffle === next.shuffle &&
    prev.isTransitioning === next.isTransitioning &&
    prev.transitionPoint === next.transitionPoint &&
    prev.selectedPreset === next.selectedPreset &&
    prev.compatibilityScores === next.compatibilityScores &&
    prev.isLooping === next.isLooping &&
    prev.loopBeats === next.loopBeats &&
    prev.onSetLoop === next.onSetLoop &&
    prev.onClearLoop === next.onClearLoop &&
    prev.onPlayPause === next.onPlayPause &&
    prev.onSeek === next.onSeek &&
    prev.onSeekForward === next.onSeekForward &&
    prev.onSeekBackward === next.onSeekBackward &&
    prev.onNext === next.onNext &&
    prev.onPrevious === next.onPrevious &&
    prev.onToggleAutoplay === next.onToggleAutoplay &&
    prev.onToggleRepeat === next.onToggleRepeat &&
    prev.onToggleShuffle === next.onToggleShuffle &&
    prev.onStartTransition === next.onStartTransition
  );
};

interface AnalysisInfo {
  bpm: number;
  energy: number;
  sections: any[];
  drops: any[];
  key?: string;
  camelot?: string;
  rms?: number[];
  timestamps?: number[];
}

interface ModernPlayerProps {
  currentTrack: TrackInfo | null;
  nextTrack: TrackInfo | null;
  previousTrack: TrackInfo | null;
  currentAnalysis: AnalysisInfo | null;
  nextAnalysis: AnalysisInfo | null;
  isPlaying: boolean;
  currentPosition: number;
  duration: number;
  currentIndex: number;
  totalTracks: number;
  autoplay: boolean;
  repeat: boolean;
  shuffle: boolean;
  transitionState: TransitionProgress;
  isTransitioning: boolean;
  transitionPoint: number | null;
  selectedPreset: { name: string; label: string; confidence: number } | null;
  compatibilityScores: Record<string, number>;
  isLooping: boolean;
  loopBeats: number;
  onSetLoop: (beats: number) => void;
  onClearLoop: () => void;
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleAutoplay: () => void;
  onToggleRepeat: () => void;
  onToggleShuffle: () => void;
  onStartTransition: () => void;
}

const MixStatus: React.FC<{
  timeLeft: number;
  currentBpm: number;
  nextBpm: number;
  nextTrackName: string;
  progress: number;
}> = React.memo(({ timeLeft, currentBpm, nextBpm, nextTrackName, progress }) => {
  const beatsLeft = currentBpm > 0 ? Math.ceil((timeLeft / 60) * currentBpm) : 0;
  const barsLeft = Math.max(1, Math.ceil(beatsLeft / 4));

  let label = "TRANSITION EN PRÉPARATION";
  let message = `Analyse du prochain drop sur "${nextTrackName}"`;
  let sub = nextBpm > 0 ? `Cible : ${Math.round(nextBpm)} BPM` : "";
  let accentColor = "#8B5CF6";

  if (timeLeft <= 5) {
    label = "LANCEMENT TRANSITION";
    message = "Mix entrant maintenant";
    sub = `⚡ ${beatsLeft} beats`;
    accentColor = "#EF4444";
  } else if (timeLeft <= 15) {
    label = "MIX ENTRANT";
    message = `Dans ${barsLeft} mesure${barsLeft > 1 ? "s" : ""}`;
    sub = `Sync ${Math.round(currentBpm)} → ${Math.round(nextBpm)} BPM`;
    accentColor = "#F59E0B";
  } else if (timeLeft <= 45) {
    label = "BEATMATCH VÉRIFIÉ";
    message = `Alignement phase-locked`;
    sub = `Prochain : "${nextTrackName}"`;
    accentColor = "#3B82F6";
  } else if (timeLeft <= 90) {
    label = "ANALYSE DU DROP";
    message = `Point de sortie calibré`;
    sub = `${Math.round(timeLeft)}s · ${beatsLeft} beats restants`;
    accentColor = "#10B981";
  }

  return (
    <View style={{ width: "100%" }}>
      <View style={mixStyles.row}>
        <View style={[mixStyles.dot, { backgroundColor: accentColor }]} />
        <Text style={[mixStyles.label, { color: accentColor }]}>{label}</Text>
      </View>
      <Text style={mixStyles.message}>{message}</Text>
      {sub ? <Text style={mixStyles.sub}>{sub}</Text> : null}
      <View style={mixStyles.track}>
        <View style={[mixStyles.fill, { width: `${progress}%`, backgroundColor: accentColor }]} />
      </View>
    </View>
  );
});


const mixStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  label: {
    ...typography.caption,
    fontWeight: "700",
    fontSize: 9,
    letterSpacing: 1.2,
  },
  message: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: "600",
    fontSize: 13,
    marginBottom: 2,
  },
  sub: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 8,
  },
  track: {
    width: "100%",
    height: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
  },
});

const ModernPlayerInner: React.FC<ModernPlayerProps> = (props) => {
  const {
    currentTrack,
    nextTrack,
    currentAnalysis,
    nextAnalysis,
    isPlaying,
    currentPosition,
    duration,
    currentIndex,
    totalTracks,
    autoplay,
    repeat,
    shuffle,
    transitionState,
    isTransitioning,
    transitionPoint,
    selectedPreset,
    compatibilityScores,
    isLooping,
    loopBeats,
    onSetLoop,
    onClearLoop,
    onPlayPause,
    onSeek,
    onSeekForward,
    onSeekBackward,
    onNext,
    onPrevious,
    onToggleAutoplay,
    onToggleRepeat,
    onToggleShuffle,
    onStartTransition,
  } = props;

  // Dev-only render counter for profiling
  const renders = useRef(0);
  useEffect(() => {
    renders.current += 1;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[Perf] ModernPlayer renders: ${renders.current}`);
    }
  });

  // Transition animated values
  const deckA_slide = useRef(new Animated.Value(0)).current;
  const deckA_scale = useRef(new Animated.Value(1)).current;
  const deckA_opacity = useRef(new Animated.Value(1)).current;
  const deckB_slide = useRef(new Animated.Value(300)).current;
  const deckB_opacity = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const lastDropRef = useRef<number>(-1);

  useEffect(() => {
    if (isTransitioning) {
      Animated.parallel([
        Animated.timing(deckA_slide, { toValue: -220, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(deckA_scale, { toValue: 0.85, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(deckA_opacity, { toValue: 0, duration: 1000, useNativeDriver: true }),
        Animated.timing(deckB_slide, { toValue: 0, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(deckB_opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(deckA_slide, { toValue: 0, useNativeDriver: true, tension: 50, friction: 10 }),
        Animated.spring(deckA_scale, { toValue: 1, useNativeDriver: true, tension: 50, friction: 10 }),
        Animated.timing(deckA_opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(deckB_slide, { toValue: 300, duration: 400, useNativeDriver: true }),
        Animated.timing(deckB_opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [isTransitioning]);

  // Drop flash effect
  useEffect(() => {
    if (!currentAnalysis?.drops || !isPlaying) return;
    const drops = currentAnalysis.drops as Array<{ timestamp: number }>;
    if (drops.length === 0) return;

    // Find a drop that just happened (within 0.4s window)
    const drop = drops.find(d => {
      const diff = currentPosition - d.timestamp;
      return diff >= 0 && diff < 0.4;
    });

    if (drop && drop.timestamp !== lastDropRef.current) {
      lastDropRef.current = drop.timestamp;
      flashOpacity.setValue(0.35);
      Animated.timing(flashOpacity, {
        toValue: 0,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [currentPosition, currentAnalysis?.drops, isPlaying]);

  const energyColor = currentAnalysis
    ? currentAnalysis.energy > 0.7 ? colors.energyHigh : currentAnalysis.energy > 0.4 ? colors.energyMid : colors.energyLow
    : colors.energyLow;

  const nextColor = nextAnalysis
    ? nextAnalysis.energy > 0.7 ? colors.energyHigh : nextAnalysis.energy > 0.4 ? colors.energyMid : colors.energyLow
    : colors.secondary;

  return (
    <View style={styles.wrapper}>
      {/* Ambient glow background */}
      <GlowBackground energyColor={energyColor} isPlaying={isPlaying} />

      {/* Drop flash overlay */}
      <Animated.View style={[styles.flashOverlay, { opacity: flashOpacity }]} pointerEvents="none" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>NOW PLAYING</Text>
          <Text style={styles.headerIdx}>{currentIndex + 1} / {totalTracks}</Text>
        </View>
        <ModeToggles
          autoplay={autoplay}
          repeat={repeat}
          shuffle={shuffle}
          onToggleAutoplay={onToggleAutoplay}
          onToggleRepeat={onToggleRepeat}
          onToggleShuffle={onToggleShuffle}
        />
      </View>

      {/* Preset & Compatibility Info */}
      {selectedPreset && (
        <View style={styles.presetBox}>
          <View style={styles.presetHeader}>
            <Text style={styles.presetName}>{selectedPreset.label}</Text>
            <Text style={styles.presetConfidence}>{(selectedPreset.confidence * 100).toFixed(0)}% match</Text>
          </View>
          {Object.entries(compatibilityScores).length > 0 && (
            <View style={styles.scoresRow}>
              {Object.entries(compatibilityScores).map(([key, val]) => (
                <View key={key} style={styles.scoreChip}>
                  <Text style={styles.scoreLabel}>{key.toUpperCase().slice(0, 4)}</Text>
                  <View style={styles.scoreBarTrack}>
                    <View style={[styles.scoreBarFill, { width: `${Math.min(100, val * 100)}%`, backgroundColor: val > 0.7 ? "#10B981" : val > 0.4 ? "#F59E0B" : "#EF4444" }]} />
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Deck A (current) */}
      <Animated.View style={{ transform: [{ translateX: deckA_slide }, { scale: deckA_scale }], opacity: deckA_opacity }}>
        <DeckView
          trackName={currentTrack?.name ?? null}
          energyColor={energyColor}
          bpm={currentAnalysis?.bpm}
          energy={currentAnalysis?.energy}
          drops={currentAnalysis?.drops.length}
          musicKey={currentAnalysis?.key}
          camelot={currentAnalysis?.camelot}
          isPlaying={isPlaying}
          isTransitioning={isTransitioning}
          label="DECK A"
        />
      </Animated.View>

      {/* Deck B (incoming, only visible during transition) */}
      <Animated.View style={[styles.deckB, { transform: [{ translateX: deckB_slide }], opacity: deckB_opacity }]}>
        <DeckView
          trackName={nextTrack?.name ?? null}
          energyColor={nextColor}
          bpm={nextAnalysis?.bpm}
          energy={nextAnalysis?.energy}
          drops={nextAnalysis?.drops.length}
          musicKey={nextAnalysis?.key}
          camelot={nextAnalysis?.camelot}
          isPlaying={isPlaying}
          isTransitioning={isTransitioning}
          label="DECK B"
        />
      </Animated.View>

      {/* Waveform */}
      <Waveform
        progress={duration > 0 ? (currentPosition / duration) * 100 : 0}
        isPlaying={isPlaying}
        bpm={currentAnalysis?.bpm || 128}
        energy={currentAnalysis?.energy ?? 0.5}
        energyColor={energyColor}
        rms={currentAnalysis?.rms}
        timestamps={currentAnalysis?.timestamps}
        duration={duration}
        transitionPointPct={transitionPoint && duration > 0 ? (transitionPoint / duration) * 100 : null}
      />

      {/* Progress */}
      <ProgressBar
        position={currentPosition}
        duration={duration}
        color={energyColor}
        onSeek={onSeek}
      />

      {/* Loop Controls */}
      <LoopControls
        isLooping={isLooping}
        loopBeats={loopBeats}
        onSetLoop={onSetLoop}
        onClearLoop={onClearLoop}
        activeDeckId="deckA"
      />

      {/* Transport */}
      <TransportControls
        isPlaying={isPlaying}
        energyColor={energyColor}
        bpm={currentAnalysis?.bpm}
        onPlayPause={onPlayPause}
        onPrevious={onPrevious}
        onNext={onNext}
        onSeekForward={onSeekForward}
        onSeekBackward={onSeekBackward}
      />

      {/* Visualizer mini */}
      <AudioVisualizer
        isPlaying={isPlaying}
        bpm={currentAnalysis?.bpm || 128}
        energy={currentAnalysis?.energy ?? 0.5}
        color={energyColor}
      />

      {/* Crossfader (during transition) */}
      {isTransitioning && (
        <Crossfader progress={transitionState.progress} presetName={transitionState.presetName} />
      )}

      {/* Transition overlay */}
      <TransitionOverlay
        progress={transitionState.progress}
        presetName={transitionState.presetName}
        isActive={isTransitioning}
      />

      {/* Auto-mix indicator — DJ IA style */}
      {nextTrack && !isTransitioning && transitionPoint !== null && duration > 0 && (
        <View style={styles.mixBox}>
          <MixStatus
            timeLeft={Math.max(0, transitionPoint - currentPosition)}
            currentBpm={currentAnalysis?.bpm ?? 0}
            nextBpm={nextAnalysis?.bpm ?? 0}
            nextTrackName={nextTrack.name}
            progress={Math.min(100, (currentPosition / Math.max(1, transitionPoint)) * 100)}
          />
        </View>
      )}

      {/* Manual mix */}
      {nextTrack && !isTransitioning && transitionPoint === null && (
        <TouchableOpacity style={styles.mixBox} onPress={onStartTransition} activeOpacity={0.7}>
          <Text style={styles.mixText}>Mix vers suivant →</Text>
        </TouchableOpacity>
      )}

      {/* Queue */}
      <PlaylistQueue
        tracks={[currentTrack, nextTrack].filter(Boolean) as TrackInfo[]}
        currentIndex={0}
        onSelectTrack={() => {}}
      />
    </View>
  );
};

export const ModernPlayer = React.memo(ModernPlayerInner, areEqual);

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: radii.xl,
    margin: spacing.lg,
    padding: spacing.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 14,
  },
  flashOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFFFFF",
    zIndex: 100,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xl,
    zIndex: 2,
  },
  headerLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  headerIdx: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  deckB: {
    position: "absolute",
    top: 56,
    left: spacing.xl,
    right: spacing.xl,
    zIndex: 10,
  },
  mixBox: {
    backgroundColor: colors.glowBlue,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderActive,
    marginBottom: spacing.md,
    zIndex: 2,
  },
  mixText: {
    ...typography.body,
    color: colors.accent,
    marginBottom: 4,
  },
  mixTrack: {
    width: "100%",
    height: 3,
    backgroundColor: colors.surface,
    borderRadius: 2,
    overflow: "hidden",
  },
  mixFill: {
    height: "100%",
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  presetBox: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  presetName: {
    ...typography.label,
    color: colors.accent,
    fontWeight: "700",
  },
  presetConfidence: {
    ...typography.caption,
    color: colors.success,
    fontWeight: "700",
  },
  scoresRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  scoreChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  scoreLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: colors.textMuted,
    width: 28,
  },
  scoreBarTrack: {
    width: 40,
    height: 4,
    backgroundColor: colors.surface,
    borderRadius: 2,
    overflow: "hidden",
  },
  scoreBarFill: {
    height: "100%",
    borderRadius: 2,
  },
});

// --- Inline LoopControls (avoid Metro new file issue) ---
interface LoopControlsProps {
  isLooping: boolean;
  loopBeats: number;
  onSetLoop: (beats: number) => void;
  onClearLoop: () => void;
  activeDeckId: string;
}

const LoopControls: React.FC<LoopControlsProps> = React.memo(({
  isLooping,
  loopBeats,
  onSetLoop,
  onClearLoop,
}) => {
  const [selected, setSelected] = React.useState<number | null>(null);

  const handleLoop = (beats: number) => {
    setSelected(beats);
    onSetLoop(beats);
  };

  const handleClear = () => {
    setSelected(null);
    onClearLoop();
  };

  return (
    <View style={lcStyles.container}>
      <Text style={lcStyles.label}>LOOP</Text>
      <View style={lcStyles.row}>
        {[4, 8, 16].map((beats) => {
          const isActive = isLooping && (selected === beats || loopBeats === beats);
          return (
            <TouchableOpacity
              key={beats}
              style={[lcStyles.btn, isActive && lcStyles.btnActive]}
              onPress={() => handleLoop(beats)}
              activeOpacity={0.7}
            >
              <Text style={[lcStyles.text, isActive && lcStyles.textActive]}>
                {beats}B
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[lcStyles.btn, lcStyles.clearBtn, isLooping && lcStyles.clearBtnActive]}
          onPress={handleClear}
          activeOpacity={0.7}
        >
          <Text style={[lcStyles.text, lcStyles.clearText]}>
            EXIT
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const lcStyles = StyleSheet.create({
  container: {
    alignItems: "center",
    marginBottom: 12,
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
    marginBottom: 4,
    letterSpacing: 2,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  btn: {
    width: 44,
    height: 32,
    borderRadius: 6,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  btnActive: {
    backgroundColor: "#8B5CF6",
    borderColor: "#A78BFA",
  },
  text: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  textActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  clearBtn: {
    borderColor: "#EF4444",
    width: 48,
  },
  clearBtnActive: {
    backgroundColor: "#EF4444",
    borderColor: "#F87171",
  },
  clearText: {
    color: "#F87171",
    fontSize: 9,
    fontWeight: "700",
  },
});
