/**
 * BeatAlignmentEngine
 * Moteur professionnel d'alignement rythmique entre deux morceaux.
 *
 * Capacités :
 * - Aligner beats et mesures
 * - Calculer offsets de seek précis
 * - Synchroniser les phrases
 * - Corriger le drift BPM
 * - Gérer les transitions musicales
 */

import type { BeatGrid } from "./BeatGrid";
import { findNearestDownbeat, getBeatPhase } from "./BeatGrid";

export interface AlignmentResult {
  /** Position de seek dans B (secondes) */
  seekPosition: number;
  /** Offset en ms (positif = retarder B, négatif = avancer B) */
  beatOffsetMs: number;
  /** Rate adjustment pour B (1.0 = natif) */
  rateAdjustment: number;
  /** Les downbeats sont alignés */
  downbeatAligned: boolean;
  /** Les phrases sont alignées */
  phraseAligned: boolean;
  /** Confiance globale 0-1 */
  confidence: number;
  /** Méthode utilisée */
  method: "phrase" | "downbeat" | "beat_phase" | "bpm_sync" | "fallback";
  /** Drift BPM corrigé */
  driftCorrection: {
    applied: boolean;
    bpmA: number;
    bpmB: number;
    targetRate: number;
  };
}

export interface TransitionContext {
  gridA: BeatGrid;
  gridB: BeatGrid;
  outPointA: number;       // Point de sortie dans A
  desiredOverlapBars: number; // Nombre de bars de superposition
}

/**
 * Aligne le morceau B sur le morceau A pour une transition musicalement parfaite.
 */
export function alignTracks(context: TransitionContext): AlignmentResult {
  const { gridA, gridB, outPointA } = context;

  // 1. Essayer l'alignement par phrase (le plus musical)
  const phraseResult = alignByPhrase(gridA, gridB, outPointA);
  if (phraseResult.confidence > 0.8) {
    return phraseResult;
  }

  // 2. Essayer l'alignement par downbeat
  const downbeatResult = alignByDownbeat(gridA, gridB, outPointA);
  if (downbeatResult.confidence > 0.7) {
    return downbeatResult;
  }

  // 3. Alignement par phase beat
  const beatResult = alignByBeatPhase(gridA, gridB, outPointA);
  if (beatResult.confidence > 0.5) {
    return beatResult;
  }

  // 4. Fallback : simple BPM sync
  return alignByBpmSync(gridA, gridB, outPointA);
}

// --- 1. Phrase Alignment (recherche globale dans B) ---

function alignByPhrase(gridA: BeatGrid, gridB: BeatGrid, outPointA: number): AlignmentResult {
  if (gridA.phrases.length === 0 || gridB.phrases.length === 0) {
    return fallbackResult(gridA, gridB);
  }

  // Trouver la phrase de sortie dans A
  const outPhrase = gridA.phrases.find(
    (p) => outPointA >= p.startTime && outPointA <= p.endTime
  );
  if (!outPhrase) return fallbackResult(gridA, gridB);

  // Phase beat au point de sortie dans A (0-1)
  const beatDurationA = 60 / gridA.bpm;
  const phaseA = (outPointA % beatDurationA) / beatDurationA;

  // Scorer TOUTES les phrases de B pour trouver la meilleure entrée
  const targetType = mapPhraseType(outPhrase.type);
  const beatDurationB = 60 / gridB.bpm;
  let bestScore = -Infinity;
  let bestSeek = 0;
  let bestPhrase: typeof gridB.phrases[0] | null = null;

  for (const phrase of gridB.phrases) {
    // Ignorer les phrases trop proches de la fin (outro)
    if (phrase.startTime > gridB.duration * 0.75) continue;

    // Aligner sur le downbeat le plus proche du début de phrase
    const rawSeek = phrase.startTime;
    const seekPosition = findNearestDownbeat(gridB, rawSeek) ?? rawSeek;

    // Phase beat à ce point d'entrée
    const phaseB = (seekPosition % beatDurationB) / beatDurationB;
    let phaseDiff = Math.abs(phaseA - phaseB);
    phaseDiff = Math.min(phaseDiff, 1 - phaseDiff);
    const phaseScore = 1 - phaseDiff; // 1 = parfait, 0 = décalé d'un demi-beat

    // Score par type de phrase (drop/buildup préférés aux intros)
    let typeScore = 0;
    if (phrase.type === targetType) typeScore = 1.0;
    else if (phrase.type === "drop") typeScore = 1.0;
    else if (phrase.type === "buildup") typeScore = 0.95;
    else if (phrase.type === "intro") typeScore = 0.7;
    else if (phrase.type === "verse") typeScore = 0.6;
    else if (phrase.type === "chorus") typeScore = 0.5;
    else if (phrase.type === "outro") typeScore = 0.1;

    // Position : léger tie-breaker, pas un facteur dominant
    const positionScore = 1 - (seekPosition / gridB.duration);

    // Score combiné pondéré (phase et type dominent, position est tie-breaker)
    const score = phaseScore * 0.50 + typeScore * 0.40 + positionScore * 0.05;

    if (score > bestScore) {
      bestScore = score;
      bestSeek = seekPosition;
      bestPhrase = phrase;
    }
  }

  // Si aucune phrase trouvée (trop loin ?), fallback
  if (!bestPhrase) return fallbackResult(gridA, gridB);

  const seekPosition = bestSeek;

  // Calculer l'offset pour que le prochain downbeat de B arrive avec celui de A
  const nextDownbeatA = gridA.downbeats.find((d) => d >= outPointA) ?? outPointA;
  const nextDownbeatB = gridB.downbeats.find((d) => d >= seekPosition) ?? seekPosition;
  const beatOffsetMs = (nextDownbeatA - outPointA - (nextDownbeatB - seekPosition)) * 1000;

  // Drift correction
  const drift = computeDriftCorrection(gridA, gridB);

  return {
    seekPosition,
    beatOffsetMs,
    rateAdjustment: drift.targetRate,
    downbeatAligned: true,
    phraseAligned: true,
    confidence: Math.min(0.95, 0.6 + bestScore * 0.35),
    method: "phrase",
    driftCorrection: drift,
  };
}

