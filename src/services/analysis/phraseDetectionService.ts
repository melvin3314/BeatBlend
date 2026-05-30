import type { EnergySection } from "../../types/audioAnalysis";

/**
 * Phrase = groupe de bars (4, 8, 16, 32 bars).
 * La plupart de la musique électronique est structurée en phrases de 8 ou 16 bars.
 */

export interface Phrase {
  startTime: number;
  endTime: number;
  startBar: number;    // Index de la première barre
  barCount: number;    // Nombre de barres dans la phrase (4, 8, 16, 32)
  phraseIndex: number; // Index séquentiel de la phrase
  type: "intro" | "buildup" | "drop" | "breakdown" | "outro" | "verse" | "chorus" | "unknown";
  energy: number;      // Énergie moyenne de la phrase (0-1)
}

export interface PhraseDetectionResult {
  phrases: Phrase[];
  phraseLength: number;        // Longueur de phrase dominante en bars (8 ou 16)
  totalPhrases: number;
  downbeats: number[];         // Timestamps des downbeats (beat 1 de chaque mesure)
  phraseStarts: number[];      // Timestamps des débuts de phrases
}

/**
 * Détecte les phrases musicales à partir des barres et de l'énergie.
 * Une phrase = groupe de N barres (typiquement 8 dans l'EDM, 4 dans le hip-hop).
 */
export function detectPhrases(
  bars: number[],
  beats: number[],
  energySections: EnergySection[],
  rms: number[],
  timestamps: number[],
  bpm: number
): PhraseDetectionResult {
  if (bars.length < 4) {
    return { phrases: [], phraseLength: 8, totalPhrases: 0, downbeats: bars, phraseStarts: [] };
  }

  // Déterminer la longueur de phrase dominante
  const phraseLength = detectDominantPhraseLength(bars, rms, timestamps);

  // Grouper les bars en phrases
  const phrases: Phrase[] = [];
  let phraseIdx = 0;

  for (let i = 0; i < bars.length; i += phraseLength) {
    const barCount = Math.min(phraseLength, bars.length - i);
    if (barCount < 2) break; // Phrase trop courte, ignorer

    const startTime = bars[i];
    const endTime = i + barCount < bars.length ? bars[i + barCount] : getTrackEnd(bars, bpm);
    const energy = getAverageEnergy(rms, timestamps, startTime, endTime);
    const type = classifyPhrase(startTime, endTime, energy, energySections, phrases.length, bars.length / phraseLength);

    phrases.push({
      startTime,
      endTime,
      startBar: i,
      barCount,
      phraseIndex: phraseIdx++,
      type,
      energy,
    });
  }

  const phraseStarts = phrases.map(p => p.startTime);

  return {
    phrases,
    phraseLength,
    totalPhrases: phrases.length,
    downbeats: bars, // Chaque bar start = un downbeat
    phraseStarts,
  };
}

/**
 * Détecte la longueur de phrase dominante en analysant les patterns d'énergie.
 * Cherche des changements d'énergie récurrents toutes les N bars.
 */
function detectDominantPhraseLength(
  bars: number[],
  rms: number[],
  timestamps: number[]
): number {
  if (bars.length < 16) return 4;

  // Calculer l'énergie à chaque bar
  const barEnergies: number[] = bars.map((barTime, i) => {
    const nextBar = i + 1 < bars.length ? bars[i + 1] : barTime + 2;
    return getAverageEnergy(rms, timestamps, barTime, nextBar);
  });

  // Chercher la périodicité dans les changements d'énergie
  const candidates = [4, 8, 16, 32];
  let bestLength = 8;
  let bestScore = 0;

  for (const len of candidates) {
    if (bars.length < len * 2) continue;

    let score = 0;
    let count = 0;

    // Mesurer la corrélation d'énergie à chaque multiple de `len`
    for (let i = 0; i + len < barEnergies.length; i += len) {
      const energyAtBoundary = Math.abs(barEnergies[i] - (barEnergies[i - 1] ?? barEnergies[i]));
      score += energyAtBoundary;
      count++;
    }

    const avgScore = count > 0 ? score / count : 0;
    if (avgScore > bestScore) {
      bestScore = avgScore;
      bestLength = len;
    }
  }

  return bestLength;
}

