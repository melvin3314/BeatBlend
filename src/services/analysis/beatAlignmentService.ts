import type { Phrase } from "./phraseDetectionService";
import type { CuePointSet } from "./cuePointService";

/**
 * Beat Alignment Service
 * 
 * Calcule le point de seek précis dans le morceau B pour que les beats
 * soient parfaitement alignés avec le morceau A au moment de la transition.
 * 
 * Principe :
 * - On connaît le beat grid de A et B (timestamps des beats)
 * - Au moment du mix, on veut que le prochain beat de B arrive EXACTEMENT
 *   quand le prochain beat de A arrive
 * - On calcule l'offset de seek nécessaire pour réaliser cet alignement
 */

export interface BeatAlignmentResult {
  seekPosition: number;       // Position exacte de seek dans le track B (secondes)
  beatOffset: number;         // Décalage appliqué pour aligner les beats (ms)
  downbeatAligned: boolean;   // Les downbeats (beat 1) sont-ils alignés ?
  phraseAligned: boolean;     // Les phrases sont-elles alignées ?
  confidence: number;         // 0-1
  alignmentMethod: "phrase" | "downbeat" | "beat" | "cue" | "fallback";
}

export interface TransitionAlignment {
  outPoint: number;           // Point de sortie track A (secondes)
  inPoint: number;            // Point d'entrée track B après alignment (secondes)
  overlapDuration: number;    // Durée de la superposition (secondes)
  beatAlignment: BeatAlignmentResult;
}

/**
 * Calcule l'alignement optimal entre deux morceaux pour une transition.
 * 
 * Hiérarchie de précision :
 * 1. Phrase matching (le plus musical)
 * 2. Cue point alignment  
 * 3. Downbeat alignment (beat 1 sur beat 1)
 * 4. Beat grid alignment (n'importe quel beat)
 * 5. Fallback (pas d'alignement)
 */
export function calculateBeatAlignment(
  beatsA: number[],
  beatsB: number[],
  barsA: number[],
  barsB: number[],
  phrasesA: Phrase[],
  phrasesB: Phrase[],
  cuesA: CuePointSet | null,
  cuesB: CuePointSet | null,
  outPointA: number,
  bpmA: number,
  bpmB: number
): TransitionAlignment {
  // 1. Essayer le phrase matching
  const phraseResult = tryPhraseAlignment(phrasesA, phrasesB, outPointA, beatsB, barsB);
  if (phraseResult && phraseResult.confidence > 0.8) {
    return buildTransitionAlignment(outPointA, phraseResult, bpmA, bpmB);
  }

  // 2. Essayer l'alignement par cue points
  const cueResult = tryCuePointAlignment(cuesA, cuesB, beatsB, barsB, outPointA);
  if (cueResult && cueResult.confidence > 0.7) {
    return buildTransitionAlignment(outPointA, cueResult, bpmA, bpmB);
  }

  // 3. Essayer l'alignement downbeat
  const downbeatResult = tryDownbeatAlignment(beatsA, beatsB, barsA, barsB, outPointA, bpmA, bpmB);
  if (downbeatResult && downbeatResult.confidence > 0.6) {
    return buildTransitionAlignment(outPointA, downbeatResult, bpmA, bpmB);
  }

  // 4. Alignement beat simple
  const beatResult = tryBeatAlignment(beatsA, beatsB, outPointA, bpmA, bpmB);
  if (beatResult) {
    return buildTransitionAlignment(outPointA, beatResult, bpmA, bpmB);
  }

  // 5. Fallback
  const fallback: BeatAlignmentResult = {
    seekPosition: 0,
    beatOffset: 0,
    downbeatAligned: false,
    phraseAligned: false,
    confidence: 0.3,
    alignmentMethod: "fallback",
  };
  return buildTransitionAlignment(outPointA, fallback, bpmA, bpmB);
}

/**
 * Phrase alignment : aligne le début d'une phrase dans B avec la fin d'une phrase dans A.
 */
function tryPhraseAlignment(
  phrasesA: Phrase[],
  phrasesB: Phrase[],
  outPointA: number,
  beatsB: number[],
  barsB: number[]
): BeatAlignmentResult | null {
  if (phrasesA.length === 0 || phrasesB.length === 0) return null;

  // Trouver la phrase dans A qui contient le point de sortie
  const outPhrase = phrasesA.find(p => p.startTime <= outPointA && p.endTime >= outPointA);
  if (!outPhrase) return null;

  // Chercher la meilleure phrase d'entrée dans B
  // Matching par type : drop → drop, breakdown → buildup, etc.
  const compatibleTypes = getCompatiblePhraseTypes(outPhrase.type);
  let targetPhrase = phrasesB.find(p => compatibleTypes.includes(p.type));

  // Fallback : première phrase avec énergie similaire
  if (!targetPhrase) {
    targetPhrase = phrasesB.find(p => Math.abs(p.energy - outPhrase.energy) < 0.3);
  }
  if (!targetPhrase) {
    targetPhrase = phrasesB[0];
  }

  // Aligner sur le beat le plus proche du début de la phrase cible
  const seekPos = targetPhrase.startTime;
  const nearestBeat = findClosestBeat(beatsB, seekPos);
  const alignedSeek = nearestBeat ?? seekPos;

  return {
    seekPosition: alignedSeek,
    beatOffset: (alignedSeek - seekPos) * 1000,
    downbeatAligned: barsB.some(b => Math.abs(b - alignedSeek) < 0.05),
    phraseAligned: true,
    confidence: 0.9,
    alignmentMethod: "phrase",
  };
}

/**
 * Cue point alignment : utiliser les cue points calculés.
 */
