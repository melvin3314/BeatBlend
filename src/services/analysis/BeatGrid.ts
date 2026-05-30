/**
 * BeatGrid
 * Représentation unifiée du grid rythmique d'un morceau.
 * Pré-calculée, stockable en cache, utilisée pour les alignements.
 *
 * Structure : beats → bars (downbeats) → phrases (4/8/16/32 bars)
 */

import type { Phrase, PhraseDetectionResult } from "./phraseDetectionService";

export interface BeatGrid {
  bpm: number;
  /** Durée totale du morceau en secondes */
  duration: number;
  /** Tous les beats (timestamps en secondes) */
  beats: number[];
  /** Downbeats = débuts de mesure (beat 1) */
  downbeats: number[];
  /** Débuts de bars (synonyme de downbeats ici) */
  bars: number[];
  /** Beats par mesure (généralement 4) */
  beatsPerBar: number;
  /** Phrases détectées */
  phrases: Phrase[];
  /** Longueur dominante de phrase en bars */
  phraseLengthBars: number;
  /** Timestamps des débuts de phrases */
  phraseStarts: number[];
  /** Cue points générés */
  cuePoints: import("./cuePointService").CuePointSet | null;
}

/** Crée un BeatGrid à partir des résultats d'analyse */
export function buildBeatGrid(
  bpm: number,
  duration: number,
  beats: number[],
  bars: number[],
  beatsPerBar: number,
  phraseResult: PhraseDetectionResult,
  cuePoints: import("./cuePointService").CuePointSet | null
): BeatGrid {
  return {
    bpm,
    duration,
    beats,
    downbeats: bars, // Chaque bar start = downbeat
    bars,
    beatsPerBar,
    phrases: phraseResult.phrases,
    phraseLengthBars: phraseResult.phraseLength,
    phraseStarts: phraseResult.phraseStarts,
    cuePoints,
  };
}

// --- Grid Queries (performants, O(log n) possible mais O(n) suffisant ici) ---

/** Trouve le prochain beat après un timestamp */
export function getNextBeat(grid: BeatGrid, afterTime: number): number | null {
  for (const b of grid.beats) {
    if (b > afterTime) return b;
  }
  return null;
}

/** Trouve le prochain downbeat après un timestamp */
export function getNextDownbeat(grid: BeatGrid, afterTime: number): number | null {
  for (const d of grid.downbeats) {
    if (d > afterTime) return d;
  }
  return null;
}

/** Trouve le prochain début de phrase après un timestamp */
export function getNextPhraseStart(grid: BeatGrid, afterTime: number): number | null {
  for (const p of grid.phraseStarts) {
    if (p > afterTime) return p;
  }
  return null;
}

/** Trouve la phrase qui contient un timestamp */
export function getPhraseAt(grid: BeatGrid, time: number): Phrase | null {
  for (const p of grid.phrases) {
    if (time >= p.startTime && time <= p.endTime) return p;
  }
  return null;
}

/** Trouve le beat le plus proche d'un timestamp */
export function findNearestBeat(grid: BeatGrid, time: number): number | null {
  if (grid.beats.length === 0) return null;
  let best = grid.beats[0];
  let bestDiff = Math.abs(time - best);
  for (let i = 1; i < grid.beats.length; i++) {
    const diff = Math.abs(time - grid.beats[i]);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = grid.beats[i];
    }
  }
  return best;
}

/** Trouve le downbeat le plus proche d'un timestamp */
export function findNearestDownbeat(grid: BeatGrid, time: number): number | null {
  if (grid.downbeats.length === 0) return null;
  let best = grid.downbeats[0];
  let bestDiff = Math.abs(time - best);
  for (let i = 1; i < grid.downbeats.length; i++) {
    const diff = Math.abs(time - grid.downbeats[i]);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = grid.downbeats[i];
    }
  }
  return best;
}

/** Calcule la position dans la mesure (0-1) à un timestamp donné */
export function getBeatPhase(grid: BeatGrid, time: number): number {
  const beatDuration = 60 / grid.bpm;
  return (time % beatDuration) / beatDuration;
}

/** Calcule la position dans la phrase (0-1) à un timestamp donné */
export function getPhrasePhase(grid: BeatGrid, time: number): number {
  const phrase = getPhraseAt(grid, time);
  if (!phrase) return 0;
  return (time - phrase.startTime) / (phrase.endTime - phrase.startTime);
}

/** Retourne le nombre de beats entre deux timestamps */
export function beatDistance(grid: BeatGrid, from: number, to: number): number {
  const beatDuration = 60 / grid.bpm;
  return Math.round((to - from) / beatDuration);
}

/** Retourne le nombre de bars entre deux timestamps */
export function barDistance(grid: BeatGrid, from: number, to: number): number {
  const barDuration = (60 / grid.bpm) * grid.beatsPerBar;
  return Math.round((to - from) / barDuration);
}

/** Vérifie si un timestamp est aligné sur un downbeat (tolérance en secondes) */
export function isOnDownbeat(grid: BeatGrid, time: number, toleranceSec = 0.05): boolean {
  return grid.downbeats.some((d) => Math.abs(d - time) < toleranceSec);
}

/** Vérifie si un timestamp est au début d'une phrase */
export function isOnPhraseStart(grid: BeatGrid, time: number, toleranceSec = 0.15): boolean {
  return grid.phraseStarts.some((p) => Math.abs(p - time) < toleranceSec);
}

/** Calcule le tempo instantané entre deux beats consécutifs */
export function computeInstantaneousBpms(grid: BeatGrid): number[] {
  const bpms: number[] = [];
  for (let i = 1; i < grid.beats.length; i++) {
    const diff = grid.beats[i] - grid.beats[i - 1];
    if (diff > 0.01) {
      bpms.push(60 / diff);
    }
  }
  return bpms;
}

/** Détecte le drift BPM moyen (écart-type du tempo) */
export function computeBpmDrift(grid: BeatGrid): { avgBpm: number; stdDev: number; maxDrift: number } {
  const bpms = computeInstantaneousBpms(grid);
  if (bpms.length === 0) return { avgBpm: grid.bpm, stdDev: 0, maxDrift: 0 };

  const avg = bpms.reduce((s, v) => s + v, 0) / bpms.length;
  const variance = bpms.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / bpms.length;
  const stdDev = Math.sqrt(variance);
  const maxDrift = Math.max(...bpms.map((v) => Math.abs(v - grid.bpm)));

  return { avgBpm: avg, stdDev, maxDrift };
}