// --- 2. Downbeat Alignment ---

function alignByDownbeat(gridA: BeatGrid, gridB: BeatGrid, outPointA: number): AlignmentResult {
  if (gridA.downbeats.length === 0 || gridB.downbeats.length === 0) {
    return fallbackResult(gridA, gridB);
  }

  // Prochain downbeat dans A après le point de sortie
  const nextDownbeatA = gridA.downbeats.find((d) => d >= outPointA);
  if (!nextDownbeatA) return fallbackResult(gridA, gridB);

  // Temps restant avant le prochain downbeat de A
  const timeToDownbeat = nextDownbeatA - outPointA;

  // Premier downbeat musical de B (skip le silence initial)
  const firstDownbeatB = gridB.downbeats.find((d) => d > 0.5) ?? gridB.downbeats[0] ?? 0;

  // On veut que B démarre de sorte que son premier downbeat arrive
  // exactement au même moment que le prochain downbeat de A
  const seekPosition = firstDownbeatB;

  // Offset = temps qu'il faut attendre entre le start de B et le downbeat de A
  const beatOffsetMs = -timeToDownbeat * 1000; // B démarre avant A finit

  const drift = computeDriftCorrection(gridA, gridB);

  return {
    seekPosition,
    beatOffsetMs,
    rateAdjustment: drift.targetRate,
    downbeatAligned: true,
    phraseAligned: false,
    confidence: 0.8,
    method: "downbeat",
    driftCorrection: drift,
  };
}

// --- 3. Beat Phase Alignment (recherche globale dans B) ---

