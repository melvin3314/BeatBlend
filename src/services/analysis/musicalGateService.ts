/**
 * MusicalGate
 * Vérifie si la position actuelle est un moment musical cohérent
 * pour déclencher une transition. JAMAIS de timer brut.
 *
 * Moments valides :
 * - Fin de phrase (8 / 16 / 32 mesures)
 * - Fin d'outro
 * - Fin de build
 * - Pause musicale (silence / basse énergie)
 * - Préparation de drop (juste avant)
 * - Downbeat aligné (fallback contrôlé)
 */

import type { DropPoint, EnergySection } from "../../types/audioAnalysis";
import type { BeatGrid } from "./BeatGrid";
import { getNextDownbeat, getNextPhraseStart, getPhraseAt, isOnDownbeat } from "./BeatGrid";

export interface MusicalGateResult {
  shouldTrigger: boolean;
  reason: string;
  confidence: number;
}

const PHRASE_END_TOLERANCE = 0.2; // secondes
const DROP_PREP_WINDOW = 2.0;     // secondes avant un drop
const PAUSE_ENERGY_THRESHOLD = 0.15;

/**
 * Vérifie si la position actuelle est un moment musical propice.
 */
export function checkMusicalGate(
  position: number,
  grid: BeatGrid,
  sections: EnergySection[],
  drops: DropPoint[],
  buildups: DropPoint[]
): MusicalGateResult {
  // 1. Fin de phrase (priorité absolue)
  const phrase = getPhraseAt(grid, position);
  if (phrase) {
    const timeToEnd = phrase.endTime - position;
    if (timeToEnd >= 0 && timeToEnd <= PHRASE_END_TOLERANCE) {
      const phraseBars = barDistance(grid, phrase.startTime, phrase.endTime);
      return {
        shouldTrigger: true,
        reason: `Phrase end (${phraseBars} bars)`,
        confidence: 0.95,
      };
    }
  }

  // 2. Fin d'outro
  const outroSection = sections.find(
    (s) => s.type === "outro" && position >= s.startTime && position <= s.endTime
  );
  if (outroSection) {
    const timeToEnd = outroSection.endTime - position;
    if (timeToEnd >= 0 && timeToEnd <= PHRASE_END_TOLERANCE) {
      return {
        shouldTrigger: true,
        reason: "Outro end",
        confidence: 0.9,
      };
    }
  }

  // 3. Fin de build
  const buildSection = sections.find(
    (s) => s.type === "buildup" && position >= s.startTime && position <= s.endTime
  );
  if (buildSection) {
    const timeToEnd = buildSection.endTime - position;
    if (timeToEnd >= 0 && timeToEnd <= PHRASE_END_TOLERANCE) {
      return {
        shouldTrigger: true,
        reason: "Build end",
        confidence: 0.88,
      };
    }
  }

  // 4. Pré-drop (juste avant un drop, créer de la tension)
  for (const drop of drops) {
    const timeToDrop = drop.timestamp - position;
    if (timeToDrop >= -0.1 && timeToDrop <= DROP_PREP_WINDOW) {
      return {
        shouldTrigger: true,
        reason: "Pre-drop",
        confidence: 0.85,
      };
    }
  }

  // 5. Pause musicale (section basse énergie)
  const lowEnergySection = sections.find(
    (s) =>
      s.energyLevel === "low" &&
      position >= s.startTime &&
      position <= s.endTime
  );
  if (lowEnergySection) {
    const sectionDuration = lowEnergySection.endTime - lowEnergySection.startTime;
    const timeInSection = position - lowEnergySection.startTime;
    // Déclencher au début d'une pause (dans les 2 premières secondes)
    if (timeInSection >= 0 && timeInSection <= Math.min(2, sectionDuration * 0.3)) {
      return {
        shouldTrigger: true,
        reason: "Musical pause",
        confidence: 0.7,
      };
    }
  }

  // 6. Downbeat aligné (fallback contrôlé, uniquement si on est VRAIMENT sur le downbeat)
  if (isOnDownbeat(grid, position, 0.08)) {
    return {
      shouldTrigger: true,
      reason: "Downbeat aligned (fallback)",
      confidence: 0.5,
    };
  }

  return {
    shouldTrigger: false,
    reason: "No musical moment",
    confidence: 0,
  };
}

/**
 * Trouve le prochain moment musical après `fromTime`.
 * Utilisé quand on a dépassé le trigger minimum mais qu'aucun moment n'était bon.
 */
export function findNextMusicalMoment(
  fromTime: number,
  grid: BeatGrid,
  sections: EnergySection[],
  drops: DropPoint[],
  buildups: DropPoint[]
): { time: number; reason: string; confidence: number } | null {
  // Chercher la prochaine fin de phrase
  const phrase = getPhraseAt(grid, fromTime);
  if (phrase && phrase.endTime > fromTime + 0.5) {
    return {
      time: phrase.endTime,
      reason: "Next phrase end",
      confidence: 0.95,
    };
  }
  const nextPhraseStart = getNextPhraseStart(grid, fromTime);
  if (nextPhraseStart) {
    const nextPhrase = grid.phrases.find((p) => p.startTime === nextPhraseStart);
    if (nextPhrase) {
      return {
        time: nextPhrase.endTime,
        reason: "Next phrase end",
        confidence: 0.95,
      };
    }
  }

  // Chercher le prochain downbeat
  const nextDownbeat = getNextDownbeat(grid, fromTime);
  if (nextDownbeat) {
    return {
      time: nextDownbeat,
      reason: "Next downbeat",
      confidence: 0.6,
    };
  }

  // Chercher le prochain drop
  for (const drop of drops) {
    if (drop.timestamp > fromTime + 0.5) {
      return {
        time: drop.timestamp - 0.5,
        reason: "Pre-drop",
        confidence: 0.85,
      };
    }
  }

  return null;
}

function barDistance(grid: BeatGrid, from: number, to: number): number {
  const barDuration = (60 / grid.bpm) * grid.beatsPerBar;
  return Math.round((to - from) / barDuration);
}
