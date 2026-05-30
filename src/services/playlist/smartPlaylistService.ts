/**
 * Smart Playlist Ordering Service
 * Réordonne une playlist pour maximiser la compatibilité harmonique,
 * la proximité BPM et la cohérence énergétique entre morceaux consécutifs.
 *
 * Algorithme : greedy nearest-neighbor amélioré avec :
 *  - Scoring multi-critères (harmonie, BPM, énergie, flow)
 *  - Courbe d'énergie globale (warm-up → peak → cool-down)
 *  - 2-opt pour optimiser le chemin global
 */

import { calculateCamelotCompatibility } from "../analysis/keyDetectionService";

export interface SmartTrack {
  name: string;
  uri: string;
  bpm: number;
  energy: number;
  key?: string;
  camelot?: string;
  duration?: number;
}

export interface OrderingConfig {
  bpmTolerance: number;
  energyTolerance: number;
  preferEnergyCurve: "flat" | "ascending" | "descending" | "auto";
  penalizeLargeBpmJumps: boolean;
  preferKeyLock: boolean;
}

const DEFAULT_CONFIG: OrderingConfig = {
  bpmTolerance: 10,
  energyTolerance: 0.30,
  preferEnergyCurve: "auto",
  penalizeLargeBpmJumps: true,
  preferKeyLock: true,
};

/**
 * Réordonne une playlist pour un set DJ optimal.
 * Amélioré : courbe d'énergie globale + 2-opt
 */
export function orderPlaylistSmart(
  tracks: SmartTrack[],
  startIndex = 0,
  config: Partial<OrderingConfig> = {}
): SmartTrack[] {
  if (tracks.length < 2) return [...tracks];

  const cfg = { ...DEFAULT_CONFIG, ...config };

  // --- 1. DÉTERMINER LA COURBE D'ÉNERGIE CIBLE ---
  const energies = tracks.map(t => t.energy);
  const minEnergy = Math.min(...energies);
  const maxEnergy = Math.max(...energies);

  // Courbe cible : montée progressive vers le milieu, puis descente
  const targetEnergyCurve = tracks.map((_, i) => {
    const progress = i / Math.max(tracks.length - 1, 1);
    // Courbe en cloche : 0 → 0.5 → 1.0 → 0.5 → 0
    const bell = 1 - Math.pow(progress * 2 - 1, 2);
    return minEnergy + (maxEnergy - minEnergy) * bell;
  });

  // --- 2. GREEDY NEAREST-NEIGHBOR ---
  const ordered: SmartTrack[] = [];
  const remaining = [...tracks];

  // Commencer par le morceau choisi (ou le plus calme pour auto)
  let startIdx = startIndex;
  if (cfg.preferEnergyCurve === "auto" && startIndex === 0) {
    // Trouver le morceau le plus calme pour commencer (warm-up)
    startIdx = energies.indexOf(minEnergy);
  }
  const start = remaining.splice(startIdx, 1)[0] || remaining.shift()!;
  ordered.push(start);

  while (remaining.length > 0) {
    const prev = ordered[ordered.length - 1];
    const position = ordered.length;
    const targetEnergy = targetEnergyCurve[position] ?? prev.energy;

    // Scorer chaque morceau restant avec le contexte global
    const scored = remaining.map((track, idx) => ({
      track,
      originalIdx: idx,
      score: scoreCompatibility(prev, track, targetEnergy, position, tracks.length, cfg),
    }));

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    ordered.push(best.track);
    remaining.splice(best.originalIdx, 1);
  }

  // --- 3. 2-OPT : AMÉLIORATION DU CHEMIN GLOBAL ---
  const improved = twoOpt(ordered, cfg);

  return improved;
}

/**
 * Calcule un score de compatibilité global entre deux morceaux.
 * Prend en compte le contexte global (position dans le set, énergie cible).
 * Score : 0 (incompatible) → 1 (parfait)
 */
