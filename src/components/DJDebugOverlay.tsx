import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { CuePointSet } from "../services/analysis/cuePointService";
import type { Phrase } from "../services/analysis/phraseDetectionService";
import type { DropPoint, EnergySection } from "../types/audioAnalysis";
import type { SmartMixState } from "../types/transitions";

interface TrackAnalysis {
  bpm: number;
  duration: number;
  beats: number[];
  bars: number[];
  sections: EnergySection[];
  drops: DropPoint[];
  buildups: DropPoint[];
  energy: number;
  phrases: Phrase[];
  phraseData: any;
  cuePoints: CuePointSet | null;
  beatGrid: import("../services/analysis/BeatGrid").BeatGrid | null;
}

interface DJDebugOverlayProps {
  currentAnalysis: TrackAnalysis | null;
  nextAnalysis: TrackAnalysis | null;
  currentPosition: number;
  transitionPoint: number | null;
  isTransitioning: boolean;
  visible: boolean;
  smartMixState?: SmartMixState;
}

/**
 * Visual Debug Overlay — affiche beats, bars, phrases, cue points, etc.
 * Style inspiré de Rekordbox/Traktor.
 */
export const DJDebugOverlay: React.FC<DJDebugOverlayProps> = ({
  currentAnalysis,
  nextAnalysis,
  currentPosition,
  transitionPoint,
  isTransitioning,
  visible,
  smartMixState,
}) => {
  if (!visible || !currentAnalysis) return null;

  const { bpm, duration, beats, bars, phrases, cuePoints, drops, buildups, energy } = currentAnalysis;

  // Position relative
  const progress = duration > 0 ? currentPosition / duration : 0;

  // Phrase actuelle
  const currentPhrase = phrases.find(
    p => currentPosition >= p.startTime && currentPosition < p.endTime
  );

  // Prochain cue
  const nextCue = cuePoints?.cues.find(c => c.timestamp > currentPosition);

  // Prochain downbeat
  const nextBar = bars.find(b => b > currentPosition);

  // Beat phase (position dans la mesure 0-1)
  const beatDuration = bpm > 0 ? 60 / bpm : 0.5;
  const beatPhase = beatDuration > 0 ? (currentPosition % beatDuration) / beatDuration : 0;

  // Phrase phase
  const phrasePhase = currentPhrase
    ? (currentPosition - currentPhrase.startTime) / (currentPhrase.endTime - currentPhrase.startTime)
    : 0;

  // Beats proches (afficher les 8 derniers + 8 prochains)
  const nearBeats = beats.filter(
    b => b >= currentPosition - 4 && b <= currentPosition + 4
  );

  // Downbeat markers visibles
  const nearDownbeats = bars.filter(
    b => b >= currentPosition - 4 && b <= currentPosition + 4
  );

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>DJ DEBUG</Text>
        <View style={s.bpmBadge}>
          <Text style={s.bpmText}>{bpm.toFixed(1)}</Text>
          <Text style={s.bpmLabel}>BPM</Text>
        </View>
        {nextAnalysis && (
          <View style={[s.bpmBadge, s.bpmTarget]}>
            <Text style={s.bpmText}>{nextAnalysis.bpm.toFixed(1)}</Text>
            <Text style={s.bpmLabel}>NEXT</Text>
          </View>
        )}
        <View style={s.energyBadge}>
          <Text style={s.bpmText}>{(energy * 100).toFixed(0)}%</Text>
          <Text style={s.bpmLabel}>NRG</Text>
        </View>
      </View>

      {/* Waveform / Timeline */}
      <View style={s.timeline}>
        {/* Phrase blocks */}
        {phrases.map((phrase, i) => {
          const left = (phrase.startTime / duration) * 100;
          const width = ((phrase.endTime - phrase.startTime) / duration) * 100;
          return (
            <View
              key={`phrase-${i}`}
              style={[
                s.phraseBlock,
                {
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: getPhraseColor(phrase.type),
                  opacity: currentPhrase === phrase ? 1 : 0.4,
                },
              ]}
            />
          );
        })}

        {/* Cue points */}
        {cuePoints?.cues.map((cue, i) => (
          <View
            key={`cue-${i}`}
            style={[
              s.cueMarker,
              {
                left: `${(cue.timestamp / duration) * 100}%`,
                backgroundColor: getCueColor(cue.type),
              },
            ]}
          />
        ))}

        {/* Transition point */}
        {transitionPoint && (
          <View
            style={[
              s.transitionMarker,
              { left: `${(transitionPoint / duration) * 100}%` },
            ]}
          />
        )}

        {/* Current position */}
        <View style={[s.playhead, { left: `${progress * 100}%` }]} />
      </View>

      {/* Labels row */}
      <View style={s.labelsRow}>
        {phrases.map((phrase, i) => {
          const left = (phrase.startTime / duration) * 100;
          const width = ((phrase.endTime - phrase.startTime) / duration) * 100;
          if (width < 5) return null; // Too small to label
          return (
            <Text
              key={`plbl-${i}`}
              style={[s.phraseLabel, { left: `${left}%`, width: `${width}%` }]}
              numberOfLines={1}
            >
              {phrase.type.toUpperCase()}
            </Text>
          );
        })}
      </View>

      {/* Beat grid (close range) */}
      <View style={s.beatGrid}>
        <Text style={s.sectionTitle}>BEATS</Text>
        <View style={s.beatRow}>
          {nearBeats.map((beat, i) => {
            const isDownbeat = bars.includes(beat);
            const isCurrent = Math.abs(beat - currentPosition) < 0.15;
            return (
              <View
                key={`beat-${i}`}
                style={[
                  s.beatDot,
                  isDownbeat && s.downbeatDot,
                  isCurrent && s.currentBeatDot,
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* Info panel */}
      <ScrollView horizontal style={s.infoRow}>
        <InfoChip label="PHRASE" value={currentPhrase?.type?.toUpperCase() ?? "—"} />
        <InfoChip label="BEAT" value={`${(beatPhase * 100).toFixed(0)}%`} />
        <InfoChip label="PHRASE%" value={`${(phrasePhase * 100).toFixed(0)}%`} />
        <InfoChip label="BAR" value={nextBar ? `${(nextBar - currentPosition).toFixed(1)}s` : "—"} />
        <InfoChip label="NEXT CUE" value={nextCue ? `${nextCue.label} ${(nextCue.timestamp - currentPosition).toFixed(0)}s` : "—"} />
        <InfoChip label="TRANS" value={transitionPoint ? `${(transitionPoint - currentPosition).toFixed(0)}s` : "—"} />
        <InfoChip label="DROPS" value={String(drops.length)} />
        <InfoChip label="PHRASES" value={String(phrases.length)} />
        {isTransitioning && <InfoChip label="STATUS" value="MIXING" highlight />}
      </ScrollView>

      {/* Smart Mix Feedback */}
      {smartMixState && (
        <View style={s.smartMixRow}>
          <StatusBadge
            label="BEAT SYNC"
            active={smartMixState.beatSyncLocked}
            color="#22C55E"
          />
          <StatusBadge
            label="PHRASE MATCH"
            active={smartMixState.phraseMatch}
            color="#3B82F6"
          />
          <StatusBadge
            label="TRANSITION READY"
            active={smartMixState.transitionReady}
            color="#F59E0B"
          />
          <StatusBadge
            label="DROP INCOMING"
            active={smartMixState.dropIncoming}
            color="#EF4444"
            pulse
          />
          <StatusBadge
            label="SMART MIX"
            active={smartMixState.smartMixActive}
            color="#8B5CF6"
          />
          <StatusBadge
            label="BASS SWAP"
            active={smartMixState.bassSwapActive}
            color="#EC4899"
          />
          <StatusBadge
            label="VOCAL BLEND"
            active={smartMixState.vocalBlendActive}
            color="#06B6D4"
          />
        </View>
      )}

      {/* Human DJ Intent Feedback */}
      {smartMixState?.humanReason && (
        <View style={s.intentRow}>
          <View style={[s.intentChip, smartMixState.shouldTransition ? s.intentApproved : s.intentWaiting]}>
            <Text style={s.intentEmoji}>
              {smartMixState.shouldTransition ? "✅" : "⏳"}
            </Text>
            <Text style={s.intentLabel}>
              {smartMixState.shouldTransition ? "APPROVED" : "WAITING"}
            </Text>
            <Text style={s.intentScore}>
              {((smartMixState.intentScore ?? 0) * 100).toFixed(0)}%
            </Text>
          </View>
          <View style={s.intentReasonBox}>
            <Text style={s.intentReasonText}>
              {smartMixState.humanReason}
            </Text>
          </View>
          {smartMixState.recommendedAction && smartMixState.recommendedAction !== "transition_now" && (
            <View style={s.intentActionChip}>
              <Text style={s.intentActionText}>
                {smartMixState.recommendedAction === "loop" && "🔁 Loop"}
                {smartMixState.recommendedAction === "build_tension" && "🔥 Tension"}
                {smartMixState.recommendedAction === "wait" && "⏱ Wait"}
                {smartMixState.recommendedAction === "extend" && "➡️ Extend"}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const InfoChip: React.FC<{ label: string; value: string; highlight?: boolean }> = ({
  label,
  value,
  highlight,
}) => (
  <View style={[s.chip, highlight && s.chipHighlight]}>
    <Text style={s.chipLabel}>{label}</Text>
    <Text style={[s.chipValue, highlight && s.chipValueHighlight]}>{value}</Text>
  </View>
);

const StatusBadge: React.FC<{ label: string; active: boolean; color: string; pulse?: boolean }> = ({
  label,
  active,
  color,
  pulse,
}) => (
  <View
    style={[
      s.statusBadge,
      active && { borderColor: color, backgroundColor: `${color}22` },
      pulse && active && s.pulseBadge,
    ]}
  >
    <View style={[s.statusDot, { backgroundColor: active ? color : "#374151" }]} />
    <Text style={[s.statusLabel, { color: active ? color : "#6B7280" }]}>{label}</Text>
  </View>
);

function getPhraseColor(type: string): string {
  switch (type) {
    case "drop": return "#EF4444";
    case "chorus": return "#F59E0B";
    case "buildup": return "#8B5CF6";
    case "breakdown": return "#3B82F6";
    case "intro": return "#10B981";
    case "outro": return "#6B7280";
    case "verse": return "#06B6D4";
    default: return "#374151";
  }
}

function getCueColor(type: string): string {
  switch (type) {
    case "drop": return "#EF4444";
    case "intro": return "#10B981";
    case "outro": return "#6B7280";
    case "transition_out": return "#F59E0B";
    case "transition_in": return "#3B82F6";
    case "emergency": return "#DC2626";
    case "buildup": return "#8B5CF6";
    default: return "#FFFFFF";
  }
}

const s = StyleSheet.create({
  container: {
    backgroundColor: "#0A0F1A",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 10,
    fontWeight: "800",
    color: "#4ADE80",
    letterSpacing: 1.5,
    flex: 1,
  },
  bpmBadge: {
    backgroundColor: "#1E293B",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignItems: "center",
  },
  bpmTarget: {
    borderColor: "#F59E0B",
    borderWidth: 1,
  },
  bpmText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F9FAFB",
  },
  bpmLabel: {
    fontSize: 8,
    fontWeight: "600",
    color: "#6B7280",
    letterSpacing: 0.5,
  },
  energyBadge: {
    backgroundColor: "#1E293B",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignItems: "center",
  },
  timeline: {
    height: 24,
    backgroundColor: "#111827",
    borderRadius: 4,
    position: "relative",
    overflow: "hidden",
    marginBottom: 4,
  },
  phraseBlock: {
    position: "absolute",
    top: 0,
    height: "100%",
    borderRadius: 2,
  },
  cueMarker: {
    position: "absolute",
    top: 0,
    width: 2,
    height: "100%",
  },
  transitionMarker: {
    position: "absolute",
    top: 0,
    width: 2,
    height: "100%",
    backgroundColor: "#FBBF24",
    shadowColor: "#FBBF24",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  playhead: {
    position: "absolute",
    top: 0,
    width: 2,
    height: "100%",
    backgroundColor: "#FFFFFF",
    shadowColor: "#FFFFFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },
  labelsRow: {
    height: 12,
    position: "relative",
    marginBottom: 8,
  },
  phraseLabel: {
    position: "absolute",
    fontSize: 7,
    fontWeight: "700",
    color: "#9CA3AF",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  beatGrid: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 8,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 1,
    marginBottom: 4,
  },
  beatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  beatDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#374151",
  },
  downbeatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#60A5FA",
  },
  currentBeatDot: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#FFFFFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  infoRow: {
    flexDirection: "row",
  },
  chip: {
    backgroundColor: "#1E293B",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    alignItems: "center",
  },
  chipHighlight: {
    backgroundColor: "#7C3AED",
    borderColor: "#A78BFA",
    borderWidth: 1,
  },
  chipLabel: {
    fontSize: 7,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 0.8,
  },
  chipValue: {
    fontSize: 11,
    fontWeight: "600",
    color: "#D1D5DB",
  },
  chipValueHighlight: {
    color: "#FFFFFF",
  },
  smartMixRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#374151",
    backgroundColor: "#1E293B",
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  pulseBadge: {
    shadowColor: "#EF4444",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  intentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  intentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  intentApproved: {
    backgroundColor: "#064E3B",
    borderColor: "#10B981",
  },
  intentWaiting: {
    backgroundColor: "#451A03",
    borderColor: "#F59E0B",
  },
  intentEmoji: {
    fontSize: 12,
  },
  intentLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  intentScore: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
    marginLeft: 2,
  },
  intentReasonBox: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#374151",
  },
  intentReasonText: {
    fontSize: 9,
    color: "#D1D5DB",
    fontWeight: "500",
  },
  intentActionChip: {
    backgroundColor: "#312E81",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#6366F1",
  },
  intentActionText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#C7D2FE",
  },
});
