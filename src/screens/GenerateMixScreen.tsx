import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import Sound from "react-native-sound";
import { generateMix, MixMode, MixState, MixStatus } from "../services/stemMixService";
import { colors, radii, spacing, typography } from "../theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Track {
  uri: string;
  name: string;
}

interface Props {
  tracks: Track[];
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Progress mapping
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<MixStatus, string> = {
  idle: "Ready to mix",
  uploading: "Uploading tracks...",
  separating: "Separating stems...",
  syncing: "Synchronizing BPM...",
  mixing: "Building transition...",
  exporting: "Exporting final mix...",
  downloading: "Downloading result...",
  ready: "Mix ready!",
  error: "Something went wrong",
};

const MODES: { key: MixMode; label: string; desc: string }[] = [
  { key: "vocal_carry", label: "Vocal Carry", desc: "Keep vocals A, instruments B rise in" },
  { key: "smooth", label: "Smooth Crossfade", desc: "Classic S-curve transition" },
  { key: "drop_switch", label: "Drop Switch", desc: "Buildup then hard switch at drop" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GenerateMixScreen: React.FC<Props> = ({ tracks, onClose }) => {
  const [trackA, setTrackA] = useState<Track | null>(null);
  const [trackB, setTrackB] = useState<Track | null>(null);
  const [mode, setMode] = useState<MixMode>("vocal_carry");
  const [isGenerating, setIsGenerating] = useState(false);
  const [mixState, setMixState] = useState<MixState>({
    status: "idle",
    progress: 0,
    message: "",
    outputUri: null,
    durationSec: null,
    error: null,
    transitionMeta: null,
  });

  // Audio playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPos, setCurrentPos] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const soundRef = useRef<any>(null);
  const posTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seekTrackWidthRef = useRef<number>(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopPlayback();
    };
  }, []);

  // Load audio when mix is ready
  useEffect(() => {
    if (mixState.status === "ready" && mixState.outputUri) {
      loadAudio(mixState.outputUri);
    }
  }, [mixState.status, mixState.outputUri]);

  const stopPlayback = () => {
    if (posTimerRef.current) {
      clearInterval(posTimerRef.current);
      posTimerRef.current = null;
    }
    soundRef.current?.stop(() => {
      soundRef.current?.release();
      soundRef.current = null;
    });
    setIsPlaying(false);
    setCurrentPos(0);
  };

  const loadAudio = (uri: string) => {
    stopPlayback();
    const sound = new Sound(uri, "", (error: any) => {
      if (error) {
        console.error("[GenerateMix] Failed to load audio:", error);
        return;
      }
      setAudioDuration(sound.getDuration());
    });
    soundRef.current = sound;
  };

  const togglePlayback = useCallback(() => {
    if (!soundRef.current) return;

    if (isPlaying) {
      soundRef.current.pause(() => {
        setIsPlaying(false);
        if (posTimerRef.current) {
          clearInterval(posTimerRef.current);
          posTimerRef.current = null;
        }
      });
    } else {
      soundRef.current.play((success: boolean) => {
        if (success) {
          setIsPlaying(false);
          setCurrentPos(0);
          if (posTimerRef.current) {
            clearInterval(posTimerRef.current);
            posTimerRef.current = null;
          }
        }
      });
      setIsPlaying(true);
      posTimerRef.current = setInterval(() => {
        soundRef.current?.getCurrentTime((seconds: number) => {
          setCurrentPos(seconds);
        });
      }, 250);
    }
  }, [isPlaying]);

  const seekTo = useCallback((ratio: number) => {
    if (!soundRef.current) return;
    const target = Math.max(0, Math.min(ratio * audioDuration, audioDuration));
    soundRef.current.setCurrentTime(target);
    setCurrentPos(target);
  }, [audioDuration]);

  const handleGenerate = useCallback(async () => {
    if (!trackA || !trackB) return;

    setIsGenerating(true);
    stopPlayback();
    abortRef.current = new AbortController();

    await generateMix(
      trackA.uri,
      trackA.name,
      trackB.uri,
      trackB.name,
      mode,
      undefined,
      undefined,
      undefined,
      (state) => setMixState(state),
      abortRef.current.signal
    );

    setIsGenerating(false);
  }, [trackA, trackB, mode]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
    stopPlayback();
    setMixState({
      status: "idle",
      progress: 0,
      message: "",
      outputUri: null,
      durationSec: null,
      error: null,
      transitionMeta: null,
    });
  }, []);