function tryCuePointAlignment(
  cuesA: CuePointSet | null,
  cuesB: CuePointSet | null,
  beatsB: number[],
  barsB: number[],
  outPointA: number
): BeatAlignmentResult | null {
  if (!cuesB?.transitionInCue) return null;

  const inCue = cuesB.transitionInCue;
  const nearestBar = findClosest(barsB, inCue.timestamp);
  const seekPos = nearestBar ?? inCue.timestamp;

  return {
    seekPosition: seekPos,
    beatOffset: 0,
    downbeatAligned: barsB.some(b => Math.abs(b - seekPos) < 0.05),
    phraseAligned: inCue.phraseAligned,
    confidence: inCue.confidence,
    alignmentMethod: "cue",
  };
}

/**
 * Downbeat alignment : aligner beat 1 de A avec beat 1 de B.
 */
function tryDownbeatAlignment(
  beatsA: number[],
  beatsB: number[],
  barsA: number[],
  barsB: number[],
  outPointA: number,
  bpmA: number,
  bpmB: number
): BeatAlignmentResult | null {
  if (barsA.length === 0 || barsB.length === 0) return null;

  // Trouver le prochain downbeat dans A après le point de sortie
  const nextDownbeatA = barsA.find(b => b >= outPointA);
  if (!nextDownbeatA) return null;

  // Temps entre outPoint et le prochain downbeat de A
  const timeToDownbeat = nextDownbeatA - outPointA;

  // Le BPM ratio détermine le timing
  const bpmRatio = bpmA / bpmB;

  // On veut démarrer B de façon que son premier downbeat arrive
  // exactement quand le downbeat de A arrive
  // Si B joue à un rate légèrement différent, on compense par le seek

  // Trouver le premier downbeat de B (pour intro skip)
  const firstContentBar = barsB.find(b => b > 0.5) ?? barsB[0] ?? 0;

  // Calculer le décalage beat
  const beatDurationA = 60 / bpmA;
  const offset = timeToDownbeat % beatDurationA;

  return {
    seekPosition: firstContentBar,
    beatOffset: offset * 1000,
    downbeatAligned: true,
    phraseAligned: false,
    confidence: 0.75,
    alignmentMethod: "downbeat",
  };
}

/**
 * Beat alignment simple : aligner n'importe quel beat de B avec le grid de A.
 */
function tryBeatAlignment(
  beatsA: number[],
  beatsB: number[],
  outPointA: number,
  bpmA: number,
  bpmB: number
): BeatAlignmentResult | null {
  if (beatsA.length === 0 || beatsB.length === 0) return null;

  // Trouver le prochain beat dans A après outPoint
  const nextBeatA = beatsA.find(b => b >= outPointA);
  if (!nextBeatA) return null;

  // Phase du beat grid de A au point de sortie
  const beatDurationA = 60 / bpmA;
  const phaseA = (outPointA % beatDurationA) / beatDurationA;

  // Trouver le beat dans B dont la phase est la plus proche
  const beatDurationB = 60 / bpmB;
  let bestSeek = beatsB[0] ?? 0;
  let bestPhaseDiff = 1;

  for (const beatB of beatsB) {
    if (beatB > 30) break; // Pas trop loin dans le morceau pour l'entrée
    const phaseB = (beatB % beatDurationB) / beatDurationB;
    const phaseDiff = Math.abs(phaseA - phaseB);
    const wrappedDiff = Math.min(phaseDiff, 1 - phaseDiff);

    if (wrappedDiff < bestPhaseDiff) {
      bestPhaseDiff = wrappedDiff;
      bestSeek = beatB;
    }
  }

  return {
    seekPosition: bestSeek,
    beatOffset: bestPhaseDiff * beatDurationB * 1000,
    downbeatAligned: false,
    phraseAligned: false,
    confidence: bestPhaseDiff < 0.1 ? 0.7 : 0.5,
    alignmentMethod: "beat",
  };
}

// --- Helpers ---

function buildTransitionAlignment(
  outPoint: number,
  alignment: BeatAlignmentResult,
  bpmA: number,
  bpmB: number
): TransitionAlignment {
  // Durée de superposition basée sur les BPM
  const avgBpm = (bpmA + bpmB) / 2;
  const barsOverlap = 8; // 8 bars de transition
  const overlapDuration = (barsOverlap * 4 * 60) / avgBpm;

  return {
    outPoint,
    inPoint: alignment.seekPosition,
    overlapDuration,
    beatAlignment: alignment,
  };
}

function getCompatiblePhraseTypes(type: Phrase["type"]): Phrase["type"][] {
  switch (type) {
    case "drop": return ["drop", "chorus"];
    case "chorus": return ["drop", "chorus", "buildup"];
    case "breakdown": return ["buildup", "drop"];
    case "buildup": return ["drop", "chorus"];
    case "outro": return ["intro", "buildup", "drop"];
    case "intro": return ["drop", "buildup", "chorus"];
    default: return ["drop", "buildup", "chorus", "verse"];
  }
}

function findClosestBeat(beats: number[], target: number): number | null {
  if (beats.length === 0) return null;
  let closest = beats[0];
  let minDiff = Math.abs(target - closest);
  for (const b of beats) {
    const diff = Math.abs(target - b);
    if (diff < minDiff) {
      minDiff = diff;
      closest = b;
    }
  }
  return closest;
}

function findClosest(arr: number[], target: number): number | null {
  if (arr.length === 0) return null;
  let closest = arr[0];
  let minDiff = Math.abs(target - closest);
  for (const v of arr) {
    const diff = Math.abs(target - v);
    if (diff < minDiff) {
      minDiff = diff;
      closest = v;
    }
  }
  return closest;
}
