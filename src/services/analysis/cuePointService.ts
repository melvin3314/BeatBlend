import type { DropPoint, EnergySection } from "../../types/audioAnalysis";
import type { Phrase } from "./phraseDetectionService";

/**
 * Système de cue points automatiques.
 * Comme Rekordbox/Serato : détecte automatiquement les points clés d'un morceau.
 */

export type CueType = "intro" | "drop" | "outro" | "transition_out" | "transition_in" | "emergency" | "buildup" | "breakdown";

export interface CuePoint {
  type: CueType;
  timestamp: number;
  label: string;
  confidence: number;   // 0-1 : fiabilité de la détection
  barAligned: boolean;  // Est-ce que ce point est aligné sur une mesure
  phraseAligned: boolean; // Est-ce que ce point est aligné sur un début de phrase
}

export interface CuePointSet {
  cues: CuePoint[];
  introCue: CuePoint | null;
  dropCues: CuePoint[];
  outroCue: CuePoint | null;
  transitionOutCue: CuePoint | null;
  transitionInCue: CuePoint | null;
  emergencyCue: CuePoint | null;
}

/**
 * Génère automatiquement les cue points d'un morceau.
 */
export function generateCuePoints(
  duration: number,
  beats: number[],
  bars: number[],
  phrases: Phrase[],
  drops: DropPoint[],
  buildups: DropPoint[],
  sections: EnergySection[]
): CuePointSet {
  const cues: CuePoint[] = [];

  // --- INTRO CUE ---
  const introCue = detectIntroCue(beats, bars, phrases, sections);
  if (introCue) cues.push(introCue);

  // --- DROP CUES ---
  const dropCues = detectDropCues(drops, bars, phrases);
  cues.push(...dropCues);

  // --- BUILDUP CUES ---
  const buildupCues = detectBuildupCues(buildups, bars, phrases);
  cues.push(...buildupCues);

  // --- OUTRO CUE ---
  const outroCue = detectOutroCue(duration, bars, phrases, sections);
  if (outroCue) cues.push(outroCue);

  // --- TRANSITION OUT CUE (meilleur point pour sortir) ---
  const transitionOutCue = detectTransitionOutCue(duration, bars, phrases, sections, drops);
  if (transitionOutCue) cues.push(transitionOutCue);

  // --- TRANSITION IN CUE (meilleur point d'entrée) ---
  const transitionInCue = detectTransitionInCue(beats, bars, phrases, drops, buildups);
  if (transitionInCue) cues.push(transitionInCue);

  // --- EMERGENCY CUE (point de sortie d'urgence, ex: silence) ---
  const emergencyCue = detectEmergencyCue(duration, bars, sections);
  if (emergencyCue) cues.push(emergencyCue);

  // Trier par timestamp
  cues.sort((a, b) => a.timestamp - b.timestamp);

  return {
    cues,
    introCue,
    dropCues,
    outroCue,
    transitionOutCue,
    transitionInCue,
    emergencyCue,
  };
}

function detectIntroCue(
  beats: number[],
  bars: number[],
  phrases: Phrase[],
  sections: EnergySection[]
): CuePoint | null {
  // Le premier beat significatif (pas le silence initial)
  const firstBeat = beats.length > 0 ? beats[0] : 0;

  // Ou bien le début de la première phrase non-intro
  const firstContent = phrases.find(p => p.type !== "intro" && p.type !== "unknown");
  if (firstContent) {
    return {
      type: "intro",
      timestamp: firstContent.startTime,
      label: "INTRO",
      confidence: 0.9,
      barAligned: bars.includes(firstContent.startTime),
      phraseAligned: true,
    };
  }

  // Fallback: premier bar
  const ts = bars.length > 0 ? bars[0] : firstBeat;
  return {
    type: "intro",
    timestamp: ts,
    label: "INTRO",
    confidence: 0.6,
    barAligned: true,
    phraseAligned: false,
  };
}

function detectDropCues(
  drops: DropPoint[],
  bars: number[],
  phrases: Phrase[]
): CuePoint[] {
  return drops.map((drop, i) => {
    // Aligner sur la bar la plus proche
    const alignedTime = findClosest(bars, drop.timestamp) ?? drop.timestamp;
    const phraseAligned = phrases.some(p => Math.abs(p.startTime - alignedTime) < 0.2);

    return {
      type: "drop" as CueType,
      timestamp: alignedTime,
      label: `DROP ${i + 1}`,
      confidence: Math.min(1, (drop.energyAfter - drop.energyBefore) + 0.5),
      barAligned: Math.abs(alignedTime - drop.timestamp) < 0.15,
      phraseAligned,
    };
  });
}

function detectBuildupCues(
  buildups: DropPoint[],
  bars: number[],
  phrases: Phrase[]
): CuePoint[] {
  return buildups.slice(0, 4).map((bu, i) => {
    const alignedTime = findClosest(bars, bu.timestamp) ?? bu.timestamp;
    return {
      type: "buildup" as CueType,
      timestamp: alignedTime,
      label: `BUILD ${i + 1}`,
      confidence: 0.7,
      barAligned: Math.abs(alignedTime - bu.timestamp) < 0.15,
      phraseAligned: phrases.some(p => Math.abs(p.startTime - alignedTime) < 0.5),
    };
  });
}

