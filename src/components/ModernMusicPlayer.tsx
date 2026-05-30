import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";

import type { TransitionProgress } from "../engine/TransitionExecutor";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const WAVE_BARS = 24;

interface TrackInfo {
  name: string;
  uri: string;
}

interface AnalysisInfo {
  bpm: number;
  energy: number;
  sections: any[];
  drops: any[];
}

interface ModernMusicPlayerProps {
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

export const ModernMusicPlayer: React.FC<ModernMusicPlayerProps> = (props) => {
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

  // --- Animated values ---
  const coverSlideOut = useRef(new Animated.Value(0)).current;
  const coverSlideIn = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const coverScaleOut = useRef(new Animated.Value(1)).current;
  const coverFadeOut = useRef(new Animated.Value(1)).current;
  const coverFadeIn = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const crossfaderAnim = useRef(new Animated.Value(0)).current;

  // Waveform: lightweight — heights computed directly from currentPosition (no Animated.Values)

  // --- BPM pulse ---
  useEffect(() => {
    if (isPlaying && currentAnalysis?.bpm) {
      const interval = 60000 / currentAnalysis.bpm;
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.04,
            duration: interval * 0.2,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: interval * 0.8,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [isPlaying, currentAnalysis?.bpm]);

  // --- Glow ---
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2500, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2500, useNativeDriver: false, easing: Easing.inOut(Easing.sin) }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // --- Crossfader + Cover slide during transition ---
  useEffect(() => {
    if (isTransitioning) {
      Animated.parallel([
        // Cover A slides left & fades
        Animated.timing(coverSlideOut, {
          toValue: -SCREEN_WIDTH * 0.6,
          duration: 1200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(coverScaleOut, {
          toValue: 0.85,
          duration: 1200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(coverFadeOut, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
        // Cover B slides in from right
        Animated.timing(coverSlideIn, {
          toValue: 0,
          duration: 1200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(coverFadeIn, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        // Crossfader moves from A → B
        Animated.timing(crossfaderAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
      ]).start();
    } else {
      // Reset
      Animated.parallel([
        Animated.spring(coverSlideOut, { toValue: 0, useNativeDriver: true, tension: 50, friction: 10 }),
        Animated.spring(coverScaleOut, { toValue: 1, useNativeDriver: true, tension: 50, friction: 10 }),
        Animated.timing(coverFadeOut, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(coverSlideIn, { toValue: SCREEN_WIDTH, duration: 400, useNativeDriver: true }),
        Animated.timing(coverFadeIn, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(crossfaderAnim, { toValue: 0, duration: 500, useNativeDriver: false }),
      ]).start();
    }
  }, [isTransitioning]);

  const formatTime = (sec: number) => {
    if (!sec || isNaN(sec)) return "0:00";
    return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 ? (currentPosition / duration) * 100 : 0;
  const energyColor = currentAnalysis
    ? currentAnalysis.energy > 0.7 ? "#EF4444" : currentAnalysis.energy > 0.4 ? "#F59E0B" : "#3B82F6"
    : "#3B82F6";
  const nextColor = nextAnalysis
    ? nextAnalysis.energy > 0.7 ? "#EF4444" : nextAnalysis.energy > 0.4 ? "#F59E0B" : "#3B82F6"
    : "#8B5CF6";

  const glowBg = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(59,130,246,0.0)", "rgba(59,130,246,0.12)"],
  });

  const crossfaderLeft = crossfaderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["5%", "75%"],
  });


  return (
    <View style={s.wrapper}>
      <Animated.View style={[s.glow, { backgroundColor: glowBg }]} />

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerLabel}>NOW PLAYING</Text>
          <Text style={s.headerIdx}>{currentIndex + 1} / {totalTracks}</Text>
        </View>
        <View style={s.headerRight}>
          <Toggle label="AP" active={autoplay} color="#10B981" onPress={onToggleAutoplay} />
          <Toggle label="RP" active={repeat} color="#8B5CF6" onPress={onToggleRepeat} />
          <Toggle label="SH" active={shuffle} color="#F59E0B" onPress={onToggleShuffle} />
        </View>
      </View>

      {/* Track Cards — dual deck with slide animation */}
      <View style={s.deckContainer}>
        {/* Current track (deck A) — slides left on transition */}
        <Animated.View style={[s.card, {
          transform: [
            { translateX: coverSlideOut },
            { scale: Animated.multiply(coverScaleOut, pulseAnim) },
          ],
          opacity: coverFadeOut,
        }]}>
          <View style={[s.art, { borderColor: energyColor }]}>
            <Text style={s.artTxt}>{currentTrack?.name?.charAt(0)?.toUpperCase() || "?"}</Text>
            <View style={[s.artBar, { backgroundColor: energyColor }]} />
          </View>
          <View style={s.info}>
            <Text style={s.name} numberOfLines={1}>{currentTrack?.name || "Aucun morceau"}</Text>
            <View style={s.stats}>
              {currentAnalysis && (
                <>
                  <Badge val={String(currentAnalysis.bpm)} lbl="BPM" />
                  <Badge val={`${Math.round(currentAnalysis.energy * 100)}%`} lbl="NRG" />
                  <Badge val={String(currentAnalysis.drops.length)} lbl="DROPS" />
                </>
              )}
            </View>
          </View>
        </Animated.View>

        {/* Next track (deck B) — slides in from right */}
        {nextTrack && (
          <Animated.View style={[s.card, s.cardIncoming, {
            transform: [{ translateX: coverSlideIn }],
            opacity: coverFadeIn,
          }]}>
            <View style={[s.art, { borderColor: nextColor }]}>
              <Text style={s.artTxt}>{nextTrack.name?.charAt(0)?.toUpperCase() || "?"}</Text>
              <View style={[s.artBar, { backgroundColor: nextColor }]} />
            </View>
            <View style={s.info}>
              <Text style={s.name} numberOfLines={1}>{nextTrack.name}</Text>
              <View style={s.stats}>
                {nextAnalysis && (
                  <>
                    <Badge val={String(nextAnalysis.bpm)} lbl="BPM" />
                    <Badge val={`${Math.round(nextAnalysis.energy * 100)}%`} lbl="NRG" />
                  </>
                )}
              </View>
            </View>
          </Animated.View>
        )}
      </View>

      {/* Waveform — lightweight, no Animated.Value per bar */}
      <Waveform
        progress={progress}
        energyColor={energyColor}
        isPlaying={isPlaying}
        bpm={currentAnalysis?.bpm || 128}
        energy={currentAnalysis?.energy ?? 0.5}
        transitionPointPct={transitionPoint && duration > 0 ? (transitionPoint / duration) * 100 : null}
      />

      {/* Progress bar */}
      <View style={s.progRow}>
        <Text style={s.time}>{formatTime(currentPosition)}</Text>
        <TouchableOpacity style={s.progTouch} activeOpacity={1} onPress={(e) => {
          const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / (SCREEN_WIDTH - 120)));
          if (duration > 0) onSeek(ratio * duration);
        }}>
          <View style={s.progTrack}>
            <View style={[s.progFill, { width: `${progress}%`, backgroundColor: energyColor }]} />
            <View style={[s.progThumb, { left: `${progress}%`, backgroundColor: energyColor }]} />
          </View>
        </TouchableOpacity>
        <Text style={s.time}>{formatTime(duration)}</Text>
      </View>

      {/* Controls */}
      <View style={s.ctrls}>
        <TouchableOpacity style={s.seekBtn} onPress={onSeekBackward}>
          <Text style={s.seekTxt}>-10s</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.navBtn} onPress={onPrevious}>
          <Text style={s.navTxt}>⏮</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.playBtn, { backgroundColor: energyColor }]} onPress={onPlayPause}>
          <Text style={s.playTxt}>{isPlaying ? "⏸" : "▶"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.navBtn} onPress={onNext}>
          <Text style={s.navTxt}>⏭</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.seekBtn} onPress={onSeekForward}>
          <Text style={s.seekTxt}>+10s</Text>
        </TouchableOpacity>
      </View>

      {/* Crossfader visual */}
      {isTransitioning && (
        <View style={s.crossfaderWrap}>
          <View style={s.crossfaderLabels}>
            <Text style={s.crossfaderLbl}>A</Text>
            <Text style={[s.crossfaderLbl, { color: "#F59E0B" }]}>
              {transitionState.style?.toUpperCase() || "MIX"}
            </Text>
            <Text style={s.crossfaderLbl}>B</Text>
          </View>
          <View style={s.crossfaderTrack}>
            {/* Left glow */}
            <Animated.View style={[s.crossfaderGlowA, {
              opacity: crossfaderAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] }),
            }]} />
            {/* Right glow */}
            <Animated.View style={[s.crossfaderGlowB, {
              opacity: crossfaderAnim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }),
            }]} />
            {/* Knob */}
            <Animated.View style={[s.crossfaderKnob, { left: crossfaderLeft }]} />
          </View>
          <Text style={s.crossfaderPct}>
            {Math.round(transitionState.progress * 100)}%
          </Text>
        </View>
      )}

      {/* Auto-transition indicator */}
      {nextTrack && !isTransitioning && transitionPoint !== null && duration > 0 && (
        <View style={s.mixBtn}>
          <Text style={s.mixTxt}>
            Auto-mix dans {Math.max(0, Math.round(transitionPoint - currentPosition))}s
            {transitionPoint - currentPosition <= 5 ? " ⚡" : ""}
          </Text>
          <View style={s.mixProgress}>
            <View style={[s.mixProgressFill, { width: `${Math.min(100, (currentPosition / transitionPoint) * 100)}%` }]} />
          </View>
        </View>
      )}

      {/* Manual mix fallback */}
      {nextTrack && !isTransitioning && transitionPoint === null && (
        <TouchableOpacity style={s.mixBtn} onPress={onStartTransition}>
          <Text style={s.mixTxt}>Mix vers suivant →</Text>
        </TouchableOpacity>
      )}

      {/* Next up (non-transition) */}
      {nextTrack && !isTransitioning && (
        <View style={s.nextCard}>
          <Text style={s.nextLbl}>NEXT UP</Text>
          <Text style={s.nextName} numberOfLines={1}>{nextTrack.name}</Text>
          {nextAnalysis && (
            <Text style={s.nextStats}>{nextAnalysis.bpm} BPM · {Math.round(nextAnalysis.energy * 100)}% NRG</Text>
          )}
        </View>
      )}
    </View>
  );
};