/**
 * Classifie le type de phrase basé sur la position et l'énergie.
 */
function classifyPhrase(
  startTime: number,
  endTime: number,
  energy: number,
  sections: EnergySection[],
  phraseIndex: number,
  totalPhrases: number
): Phrase["type"] {
  // Position relative dans le morceau
  const relativePos = phraseIndex / Math.max(1, totalPhrases - 1);

  // Énergie dominante dans la section correspondante
  const matchingSection = sections.find(
    s => s.startTime <= startTime && s.endTime >= endTime
  );

  if (relativePos < 0.1) return "intro";
  if (relativePos > 0.9) return "outro";

  if (matchingSection) {
    if (matchingSection.type === "drop" || matchingSection.type === "chorus") return "drop";
    if (matchingSection.type === "buildup") return "buildup";
    if (matchingSection.type === "break" || matchingSection.type === "bridge") return "breakdown";
    if (matchingSection.type === "verse") return "verse";
  }

  // Classifier par énergie
  if (energy > 0.7) return "drop";
  if (energy > 0.5) return "chorus";
  if (energy < 0.3) return "breakdown";

  return "unknown";
}

/**
 * Estime la fin du morceau à partir des bars et BPM.
 */
function getTrackEnd(bars: number[], bpm: number): number {
  if (bars.length === 0) return 0;
  const lastBar = bars[bars.length - 1];
  const barDuration = (60 / bpm) * 4; // 4 beats par bar
  return lastBar + barDuration;
}

/**
 * Calcule l'énergie moyenne entre deux timestamps.
 */
function getAverageEnergy(
  rms: number[],
  timestamps: number[],
  startTime: number,
  endTime: number
): number {
  if (rms.length === 0 || timestamps.length === 0) return 0.5;

  let sum = 0;
  let count = 0;

  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] >= startTime && timestamps[i] <= endTime) {
      sum += rms[i];
      count++;
    }
  }

  return count > 0 ? sum / count : 0.5;
}

/**
 * Trouve le début de phrase le plus proche d'un timestamp.
 */
export function findNearestPhraseStart(
  phrases: Phrase[],
  timestamp: number,
  direction: "before" | "after" | "nearest" = "nearest"
): Phrase | null {
  if (phrases.length === 0) return null;

  let best: Phrase | null = null;
  let bestDiff = Infinity;

  for (const phrase of phrases) {
    const diff = phrase.startTime - timestamp;

    if (direction === "before" && diff > 0) continue;
    if (direction === "after" && diff < 0) continue;

    const absDiff = Math.abs(diff);
    if (absDiff < bestDiff) {
      bestDiff = absDiff;
      best = phrase;
    }
  }

  return best;
}

/**
 * Trouve la meilleure paire de phrases pour une transition (alignement phrase → phrase).
 * Ex: fin de chorus track A → début de drop track B
 */
export function findBestPhraseTransition(
  phrasesA: Phrase[],
  phrasesB: Phrase[],
  targetOutTime: number
): { outPhrase: Phrase; inPhrase: Phrase } | null {
  // Trouver la phrase de sortie la plus proche du point cible
  const outPhrase = findNearestPhraseStart(phrasesA, targetOutTime, "nearest");
  if (!outPhrase) return null;

  // Chercher la meilleure phrase d'entrée dans B
  // Priorité : drop → buildup → chorus → verse
  const priorityOrder: Phrase["type"][] = ["drop", "buildup", "chorus", "verse", "unknown"];

  for (const targetType of priorityOrder) {
    const matching = phrasesB.filter(p => p.type === targetType);
    if (matching.length > 0) {
      // Prendre la première occurrence du type voulu
      return { outPhrase, inPhrase: matching[0] };
    }
  }

  // Fallback : première phrase de B
  return { outPhrase, inPhrase: phrasesB[0] };
}
