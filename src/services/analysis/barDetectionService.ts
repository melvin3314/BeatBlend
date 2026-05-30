import { BeatDetectionResult } from "../../types/audioAnalysis";

export interface BarDetectionResult {
  bars: number[]; // Timestamps des débuts de mesures en secondes
  beatsPerBar: number; // Généralement 4
}

/**
 * Détecte les mesures en groupant les beats
 * @param beats - Timestamps des beats
 * @param beatsPerBar - Nombre de beats par mesure (généralement 4)
 */
export const detectBars = (
  beats: number[],
  beatsPerBar: number = 4
): BarDetectionResult => {
  const bars: number[] = [];

  for (let i = 0; i < beats.length; i += beatsPerBar) {
    if (i < beats.length) {
      bars.push(beats[i]);
    }
  }

  return {
    bars,
    beatsPerBar,
  };
};

/**
 * Trouve la mesure la plus proche d'un timestamp donné
 */
export const findNearestBar = (
  bars: number[],
  timestamp: number
): number => {
  if (bars.length === 0) return timestamp;

  let nearest = bars[0];
  let minDiff = Math.abs(timestamp - nearest);

  for (let i = 1; i < bars.length; i++) {
    const diff = Math.abs(timestamp - bars[i]);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = bars[i];
    }
  }

  return nearest;
};

/**
 * Vérifie si un timestamp est au début d'une mesure
 */
export const isBarStart = (
  bars: number[],
  timestamp: number,
  tolerance: number = 0.1
): boolean => {
  for (const bar of bars) {
    if (Math.abs(timestamp - bar) < tolerance) {
      return true;
    }
  }
  return false;
};
