/**
 * SmartTransitionTimer
 * Détermine le moment musical optimal pour déclencher une transition.
 *
 * Règles musicales :
 * - Toujours démarrer sur un downbeat
 * - Préférer le début d'une phrase
 * - Éviter de couper au milieu d'un kick/buildup
 * - Anticiper le mix (ex: 16 bars avant la fin)
 * - Synchroniser les phrases A→B
 */

import type { BeatGrid } from "./BeatGrid";
import { barDistance, getNextDownbeat, getPhraseAt, isOnDownbeat } from "./BeatGrid";
import type { Phrase } from "./phraseDetectionService";

export interface TransitionTiming {
  /** Quand démarrer le mix (seconds depuis le début du morceau A) */
  triggerTime: number;
  /** Point de sortie de A (seconds) */
  outPoint: number;
  /** Point d'entrée de B (seconds) */
  inPoint: number;
  /** Durée de superposition en secondes */
  overlapDuration: number;
  /** Nombre de bars de superposition */
  overlapBars: number;
  /** Le point est-il aligné sur un downbeat ? */
  downbeatAligned: boolean;
  /** Le point est-il au début d'une phrase ? */
  phraseAligned: boolean;
  /** Méthode utilisée */
  method: "phrase_end" | "phrase_start" | "downbeat" | "outro" | "fixed";
  /** Confiance 0-1 */
  confidence: number;
}

/**
 * Calcule le timing optimal pour une transition entre A et B.
 *
 * Stratégie hiérarchique :
 * 1. Phrase matching : fin de phrase A → début de phrase B
 * 2. Downbeat alignment : prochain downbeat cohérent
 * 3. Outro fallback : si A est en outro
 * 4. Fixed fallback : 30s avant la fin
 */
export function computeTransitionTiming(
  gridA: BeatGrid,
  gridB: BeatGrid,
  currentPosition: number, // Position actuelle dans A
  targetOutPoint?: number   // Point de sortie souhaité (optionnel)
): TransitionTiming {
  const barDurationA = (60 / gridA.bpm) * gridA.beatsPerBar;
  const barDurationB = (60 / gridB.bpm) * gridB.beatsPerBar;
  const avgBarDuration = (barDurationA + barDurationB) / 2;

  // --- 1. PHRASE MATCHING (le plus musical) ---
  const phraseTiming = tryPhraseMatching(gridA, gridB, currentPosition, avgBarDuration, targetOutPoint);
  if (phraseTiming && phraseTiming.confidence > 0.8) {
    return phraseTiming;
  }

  // --- 2. DOWNBEAT ALIGNMENT ---
  const downbeatTiming = tryDownbeatAlignment(gridA, gridB, currentPosition, avgBarDuration, targetOutPoint);
  if (downbeatTiming && downbeatTiming.confidence > 0.6) {
    return downbeatTiming;
  }

  // --- 3. OUTRO FALLBACK ---
  const outroTiming = tryOutroFallback(gridA, gridB, currentPosition, avgBarDuration);
  if (outroTiming) {
    return outroTiming;
  }

  // --- 4. FIXED FALLBACK ---
  return createFixedTiming(gridA, gridB, currentPosition, avgBarDuration);
}

// --- Stratégie 1 : Phrase Matching ---

function tryPhraseMatching(
  gridA: BeatGrid,
  gridB: BeatGrid,
  currentPos: number,
  avgBarDuration: number,
  targetOutPoint?: number
): TransitionTiming | null {
  if (gridA.phrases.length === 0 || gridB.phrases.length === 0) return null;

  // Phrase actuelle dans A
  const currentPhrase = getPhraseAt(gridA, currentPos);
  if (!currentPhrase) return null;

  // Point de sortie idéal : fin de la phrase actuelle ou prochaine
  let outPoint = targetOutPoint ?? currentPhrase.endTime;

  // Si on est encore au début de la phrase, attendre la fin de la SUIVANTE
  // pour ne pas couper trop tôt
  const phraseProgress = (currentPos - currentPhrase.startTime) / (currentPhrase.endTime - currentPhrase.startTime);
  if (phraseProgress < 0.5) {
    const nextPhrase = gridA.phrases.find((p) => p.startTime > currentPhrase.endTime);
    if (nextPhrase) {
      outPoint = nextPhrase.endTime;
    }
  }

  // Aligner le outPoint sur un downbeat
  const alignedOut = alignToDownbeat(gridA, outPoint);

  // Trouver la meilleure phrase d'entrée dans B
  // Priorité : drop → buildup → chorus → intro → verse
  const targetTypes: Phrase["type"][] = ["drop", "buildup", "chorus", "verse", "intro"];
  let bestInPhrase = gridB.phrases[0];

  for (const type of targetTypes) {
    const match = gridB.phrases.find((p) => p.type === type);
    if (match) {
      bestInPhrase = match;
      break;
    }
  }

  const inPoint = bestInPhrase.startTime;
  const overlapBars = barDistance(gridA, alignedOut - 16 * avgBarDuration, alignedOut);
  const overlapDuration = overlapBars * avgBarDuration;
  const triggerTime = Math.max(currentPos, alignedOut - overlapDuration);

  return {
    triggerTime,
    outPoint: alignedOut,
    inPoint,
    overlapDuration,
    overlapBars: Math.max(8, overlapBars),
    downbeatAligned: isOnDownbeat(gridA, alignedOut),
    phraseAligned: true,
    method: "phrase_end",
    confidence: 0.9,
  };
}

