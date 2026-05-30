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
import {
    DJPersonality,
    EnergyCurveShape,
    FXMode,
    generateMultiTrackMix,
    MixMode,
    MixStatus,
    MultiTrackMixState,
    TrackInput,
} from "../services/multiTrackMixService";
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
// Status labels
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<MixStatus, string> = {
  idle: "Ready to mix",
  analyzing: "Analyzing tracks...",
  ordering: "AI ordering tracks...",
  mixing: "Building transitions...",
  exporting: "Exporting final mix...",
  downloading: "Downloading result...",
  ready: "Mix ready!",
  error: "Something went wrong",
};

const MODES: { key: MixMode; label: string; desc: string }[] = [
  { key: "auto", label: "AI Auto", desc: "Let AI choose best transitions" },
  { key: "vocal_carry", label: "Vocal Carry", desc: "Keep vocals, swap instruments" },
  { key: "smooth", label: "Smooth", desc: "Progressive crossfade" },
  { key: "drop_switch", label: "Drop Switch", desc: "Buildup then impact" },
];

const PERSONALITIES: { key: DJPersonality; label: string; desc: string }[] = [
  { key: "cinematic", label: "Cinematic", desc: "Long emotional arcs, drama" },
  { key: "festival", label: "Festival", desc: "Aggressive drops, crowd bombs" },
  { key: "amv_editor", label: "AMV Editor", desc: "Emotional sync, fake drops" },
  { key: "smooth_night", label: "Smooth Night", desc: "Invisible blends, continuity" },
  { key: "chaos_mashup", label: "Chaos Mashup", desc: "Experimental, creative swaps" },
  { key: "phonk_trap", label: "Phonk / Trap", desc: "Aggressive bass, hard switches" },
];