// --- Lightweight Waveform (no Animated.Value per bar) ---
const Waveform: React.FC<{
  progress: number;
  energyColor: string;
  isPlaying: boolean;
  bpm: number;
  energy: number;
  transitionPointPct: number | null;
}> = React.memo(({ progress, energyColor, isPlaying, bpm, energy, transitionPointPct }) => {
  const beatPhase = (Date.now() / 1000) * (bpm / 60) * Math.PI * 2;
  const boost = isPlaying ? energy * 10 : 0;

  return (
    <View style={wf.container}>
      <View style={wf.row}>
        {Array.from({ length: WAVE_BARS }).map((_, i) => {
          const isPast = (i / WAVE_BARS) * 100 < progress;
          const baseH = 6 + Math.sin(i * 0.7) * 6 + Math.cos(i * 1.3) * 4;
          const dynamic = isPlaying ? Math.sin(beatPhase + i * 0.5) * boost : 0;
          const h = Math.max(3, baseH + dynamic);

          return (
            <View
              key={i}
              style={[
                wf.bar,
                {
                  height: h,
                  backgroundColor: isPast ? energyColor : "#374151",
                  opacity: isPast ? 0.9 : 0.3,
                },
              ]}
            />
          );
        })}
      </View>
      {/* Playhead */}
      <View style={[wf.playhead, { left: `${progress}%` }]} />
      {/* Transition marker */}
      {transitionPointPct !== null && (
        <View style={[wf.transMarker, { left: `${transitionPointPct}%` }]} />
      )}
    </View>
  );
});