function alignByBeatPhase(gridA: BeatGrid, gridB: BeatGrid, outPointA: number): AlignmentResult {
  if (gridA.beats.length === 0 || gridB.beats.length === 0) {
    return fallbackResult(gridA, gridB);
  }

  // Phase du beat grid de A au point de sortie
  const phaseA = getBeatPhase(gridA, outPointA);
  const beatDurationB = 60 / gridB.bpm;

  // Trouver le beat dans B dont la phase est la plus proche
  // On cherche dans tout le morceau mais préfère les premières 60%
  let bestScore = -Infinity;
  let bestSeek = gridB.beats[0] ?? 0;
  let bestPhaseDiff = 1;

  for (const beatB of gridB.beats) {
    if (beatB > gridB.duration * 0.7) continue; // Éviter la fin

    const phaseB = (beatB % beatDurationB) / beatDurationB;
    const phaseDiff = Math.abs(phaseA - phaseB);
    const wrappedDiff = Math.min(phaseDiff, 1 - phaseDiff);
    const phaseScore = 1 - wrappedDiff;

    // Downbeat bonus (si c'est un downbeat, meilleur score)
    const isDownbeat = gridB.downbeats.some((d) => Math.abs(d - beatB) < 0.01);
    const downbeatBonus = isDownbeat ? 0.2 : 0;

    // Position : léger tie-breaker seulement
    const positionScore = 1 - (beatB / (gridB.duration * 0.7));

    // Phrase type bonus (drop/buildup préférés)
    let phraseBonus = 0;
    const phraseAt = gridB.phrases.find((p) => beatB >= p.startTime && beatB <= p.endTime);
    if (phraseAt) {
      if (phraseAt.type === "drop") phraseBonus = 0.15;
      else if (phraseAt.type === "buildup") phraseBonus = 0.12;
      else if (phraseAt.type === "intro") phraseBonus = 0.02;
      else if (phraseAt.type === "outro") phraseBonus = -0.3; // Forte pénalité
    }

    const score = phaseScore * 0.65 + positionScore * 0.05 + downbeatBonus + phraseBonus;

    if (score > bestScore) {
      bestScore = score;
      bestSeek = beatB;
      bestPhaseDiff = wrappedDiff;
    }
  }

  const drift = computeDriftCorrection(gridA, gridB);

  return {
    seekPosition: bestSeek,
    beatOffsetMs: bestPhaseDiff * beatDurationB * 1000,
    rateAdjustment: drift.targetRate,
    downbeatAligned: bestPhaseDiff < 0.1,
    phraseAligned: false,
    confidence: Math.min(0.8, 0.4 + bestScore * 0.4),
    method: "beat_phase",
    driftCorrection: drift,
  };
}

// --- 4. BPM Sync Fallback ---

function alignByBpmSync(gridA: BeatGrid, gridB: BeatGrid, outPointA: number): AlignmentResult {
  const drift = computeDriftCorrection(gridA, gridB);
  const seekPosition = findNearestDownbeat(gridB, 0) ?? 0;

  return {
    seekPosition,
    beatOffsetMs: 0,
    rateAdjustment: drift.targetRate,
    downbeatAligned: false,
    phraseAligned: false,
    confidence: 0.3,
    method: "bpm_sync",
    driftCorrection: drift,
  };
}

// --- Drift Correction ---

function computeDriftCorrection(gridA: BeatGrid, gridB: BeatGrid) {
  const bpmA = gridA.bpm;
  const bpmB = gridB.bpm;

  // Si les BPM sont très proches, pas besoin de correction
  const bpmDiff = Math.abs(bpmA - bpmB);
  if (bpmDiff < 2) {
    return {
      applied: false,
      bpmA,
      bpmB,
      targetRate: 1.0,
    };
  }

  // Calculer le rate pour que B joue au tempo de A pendant la transition
  // Puis revient progressivement à son tempo natif
  const targetRate = bpmA / bpmB;

  return {
    applied: true,
    bpmA,
    bpmB,
    targetRate,
  };
}

// --- Helpers ---

function fallbackResult(gridA: BeatGrid, gridB: BeatGrid): AlignmentResult {
  const drift = computeDriftCorrection(gridA, gridB);
  return {
    seekPosition: 0,
    beatOffsetMs: 0,
    rateAdjustment: drift.targetRate,
    downbeatAligned: false,
    phraseAligned: false,
    confidence: 0.2,
    method: "fallback",
    driftCorrection: drift,
  };
}

function mapPhraseType(type: string): string {
  const mapping: Record<string, string> = {
    outro: "intro",
    drop: "buildup",
    chorus: "verse",
    buildup: "drop",
    breakdown: "buildup",
    verse: "chorus",
    intro: "intro",
  };
  return mapping[type] ?? "intro";
}

/**
 * Applique un rate adjustment progressif (micro drift correction).
 * Retourne la liste des rates à appliquer pour une transition douce.
 */
export function computeRateRamp(
  fromRate: number,
  toRate: number,
  steps: number
): number[] {
  const rates: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Easing easeInOutCubic
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    rates.push(fromRate + (toRate - fromRate) * eased);
  }
  return rates;
}

/**
 * Calcule la durée de transition optimale en bars.
 * Basé sur les BPM, la structure, et les phrases.
 */
export function computeOptimalTransitionBars(
  gridA: BeatGrid,
  gridB: BeatGrid,
  confidence: number
): number {
  const baseBars = 8;

  // Si les phrases sont alignées, on peut faire une transition plus longue
  if (confidence > 0.8) return 16;
  if (confidence > 0.6) return 12;

  // Si les BPM sont très différents, transition plus courte
  const bpmDiff = Math.abs(gridA.bpm - gridB.bpm);
  if (bpmDiff > 15) return 4;
  if (bpmDiff > 8) return 6;

  return baseBars;
}