const ENERGY_SHAPES: { key: EnergyCurveShape; label: string }[] = [
  { key: "sigmoid", label: "Cinematic S-Curve" },
  { key: "linear", label: "Steady Ramp" },
  { key: "exponential", label: "Accelerating" },
  { key: "waves", label: "Peaks & Valleys" },
  { key: "staircase", label: "Step Jumps" },
  { key: "plateau", label: "Flat then Spike" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MultiTrackMixScreen: React.FC<Props> = ({ tracks, onClose }) => {
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [mode, setMode] = useState<MixMode>("auto");
  const [autoOrder, setAutoOrder] = useState(true);
  const [personality, setPersonality] = useState<DJPersonality>("cinematic");
  const [energyCurveShape, setEnergyCurveShape] = useState<EnergyCurveShape>("sigmoid");
  const [aggressiveness, setAggressiveness] = useState<number>(0.5);
  const [fxIntensity, setFxIntensity] = useState<number>(0.5);
  const [fxMode, setFxMode] = useState<FXMode>("normal");
  const [isGenerating, setIsGenerating] = useState(false);
  const [mixState, setMixState] = useState<MultiTrackMixState>({
    status: "idle",
    progress: 0,
    message: "",
    outputUri: null,
    totalDurationSec: null,
    trackOrder: [],
    timeline: null,
    targetBpm: null,
    numTracks: 0,
    personality: null,
    energyCurveShape: null,
    scenes: [],
    emotions: {},
    error: null,
  });

  // Audio playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPos, setCurrentPos] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const soundRef = useRef<any>(null);
  const posTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seekTrackWidthRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopPlayback();
    };
  }, []);

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
        console.error("[MultiTrackMix] Failed to load audio:", error);
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

  const toggleTrack = (track: Track) => {
    setSelectedTracks((prev) => {
      const exists = prev.find((t) => t.uri === track.uri);
      if (exists) {
        return prev.filter((t) => t.uri !== track.uri);
      }
      if (prev.length >= 10) return prev; // max 10
      return [...prev, track];
    });
  };

  const handleGenerate = useCallback(async () => {
    if (selectedTracks.length < 2) return;

    setIsGenerating(true);
    stopPlayback();
    abortRef.current = new AbortController();

    const inputs: TrackInput[] = selectedTracks.map((t) => ({
      uri: t.uri,
      name: t.name,
    }));

    await generateMultiTrackMix(
      inputs,
      mode,
      autoOrder,
      undefined,
      45,
      personality,
      energyCurveShape,
      aggressiveness,
      fxIntensity,
      fxMode,
      (state: MultiTrackMixState) => setMixState(state),
      abortRef.current.signal
    );

    setIsGenerating(false);
  }, [selectedTracks, mode, autoOrder, personality, energyCurveShape, aggressiveness, fxIntensity, fxMode]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
    stopPlayback();
    setMixState({
      status: "idle",
      progress: 0,
      message: "",
      outputUri: null,
      totalDurationSec: null,
      trackOrder: [],
      timeline: null,
      targetBpm: null,
      numTracks: 0,
      personality: null,
      energyCurveShape: null,
      scenes: [],
      emotions: {},
      error: null,
    });
  }, []);

  const canGenerate = selectedTracks.length >= 2 && !isGenerating;

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
        <Text style={styles.title}>AI DJ Set</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Track count badge */}
        <View style={styles.badgeRow}>
          <Text style={styles.badgeText}>
            {selectedTracks.length} / {Math.min(tracks.length, 10)} selected
          </Text>
        </View>

        {/* Track Grid */}
        <Text style={styles.sectionLabel}>SELECT TRACKS (2-10)</Text>
        <View style={styles.trackGrid}>
          {tracks.slice(0, 20).map((track) => {
            const isSelected = selectedTracks.some((t) => t.uri === track.uri);
            return (
              <TouchableOpacity
                key={track.uri}
                style={[styles.trackChip, isSelected && styles.trackChipActive]}
                onPress={() => toggleTrack(track)}
                activeOpacity={0.7}
                disabled={isGenerating}
              >
                <Text
                  style={[styles.trackChipText, isSelected && styles.trackChipTextActive]}
                  numberOfLines={1}
                >
                  {track.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Auto Order Toggle */}
        <TouchableOpacity
          style={styles.toggleRow}
          onPress={() => !isGenerating && setAutoOrder((v) => !v)}
          activeOpacity={0.7}
        >
          <View style={[styles.toggleBox, autoOrder && styles.toggleBoxActive]}>
            {autoOrder && <Text style={styles.toggleCheck}>✓</Text>}
          </View>
          <Text style={styles.toggleLabel}>AI Auto-Order (best flow)</Text>
        </TouchableOpacity>

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

        {/* Personality Selection */}
        <Text style={styles.sectionLabel}>DJ PERSONALITY</Text>
        <View style={styles.modeGrid}>
          {PERSONALITIES.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.modeCard, personality === p.key && styles.modeCardActive]}
              onPress={() => setPersonality(p.key)}
              activeOpacity={0.8}
              disabled={isGenerating}
            >
              <Text style={[styles.modeLabel, personality === p.key && styles.modeLabelActive]}>
                {p.label}
              </Text>
              <Text style={[styles.modeDesc, personality === p.key && styles.modeDescActive]}>
                {p.desc}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Energy Curve Selection */}
        <Text style={styles.sectionLabel}>ENERGY PROGRESSION</Text>
        <View style={styles.modeGrid}>
          {ENERGY_SHAPES.map((s) => (
            <TouchableOpacity
              key={s.key}
              style={[styles.modeCard, energyCurveShape === s.key && styles.modeCardActive]}
              onPress={() => setEnergyCurveShape(s.key)}
              activeOpacity={0.8}
              disabled={isGenerating}
            >
              <Text style={[styles.modeLabel, energyCurveShape === s.key && styles.modeLabelActive]}>
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Aggressiveness Slider */}
        <Text style={styles.sectionLabel}>TRANSITION AGGRESSIVENESS</Text>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderLabel}>Soft</Text>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${aggressiveness * 100}%` }]} />
          </View>
          <Text style={styles.sliderLabel}>Hard</Text>
        </View>
        <View style={styles.sliderButtons}>
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.sliderBtn, Math.abs(aggressiveness - val) < 0.05 && styles.sliderBtnActive]}
              onPress={() => setAggressiveness(val)}
              disabled={isGenerating}
            >
              <Text style={styles.sliderBtnText}>{Math.round(val * 100)}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* FX Mode Selection */}
        <Text style={styles.sectionLabel}>FX MODE</Text>
        <View style={styles.fxRow}>
          {[
            { key: "minimal" as FXMode, label: "Minimal" },
            { key: "normal" as FXMode, label: "Normal" },
            { key: "cinematic" as FXMode, label: "Cinematic" },
            { key: "aggressive" as FXMode, label: "Aggressive" },
          ].map((fm) => (
            <TouchableOpacity
              key={fm.key}
              style={[styles.fxBtn, fxMode === fm.key && styles.fxBtnActive]}
              onPress={() => setFxMode(fm.key)}
              activeOpacity={0.8}
              disabled={isGenerating}
            >
              <Text style={[styles.fxBtnText, fxMode === fm.key && styles.fxBtnTextActive]}>
                {fm.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* FX Intensity Slider */}
        <Text style={styles.sectionLabel}>FX INTENSITY</Text>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderLabel}>Subtle</Text>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${fxIntensity * 100}%` }]} />
          </View>
          <Text style={styles.sliderLabel}>Strong</Text>
        </View>
        <View style={styles.sliderButtons}>
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.sliderBtn, Math.abs(fxIntensity - val) < 0.05 && styles.sliderBtnActive]}
              onPress={() => setFxIntensity(val)}
              disabled={isGenerating}
            >
              <Text style={styles.sliderBtnText}>{Math.round(val * 100)}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Generate Button */}
        <TouchableOpacity
          style={[styles.generateBtn, !canGenerate && styles.generateBtnDisabled]}
          onPress={handleGenerate}
          activeOpacity={0.8}
          disabled={!canGenerate}
        >
          <Text style={styles.generateBtnText}>
            {isGenerating ? "Mixing..." : `Generate ${selectedTracks.length}-Track Mix`}
          </Text>
        </TouchableOpacity>

        {/* Progress */}
        {isGenerating && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#8B5CF6" style={{ marginBottom: spacing.md }} />
            <Text style={styles.loadingStatus}>{STATUS_LABELS[mixState.status]}</Text>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${Math.max(mixState.progress, 5)}%` }]}
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
            <Text style={styles.resultTitle}>DJ Set Ready!</Text>
            <Text style={styles.resultMeta}>
              {mixState.numTracks} tracks · {mixState.totalDurationSec ? `${Math.round(mixState.totalDurationSec)}s` : ""}
              {mixState.targetBpm ? ` · ${Math.round(mixState.targetBpm)} BPM` : ""}
            </Text>

            {/* Track Order */}
            {mixState.trackOrder.length > 0 && (
              <View style={styles.orderCard}>
                <Text style={styles.orderTitle}>Play Order</Text>
                {mixState.trackOrder.map((tid, i) => (
                  <View key={tid} style={styles.orderRow}>
                    <Text style={styles.orderNum}>{i + 1}</Text>
                    <Text style={styles.orderName} numberOfLines={1}>
                      {tid.replace(/^track_\d+_/, "")}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Timeline Events */}
            {mixState.timeline && mixState.timeline.events.length > 0 && (
              <View style={styles.timelineCard}>
                <Text style={styles.timelineTitle}>Mix Timeline</Text>
                {mixState.timeline.events.slice(0, 12).map((ev, i) => (
                  <View key={i} style={styles.timelineRow}>
                    <Text style={styles.timelineTime}>{formatTime(ev.time_sec)}</Text>
                    <View style={styles.timelineDot} />
                    <Text style={styles.timelineDesc} numberOfLines={1}>
                      {ev.description}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Playback */}
            <View style={styles.playerCard}>
              <TouchableOpacity onPress={togglePlayback} activeOpacity={0.7} style={styles.playBtn}>
                <Text style={styles.playBtnText}>{isPlaying ? "⏸" : "▶️"}</Text>
              </TouchableOpacity>

              <View style={styles.seekContainer}>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(currentPos)}</Text>
                  <Text style={styles.timeText}>{formatTime(audioDuration)}</Text>
                </View>

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
                  <View style={styles.seekBg} />
                  <View
                    style={[
                      styles.seekFill,
                      { width: `${audioDuration > 0 ? (currentPos / audioDuration) * 100 : 0}%` },
                    ]}
                  />
                  <View
                    style={[
                      styles.seekThumb,
                      {
                        left: `${audioDuration > 0 ? (currentPos / audioDuration) * 100 : 0}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backBtn: { width: 40, alignItems: "center" },
  backText: { fontSize: 24, color: colors.textPrimary },
  title: { ...typography.headline, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl * 2 },

  badgeRow: { alignItems: "center", marginVertical: spacing.sm },
  badgeText: { color: colors.textMuted, fontSize: 13 },

  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    letterSpacing: 1,
  },

  trackGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  trackChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: "48%",
  },
  trackChipActive: {
    backgroundColor: "#8B5CF6",
    borderColor: "#8B5CF6",
  },
  trackChipText: { color: colors.textPrimary, fontSize: 13 },
  trackChipTextActive: { color: "#fff", fontWeight: "600" },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  toggleBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleBoxActive: { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6" },
  toggleCheck: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  toggleLabel: { color: colors.textPrimary, fontSize: 14 },

  modeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  modeCard: {
    flex: 1,
    minWidth: "45%",
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeCardActive: {
    backgroundColor: "rgba(139, 92, 246, 0.15)",
    borderColor: "#8B5CF6",
  },
  modeLabel: { color: colors.textPrimary, fontWeight: "600", fontSize: 14, marginBottom: 4 },
  modeLabelActive: { color: "#8B5CF6" },
  modeDesc: { color: colors.textMuted, fontSize: 12 },
  modeDescActive: { color: "#A78BFA" },

  generateBtn: {
    backgroundColor: "#8B5CF6",
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  generateBtnDisabled: { opacity: 0.4 },
  generateBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  loadingCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  loadingStatus: { color: colors.textPrimary, fontWeight: "600", marginBottom: spacing.sm },
  progressTrack: {
    width: "100%",
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginVertical: spacing.sm,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#8B5CF6", borderRadius: 3 },
  progressPct: { color: colors.textMuted, fontSize: 12 },
  cancelBtn: { marginTop: spacing.md, padding: spacing.sm },
  cancelText: { color: colors.textMuted },

  errorCard: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  errorIcon: { fontSize: 28, marginBottom: spacing.sm },
  errorText: { color: "#EF4444", textAlign: "center" },

  resultCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  resultIcon: { fontSize: 36, marginBottom: spacing.sm },
  resultTitle: { color: colors.textPrimary, fontWeight: "700", fontSize: 18, marginBottom: 4 },
  resultMeta: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md },

  orderCard: {
    width: "100%",
    backgroundColor: "rgba(139, 92, 246, 0.08)",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  orderTitle: { color: "#8B5CF6", fontWeight: "700", marginBottom: spacing.sm },
  orderRow: { flexDirection: "row", alignItems: "center", marginVertical: 2 },
  orderNum: {
    width: 22,
    color: "#8B5CF6",
    fontWeight: "700",
    fontSize: 12,
  },
  orderName: { color: colors.textPrimary, fontSize: 13, flex: 1 },

  timelineCard: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  timelineTitle: { color: colors.textMuted, fontWeight: "600", marginBottom: spacing.sm },
  timelineRow: { flexDirection: "row", alignItems: "center", marginVertical: 3 },
  timelineTime: { color: colors.textMuted, fontSize: 11, width: 50 },
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#8B5CF6",
    marginHorizontal: spacing.sm,
  },
  timelineDesc: { color: colors.textPrimary, fontSize: 12, flex: 1 },

  playerCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#8B5CF6",
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnText: { fontSize: 20 },
  seekContainer: { flex: 1 },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  timeText: { color: colors.textMuted, fontSize: 11 },
  seekTrack: {
    height: 28,
    justifyContent: "center",
  },
  seekBg: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
  },
  seekFill: {
    position: "absolute",
    left: 0,
    height: 4,
    backgroundColor: "#8B5CF6",
    borderRadius: 2,
  },
  seekThumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    marginLeft: -7,
    top: 7,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  sliderLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    width: 40,
    textAlign: "center",
  },
  sliderTrack: {
    flex: 1,
    height: 6,
    backgroundColor: "#333",
    borderRadius: 3,
    marginHorizontal: spacing.sm,
    overflow: "hidden",
  },
  sliderFill: {
    height: 6,
    backgroundColor: "#8B5CF6",
    borderRadius: 3,
  },
  sliderButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  sliderBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: "#222",
    borderWidth: 1,
    borderColor: "#333",
  },
  sliderBtnActive: {
    backgroundColor: "#8B5CF6",
    borderColor: "#8B5CF6",
  },
  sliderBtnText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  fxRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: spacing.sm,
  },
  fxBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: "#222",
    borderWidth: 1,
    borderColor: "#333",
    marginRight: 8,
    marginBottom: 8,
  },
  fxBtnActive: {
    backgroundColor: "#8B5CF6",
    borderColor: "#8B5CF6",
  },
  fxBtnText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  fxBtnTextActive: {
    color: "#fff",
  },
});