const Toggle: React.FC<{ label: string; active: boolean; color: string; onPress: () => void }> = ({ label, active, color, onPress }) => (
  <TouchableOpacity style={[s.tog, active && { backgroundColor: color + "30", borderColor: color }]} onPress={onPress}>
    <Text style={[s.togTxt, active && { color }]}>{label}</Text>
  </TouchableOpacity>
);

const Badge: React.FC<{ val: string; lbl: string }> = ({ val, lbl }) => (
  <View style={s.badge}>
    <Text style={s.badgeVal}>{val}</Text>
    <Text style={s.badgeLbl}>{lbl}</Text>
  </View>
);

const s = StyleSheet.create({
  wrapper: { backgroundColor: "#111827", borderRadius: 20, margin: 12, padding: 20, overflow: "hidden" },
  glow: { position: "absolute", top: -50, left: -50, right: -50, bottom: -50, borderRadius: 70 },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerLabel: { fontSize: 11, fontWeight: "700", color: "#6B7280", letterSpacing: 1.5 },
  headerIdx: { fontSize: 13, fontWeight: "600", color: "#9CA3AF" },
  headerRight: { flexDirection: "row", gap: 6 },

  tog: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#1F2937", borderWidth: 1, borderColor: "#374151", justifyContent: "center", alignItems: "center" },
  togTxt: { fontSize: 10, fontWeight: "700", color: "#6B7280" },

  deckContainer: { position: "relative", marginBottom: 16, minHeight: 90 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#1F2937", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#374151" },
  cardIncoming: { position: "absolute", top: 0, left: 0, right: 0, borderColor: "#8B5CF6" },
  art: { width: 64, height: 64, borderRadius: 14, backgroundColor: "#374151", justifyContent: "center", alignItems: "center", borderWidth: 2, marginRight: 14, overflow: "hidden" },
  artTxt: { fontSize: 28, fontWeight: "800", color: "#9CA3AF" },
  artBar: { position: "absolute", bottom: 0, left: 0, right: 0, height: 3 },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: "700", color: "#F9FAFB", marginBottom: 8 },
  stats: { flexDirection: "row", gap: 12 },
  badge: { backgroundColor: "#374151", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignItems: "center" },
  badgeVal: { fontSize: 14, fontWeight: "700", color: "#F9FAFB" },
  badgeLbl: { fontSize: 9, fontWeight: "600", color: "#6B7280", letterSpacing: 0.5 },

  // Animated Waveform
  waveContainer: { position: "relative", marginBottom: 12, height: 36, paddingHorizontal: 4 },
  waveRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: "100%", gap: 1 },
  waveBar: { flex: 1, borderRadius: 2, minWidth: 2 },
  wavePlayhead: { position: "absolute", top: 0, width: 2, height: "100%", backgroundColor: "#FFFFFF", shadowColor: "#FFFFFF", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 3, elevation: 3 },
  waveTransMarker: { position: "absolute", top: 0, width: 2, height: "100%", backgroundColor: "#FBBF24", opacity: 0.7 },

  // Progress
  progRow: { flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 8 },
  time: { fontSize: 11, fontWeight: "600", color: "#6B7280", width: 36, textAlign: "center" },
  progTouch: { flex: 1, height: 20, justifyContent: "center" },
  progTrack: { height: 4, backgroundColor: "#1F2937", borderRadius: 2, position: "relative", overflow: "visible" },
  progFill: { height: "100%", borderRadius: 2 },
  progThumb: { position: "absolute", width: 14, height: 14, borderRadius: 7, top: -5, transform: [{ translateX: -7 }], shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4, elevation: 4 },

  // Controls
  ctrls: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 14, marginBottom: 18 },
  seekBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: "#1F2937", borderWidth: 1, borderColor: "#374151" },
  seekTxt: { fontSize: 11, fontWeight: "600", color: "#9CA3AF" },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1F2937", borderWidth: 1, borderColor: "#374151", justifyContent: "center", alignItems: "center" },
  navTxt: { fontSize: 18, color: "#F9FAFB" },
  playBtn: { width: 60, height: 60, borderRadius: 30, justifyContent: "center", alignItems: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  playTxt: { fontSize: 26, color: "#FFFFFF" },

  // Crossfader
  crossfaderWrap: { backgroundColor: "#0D1117", borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#1E293B" },
  crossfaderLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  crossfaderLbl: { fontSize: 11, fontWeight: "700", color: "#6B7280", letterSpacing: 1 },
  crossfaderTrack: { height: 8, backgroundColor: "#1F2937", borderRadius: 4, position: "relative", overflow: "hidden" },
  crossfaderGlowA: { position: "absolute", left: 0, top: 0, bottom: 0, width: "50%", backgroundColor: "#3B82F6", borderRadius: 4 },
  crossfaderGlowB: { position: "absolute", right: 0, top: 0, bottom: 0, width: "50%", backgroundColor: "#8B5CF6", borderRadius: 4 },
  crossfaderKnob: { position: "absolute", top: -4, width: 20, height: 16, borderRadius: 4, backgroundColor: "#F9FAFB", shadowColor: "#FFFFFF", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 4, elevation: 4 },
  crossfaderPct: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", textAlign: "center", marginTop: 6 },

  // Mix indicators
  mixBtn: { backgroundColor: "#1E3A5F", borderRadius: 12, padding: 12, alignItems: "center", borderWidth: 1, borderColor: "#2563EB", marginBottom: 14 },
  mixTxt: { fontSize: 13, fontWeight: "600", color: "#60A5FA", marginBottom: 6 },
  mixProgress: { width: "100%", height: 3, backgroundColor: "#1F2937", borderRadius: 2, overflow: "hidden" },
  mixProgressFill: { height: "100%", backgroundColor: "#2563EB", borderRadius: 2 },

  // Next card
  nextCard: { backgroundColor: "#1F2937", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#374151" },
  nextLbl: { fontSize: 10, fontWeight: "700", color: "#6B7280", letterSpacing: 1.2, marginBottom: 4 },
  nextName: { fontSize: 14, fontWeight: "600", color: "#D1D5DB", marginBottom: 4 },
  nextStats: { fontSize: 12, color: "#6B7280" },
});

const wf = StyleSheet.create({
  container: { position: "relative", marginBottom: 12, height: 32, paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: "100%", gap: 2 },
  bar: { flex: 1, borderRadius: 2, minWidth: 2 },
  playhead: { position: "absolute", top: 0, width: 2, height: "100%", backgroundColor: "#FFFFFF", shadowColor: "#FFFFFF", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 3, elevation: 3 },
  transMarker: { position: "absolute", top: 0, width: 2, height: "100%", backgroundColor: "#FBBF24", opacity: 0.7 },
});