function scoreCompatibility(
  a: SmartTrack,
  b: SmartTrack,
  targetEnergy: number,
  position: number,
  totalTracks: number,
  cfg: OrderingConfig
): number {
  // 1. Harmonic match (Camelot wheel) — poids 35%
  let harmonic = 0.3; // baseline si pas de données
  if (a.camelot && b.camelot) {
    harmonic = calculateCamelotCompatibility(a.camelot, b.camelot);
  } else if (a.key && b.key && a.key === b.key) {
    harmonic = 0.9; // même key sans Camelot
  }

  // 2. BPM proximity — poids 25%
  const bpmDiff = Math.abs(a.bpm - b.bpm);
  let bpmScore: number;
  if (bpmDiff <= 3) {
    bpmScore = 1.0; // Parfait
  } else if (bpmDiff <= cfg.bpmTolerance) {
    bpmScore = 1.0 - (bpmDiff - 3) / (cfg.bpmTolerance - 3) * 0.4;
  } else if (bpmDiff <= cfg.bpmTolerance * 1.5) {
    bpmScore = 0.6 - (bpmDiff - cfg.bpmTolerance) / (cfg.bpmTolerance * 0.5) * 0.6;
  } else {
    bpmScore = 0; // Trop éloigné
  }

  // Pénalité massive pour les sauts de BPM brutaux
  if (cfg.penalizeLargeBpmJumps && bpmDiff > cfg.bpmTolerance) {
    bpmScore *= 0.3;
  }

  // 3. Energy coherence locale — poids 15%
  const energyDiff = Math.abs(a.energy - b.energy);
  const energyScore = energyDiff <= cfg.energyTolerance
    ? 1.0 - energyDiff / cfg.energyTolerance
    : Math.max(0, 1.0 - (energyDiff - cfg.energyTolerance) * 2);

  // 4. Energy curve global — poids 20%
  // Favorise les morceaux proches de l'énergie cible pour cette position
  const targetDiff = Math.abs(b.energy - targetEnergy);
  const curveScore = targetDiff < 0.2 ? 1.0
    : targetDiff < 0.4 ? 0.7
    : targetDiff < 0.6 ? 0.4
    : 0.1;

  // 5. Flow bonus — poids 5%
  // Pénalise les retours en arrière d'énergie (montée puis chute soudaine)
  let flowScore = 0.5;
  if (position > 1) {
    // On préfère une progression douce
    const prevDiff = Math.abs(a.energy - b.energy);
    if (prevDiff < 0.2) flowScore = 1.0; // Transition douce
    else if (prevDiff < 0.4) flowScore = 0.7;
    else if (prevDiff < 0.6) flowScore = 0.4;
    else flowScore = 0.1; // Saut brutal
  }

  return harmonic * 0.35 + bpmScore * 0.25 + energyScore * 0.15 + curveScore * 0.20 + flowScore * 0.05;
}

/**
 * 2-Opt : améliore un chemin en inversant des segments si ça améliore le score total.
 * Évite les optimums locaux du greedy.
 */
function twoOpt(tracks: SmartTrack[], cfg: OrderingConfig): SmartTrack[] {
  if (tracks.length < 4) return tracks;

  let improved = true;
  let best = [...tracks];
  let bestScore = calculatePlaylistScore(best, cfg);
  let iterations = 0;
  const maxIterations = 100;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        // Inverser le segment [i, j]
        const candidate = [...best];
        const segment = candidate.slice(i, j + 1).reverse();
        candidate.splice(i, j - i + 1, ...segment);

        const score = calculatePlaylistScore(candidate, cfg);
        if (score > bestScore + 0.001) {
          best = candidate;
          bestScore = score;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return best;
}

/**
 * Calcule le score moyen de compatibilité d'une playlist ordonnée.
 * Score global entre 0 et 1.
 */
export function calculatePlaylistScore(
  tracks: SmartTrack[],
  config: Partial<OrderingConfig> = {}
): number {
  if (tracks.length < 2) return 0;
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const targetCurve = tracks.map((_, i) => {
    const progress = i / Math.max(tracks.length - 1, 1);
    const bell = 1 - Math.pow(progress * 2 - 1, 2);
    const energies = tracks.map(t => t.energy);
    const min = Math.min(...energies);
    const max = Math.max(...energies);
    return min + (max - min) * bell;
  });

  let total = 0;
  for (let i = 1; i < tracks.length; i++) {
    total += scoreCompatibility(
      tracks[i - 1],
      tracks[i],
      targetCurve[i],
      i,
      tracks.length,
      cfg
    );
  }
  return total / (tracks.length - 1);
}