function detectOutroCue(
  duration: number,
  bars: number[],
  phrases: Phrase[],
  sections: EnergySection[]
): CuePoint | null {
  // Chercher la dernière section low energy
  const outroSection = sections.filter(s => s.energyLevel === "low" && s.startTime > duration * 0.7);
  if (outroSection.length > 0) {
    const ts = outroSection[0].startTime;
    return {
      type: "outro",
      timestamp: ts,
      label: "OUTRO",
      confidence: 0.85,
      barAligned: bars.some(b => Math.abs(b - ts) < 0.15),
      phraseAligned: phrases.some(p => Math.abs(p.startTime - ts) < 0.5),
    };
  }

  // Fallback : 80% du morceau
  const ts = duration * 0.8;
  const aligned = findClosest(bars, ts) ?? ts;
  return {
    type: "outro",
    timestamp: aligned,
    label: "OUTRO",
    confidence: 0.5,
    barAligned: true,
    phraseAligned: false,
  };
}

function detectTransitionOutCue(
  duration: number,
  bars: number[],
  phrases: Phrase[],
  sections: EnergySection[],
  drops: DropPoint[]
): CuePoint | null {
  // Zone optimale : 65-90% du morceau
  const windowStart = duration * 0.65;
  const windowEnd = duration * 0.9;

  // Priorité 1 : fin d'un drop/chorus dans la zone
  const goodPhrases = phrases.filter(
    p => (p.type === "drop" || p.type === "chorus") &&
      p.endTime >= windowStart && p.endTime <= windowEnd
  );
  if (goodPhrases.length > 0) {
    const ts = goodPhrases[goodPhrases.length - 1].endTime;
    return {
      type: "transition_out",
      timestamp: ts,
      label: "MIX OUT",
      confidence: 0.95,
      barAligned: bars.some(b => Math.abs(b - ts) < 0.15),
      phraseAligned: true,
    };
  }

  // Priorité 2 : début d'un breakdown dans la zone
  const breakdowns = phrases.filter(
    p => (p.type === "breakdown" || p.type === "outro") &&
      p.startTime >= windowStart && p.startTime <= windowEnd
  );
  if (breakdowns.length > 0) {
    const ts = breakdowns[0].startTime;
    return {
      type: "transition_out",
      timestamp: ts,
      label: "MIX OUT",
      confidence: 0.85,
      barAligned: bars.some(b => Math.abs(b - ts) < 0.15),
      phraseAligned: true,
    };
  }

  // Fallback : 75% aligné sur une phrase
  const target = duration * 0.75;
  const nearPhrase = phrases.find(p => p.startTime >= target);
  const ts = nearPhrase?.startTime ?? target;
  return {
    type: "transition_out",
    timestamp: ts,
    label: "MIX OUT",
    confidence: 0.6,
    barAligned: bars.some(b => Math.abs(b - ts) < 0.15),
    phraseAligned: !!nearPhrase,
  };
}

function detectTransitionInCue(
  beats: number[],
  bars: number[],
  phrases: Phrase[],
  drops: DropPoint[],
  buildups: DropPoint[]
): CuePoint | null {
  // Priorité 1 : premier drop
  if (drops.length > 0 && drops[0].timestamp < 60) {
    const ts = findClosest(bars, drops[0].timestamp) ?? drops[0].timestamp;
    return {
      type: "transition_in",
      timestamp: ts,
      label: "MIX IN",
      confidence: 0.9,
      barAligned: true,
      phraseAligned: phrases.some(p => Math.abs(p.startTime - ts) < 0.5),
    };
  }

  // Priorité 2 : première phrase non-intro
  const firstContent = phrases.find(p => p.type !== "intro" && p.type !== "unknown");
  if (firstContent) {
    return {
      type: "transition_in",
      timestamp: firstContent.startTime,
      label: "MIX IN",
      confidence: 0.85,
      barAligned: true,
      phraseAligned: true,
    };
  }

  // Fallback : début
  return {
    type: "transition_in",
    timestamp: bars.length > 0 ? bars[0] : 0,
    label: "MIX IN",
    confidence: 0.5,
    barAligned: true,
    phraseAligned: false,
  };
}

function detectEmergencyCue(
  duration: number,
  bars: number[],
  sections: EnergySection[]
): CuePoint | null {
  // Point d'urgence = dernière zone de silence/faible énergie avant la fin
  const lastLow = sections
    .filter(s => s.energyLevel === "low" && s.startTime > duration * 0.5)
    .pop();

  if (lastLow) {
    return {
      type: "emergency",
      timestamp: lastLow.startTime,
      label: "EMERGENCY",
      confidence: 0.7,
      barAligned: bars.some(b => Math.abs(b - lastLow.startTime) < 0.15),
      phraseAligned: false,
    };
  }

  // Fallback : 5 secondes avant la fin
  const ts = Math.max(0, duration - 5);
  return {
    type: "emergency",
    timestamp: ts,
    label: "EMERGENCY",
    confidence: 0.4,
    barAligned: false,
    phraseAligned: false,
  };
}

// --- Helpers ---

function findClosest(arr: number[], target: number): number | null {
  if (arr.length === 0) return null;
  let closest = arr[0];
  let minDiff = Math.abs(target - closest);
  for (let i = 1; i < arr.length; i++) {
    const diff = Math.abs(target - arr[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = arr[i];
    }
  }
  return closest;
}