// --- Stratégie 2 : Downbeat Alignment ---

function tryDownbeatAlignment(
  gridA: BeatGrid,
  gridB: BeatGrid,
  currentPos: number,
  avgBarDuration: number,
  targetOutPoint?: number
): TransitionTiming | null {
  if (gridA.downbeats.length === 0 || gridB.downbeats.length === 0) return null;

  // Prochain downbeat dans A
  const nextDownbeatA = getNextDownbeat(gridA, currentPos);
  if (!nextDownbeatA) return null;

  // On veut démarrer le mix à ce downbeat
  const outPoint = targetOutPoint ?? nextDownbeatA;

  // Prochain downbeat dans B pour l'entrée
  const firstContentDownbeat = gridB.downbeats.find((d) => d > 0.5) ?? gridB.downbeats[0] ?? 0;

  // Nombre de bars de transition : 12 bars par défaut
  const overlapBars = 12;
  const overlapDuration = overlapBars * avgBarDuration;
  const triggerTime = Math.max(currentPos, outPoint - overlapDuration);

  return {
    triggerTime,
    outPoint,
    inPoint: firstContentDownbeat,
    overlapDuration,
    overlapBars,
    downbeatAligned: true,
    phraseAligned: false,
    method: "downbeat",
    confidence: 0.75,
  };
}

// --- Stratégie 3 : Outro Fallback ---

function tryOutroFallback(
  gridA: BeatGrid,
  gridB: BeatGrid,
  currentPos: number,
  avgBarDuration: number
): TransitionTiming | null {
  const currentPhrase = getPhraseAt(gridA, currentPos);
  if (!currentPhrase || currentPhrase.type !== "outro") return null;

  const outPoint = gridA.duration - 2; // 2s avant la fin
  const alignedOut = alignToDownbeat(gridA, outPoint);
  const overlapBars = 8;
  const overlapDuration = overlapBars * avgBarDuration;

  return {
    triggerTime: Math.max(currentPos, alignedOut - overlapDuration),
    outPoint: alignedOut,
    inPoint: gridB.downbeats[0] ?? 0,
    overlapDuration,
    overlapBars,
    downbeatAligned: true,
    phraseAligned: false,
    method: "outro",
    confidence: 0.6,
  };
}

// --- Stratégie 4 : Fixed Fallback ---

function createFixedTiming(
  gridA: BeatGrid,
  gridB: BeatGrid,
  currentPos: number,
  avgBarDuration: number
): TransitionTiming {
  const outPoint = Math.min(gridA.duration - 2, currentPos + 30);
  const alignedOut = alignToDownbeat(gridA, outPoint);
  const overlapBars = 12;
  const overlapDuration = overlapBars * avgBarDuration;

  return {
    triggerTime: Math.max(currentPos, alignedOut - overlapDuration),
    outPoint: alignedOut,
    inPoint: gridB.downbeats[0] ?? 0,
    overlapDuration,
    overlapBars,
    downbeatAligned: isOnDownbeat(gridA, alignedOut),
    phraseAligned: false,
    method: "fixed",
    confidence: 0.4,
  };
}

// --- Helpers ---

/** Aligne un timestamp sur le downbeat le plus proche */
function alignToDownbeat(grid: BeatGrid, time: number): number {
  let best = time;
  let bestDiff = Infinity;
  for (const d of grid.downbeats) {
    const diff = Math.abs(d - time);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}