  const canGenerate = trackA && trackB && !isGenerating;

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>AI Mix</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Track Selectors */}
        <Text style={styles.sectionLabel}>TRACK A</Text>
        <TrackSelector
          label="Select Track A"
          selected={trackA}
          options={tracks}
          onSelect={setTrackA}
        />

        <Text style={styles.sectionLabel}>TRACK B</Text>
        <TrackSelector
          label="Select Track B"
          selected={trackB}
          options={tracks}
          onSelect={setTrackB}
        />

        {/* Mode Selection */}
        <Text style={styles.sectionLabel}>TRANSITION MODE</Text>
        <View style={styles.modeGrid}>
          {MODES.map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[styles.modeCard, mode === m.key && styles.modeCardActive]}
              onPress={() => setMode(m.key)}
              activeOpacity={0.8}
              disabled={isGenerating}
            >
              <Text style={[styles.modeLabel, mode === m.key && styles.modeLabelActive]}>
                {m.label}
              </Text>
              <Text style={[styles.modeDesc, mode === m.key && styles.modeDescActive]}>
                {m.desc}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Progress / Loading */}
        {isGenerating && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#8B5CF6" style={{ marginBottom: spacing.md }} />
            <Text style={styles.loadingStatus}>{STATUS_LABELS[mixState.status]}</Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(mixState.progress, 5)}%` },
                ]}
              />
            </View>
            <Text style={styles.progressPct}>{Math.round(mixState.progress)}%</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error */}
        {mixState.status === "error" && !isGenerating && (
          <View style={styles.errorCard}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{mixState.error || "Generation failed"}</Text>
          </View>
        )}

        {/* Result */}
        {mixState.status === "ready" && mixState.outputUri && !isGenerating && (
          <View style={styles.resultCard}>
            <Text style={styles.resultIcon}>🎧</Text>
            <Text style={styles.resultTitle}>Mix Generated!</Text>
            <Text style={styles.resultMeta}>
              {mixState.durationSec ? `${Math.round(mixState.durationSec)}s` : ""}
              {mixState.durationSec ? " · " : ""}
              {mode.replace("_", " ")}
            </Text>

            {/* Transition Timeline Visualizer */}
            {mixState.transitionMeta && (
              <TransitionVisualizer
                meta={mixState.transitionMeta}
                currentPos={currentPos}
                duration={audioDuration}
              />
            )}

            {/* Player controls */}
            <View style={styles.playerRow}>
              <TouchableOpacity style={styles.playerBtn} onPress={togglePlayback} activeOpacity={0.7}>
                <Text style={styles.playerBtnText}>{isPlaying ? "⏸" : "▶"}</Text>
              </TouchableOpacity>

              <View style={styles.playerInfo}>
                <View
                  style={styles.seekTrack}
                  onLayout={(e) => {
                    seekTrackWidthRef.current = e.nativeEvent.layout.width;
                  }}
                  onStartShouldSetResponder={() => true}
                  onResponderGrant={(e) => {
                    const x = e.nativeEvent.locationX;
                    const w = seekTrackWidthRef.current || 1;
                    seekTo(Math.max(0, Math.min(x / w, 1)));
                  }}
                  onResponderMove={(e) => {
                    const x = e.nativeEvent.locationX;
                    const w = seekTrackWidthRef.current || 1;
                    seekTo(Math.max(0, Math.min(x / w, 1)));
                  }}
                >
                  <View
                    style={[
                      styles.seekFill,
                      {
                        width: `${audioDuration > 0 ? (currentPos / audioDuration) * 100 : 0}%`,
                      },
                    ]}
                  />
                </View>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(currentPos)}</Text>
                  <Text style={styles.timeText}>{formatTime(audioDuration)}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Generate Button */}
        {!isGenerating && mixState.status !== "ready" && (
          <TouchableOpacity
            style={[styles.generateBtn, !canGenerate && styles.generateBtnDisabled]}
            onPress={handleGenerate}
            activeOpacity={canGenerate ? 0.85 : 1}
            disabled={!canGenerate}
          >
            <Text style={styles.generateBtnText}>
              {trackA && trackB ? "Generate AI Mix" : "Select both tracks"}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// ---------------------------------------------------------------------------
// TrackSelector sub-component
// ---------------------------------------------------------------------------

const TrackSelector: React.FC<{
  label: string;
  selected: Track | null;
  options: Track[];
  onSelect: (track: Track) => void;
}> = ({ label, selected, options, onSelect }) => {
  const [open, setOpen] = useState(false);

  return (
    <View style={{ marginBottom: spacing.md }}>
      <TouchableOpacity
        style={styles.selectorBtn}
        onPress={() => setOpen(!open)}
        activeOpacity={0.8}
      >
        <Text style={styles.selectorText} numberOfLines={1}>
          {selected ? selected.name : label}
        </Text>
        <Text style={styles.selectorArrow}>{open ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {open && (
        <View style={styles.dropdown}>
          {options.map((track) => (
            <TouchableOpacity
              key={track.uri}
              style={[
                styles.dropdownItem,
                selected?.uri === track.uri && styles.dropdownItemActive,
              ]}
              onPress={() => {
                onSelect(track);
                setOpen(false);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.dropdownText,
                  selected?.uri === track.uri && styles.dropdownTextActive,
                ]}
                numberOfLines={1}
              >
                {track.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Transition Visualizer
// ---------------------------------------------------------------------------

const PHASE_COLORS: Record<string, string> = {
  intro: "rgba(59,130,246,0.5)",    // blue
  blend: "rgba(139,92,246,0.5)",    // purple
  mashup: "rgba(236,72,153,0.5)",   // pink
  drop: "rgba(239,68,68,0.6)",      // red
  release: "rgba(16,185,129,0.5)",  // green
};

const PHASE_LABELS: Record<string, string> = {
  intro: "INTRO",
  blend: "BLEND",
  mashup: "MASHUP",
  drop: "DROP",
  release: "RELEASE",
};

const TransitionVisualizer: React.FC<{
  meta: any;
  currentPos: number;
  duration: number;
}> = React.memo(({ meta, currentPos, duration }) => {
  const phases = meta.phases || [];
  const total = duration > 0 ? duration : meta.end_sec;

  // Find active phase
  const activePhase = phases.find(
    (p: any) => currentPos >= p.start && currentPos < p.end
  );

  return (
    <View style={vizStyles.container}>
      {/* Phase bar */}
      <View style={vizStyles.bar}>
        {phases.map((phase: any, i: number) => {
          const widthPct = total > 0 ? ((phase.end - phase.start) / total) * 100 : 20;
          const isActive = activePhase?.name === phase.name;
          return (
            <View
              key={i}
              style={[
                vizStyles.phaseSegment,
                {
                  width: `${widthPct}%`,
                  backgroundColor: PHASE_COLORS[phase.name] || "rgba(255,255,255,0.1)",
                  borderColor: isActive ? "#FFFFFF" : "transparent",
                  borderWidth: isActive ? 1.5 : 0,
                },
              ]}
            />
          );
        })}
        {/* Playhead */}
        {total > 0 && (
          <View
            style={[
              vizStyles.playhead,
              { left: `${(currentPos / total) * 100}%` },
            ]}
          />
        )}
      </View>

      {/* Phase labels */}
      <View style={vizStyles.labelsRow}>
        {phases.map((phase: any, i: number) => (
          <View key={i} style={[vizStyles.labelContainer, { flex: phase.end - phase.start }]}>
            <Text style={[
              vizStyles.labelText,
              activePhase?.name === phase.name && vizStyles.labelActive,
            ]}>
              {PHASE_LABELS[phase.name] || phase.name}
            </Text>
          </View>
        ))}
      </View>

      {/* Active phase name */}
      {activePhase && (
        <Text style={vizStyles.activeName}>
          {PHASE_LABELS[activePhase.name] || activePhase.name}
        </Text>
      )}
    </View>
  );
});

const vizStyles = StyleSheet.create({
  container: {
    width: "100%",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  bar: {
    flexDirection: "row",
    height: 24,
    borderRadius: radii.sm,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    position: "relative",
  },
  phaseSegment: {
    height: "100%",
    borderRightWidth: 1,
    borderRightColor: "rgba(0,0,0,0.3)",
  },
  playhead: {
    position: "absolute",
    top: -4,
    bottom: -4,
    width: 3,
    backgroundColor: "#FFFFFF",
    shadowColor: "#FFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
    marginLeft: -1.5,
  },
  labelsRow: {
    flexDirection: "row",
    marginTop: 6,
    gap: 2,
  },
  labelContainer: {
    alignItems: "center",
  },
  labelText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 8,
    letterSpacing: 0.5,
  },
  labelActive: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  activeName: {
    ...typography.label,
    color: "#A78BFA",
    fontWeight: "700",
    textAlign: "center",
    marginTop: spacing.xs,
    fontSize: 11,
    letterSpacing: 1,
  },
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    color: colors.textPrimary,
    fontSize: 20,
  },
  title: {
    ...typography.headline,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    letterSpacing: 1.5,
  },
  selectorBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  selectorText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "500",
    flex: 1,
  },
  selectorArrow: {
    color: colors.textMuted,
    fontSize: 12,
    marginLeft: spacing.sm,
  },
  dropdown: {
    marginTop: 4,
    backgroundColor: "rgba(20,20,25,0.98)",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    maxHeight: 200,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  dropdownItemActive: {
    backgroundColor: "rgba(139,92,246,0.1)",
  },
  dropdownText: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
  },
  dropdownTextActive: {
    color: "#A78BFA",
    fontWeight: "600",
  },
  modeGrid: {
    gap: spacing.sm,
  },
  modeCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  modeCardActive: {
    backgroundColor: "rgba(139,92,246,0.1)",
    borderColor: "rgba(139,92,246,0.3)",
  },
  modeLabel: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: "600",
    marginBottom: 2,
  },
  modeLabelActive: {
    color: "#A78BFA",
  },
  modeDesc: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  modeDescActive: {
    color: "rgba(167,139,250,0.7)",
  },
  loadingCard: {
    backgroundColor: "rgba(139,92,246,0.06)",
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.15)",
    marginTop: spacing.lg,
  },
  loadingStatus: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "600",
    marginBottom: spacing.md,
  },
  progressTrack: {
    width: "100%",
    height: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#8B5CF6",
    borderRadius: 3,
  },
  progressPct: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
  cancelBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  cancelText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  errorCard: {
    backgroundColor: "rgba(239,68,68,0.08)",
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
    marginTop: spacing.lg,
  },
  errorIcon: {
    fontSize: 28,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...typography.body,
    color: "#EF4444",
    textAlign: "center",
  },
  resultCard: {
    backgroundColor: "rgba(16,185,129,0.06)",
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.2)",
    marginTop: spacing.lg,
  },
  resultIcon: {
    fontSize: 36,
    marginBottom: spacing.sm,
  },
  resultTitle: {
    ...typography.title,
    color: colors.textPrimary,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  resultMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  playerBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#8B5CF6",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  playerBtnText: {
    fontSize: 18,
    color: "#FFFFFF",
  },
  playerInfo: {
    flex: 1,
  },
  seekTrack: {
    width: "100%",
    height: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 2,
    overflow: "hidden",
    justifyContent: "center",
  },
  seekFill: {
    height: 4,
    backgroundColor: "#8B5CF6",
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  timeText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  generateBtn: {
    backgroundColor: "#8B5CF6",
    borderRadius: radii.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
    alignItems: "center",
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  generateBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.08)",
    shadowOpacity: 0,
    elevation: 0,
  },
  generateBtnText: {
    ...typography.label,
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});
