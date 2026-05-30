/**
 * Humanized Transition Service
 * 
 * Ajoute des micro-variations naturelles aux transitions
 * pour éviter l'effet "robotique" des crossfades linéaires.
 * 
 * Inspiré du comportement d'un vrai DJ :
 * - Légers décalages de timing
 * - Courbes de volume non-linéaires
 * - Micro-fluctuations
 * - "Feel" organique
 */

export interface HumanizedCurve {
  volumeA: number[];   // Courbe de volume track A (0-1) sur N steps
  volumeB: number[];   // Courbe de volume track B (0-1) sur N steps
  steps: number;       // Nombre de steps
  stepDuration: number; // Durée de chaque step en ms
}

export type TransitionFeel = "smooth" | "punchy" | "ambient" | "aggressive" | "lazy";

/**
 * Génère une courbe de volume humanisée pour une transition.
 * Pas de crossfade parfait — des courbes naturelles avec micro-variations.
 */
export function generateHumanizedCurve(
  durationMs: number,
  feel: TransitionFeel = "smooth",
  steps: number = 60
): HumanizedCurve {
  const stepDuration = durationMs / steps;
  const volumeA: number[] = [];
  const volumeB: number[] = [];

  // Seed pour les micro-variations (déterministe par transition)
  let seed = durationMs * 7 + steps * 13;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 → 1

    // Courbe de base selon le "feel"
    const baseA = getBaseCurve(1 - t, feel, "out");
    const baseB = getBaseCurve(t, feel, "in");

    // Ajouter micro-variations humanisées
    const microA = getMicroVariation(seed + i * 3, feel);
    const microB = getMicroVariation(seed + i * 7, feel);

    // Combiner (clamp 0-1)
    volumeA.push(clamp(baseA + microA, 0, 1));
    volumeB.push(clamp(baseB + microB, 0, 1));
  }

  return { volumeA, volumeB, steps, stepDuration };
}

/**
 * Courbe de base selon le "feel" de la transition.
 */
function getBaseCurve(t: number, feel: TransitionFeel, direction: "in" | "out"): number {
  switch (feel) {
    case "smooth":
      // S-curve douce (easeInOutCubic)
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    case "punchy":
      // Rapide au début, plateau, puis coupe nette
      if (direction === "out") {
        // Track A : reste haut longtemps puis coupe rapidement
        if (t > 0.7) return Math.pow((t - 0.7) / 0.3, 0.5);
        return 1 - Math.pow(1 - t, 4);
      }
      // Track B : monte vite
      return Math.pow(t, 0.4);

    case "ambient":
      // Très long et progressif, presque linéaire avec une légère courbe
      return Math.pow(t, 1.3);

    case "aggressive":
      // Montée rapide avec un "pump" au milieu
      const base = Math.pow(t, 0.6);
      const pump = Math.sin(t * Math.PI * 2) * 0.05;
      return clamp(base + pump, 0, 1);

    case "lazy":
      // Lent au début, accélère à la fin
      return Math.pow(t, 2.5);

    default:
      return t;
  }
}

/**
 * Micro-variation naturelle (simule les imperfections d'un DJ humain).
 * Amplitude très faible (±2-4%) pour rester subtil.
 */
function getMicroVariation(seed: number, feel: TransitionFeel): number {
  // PRNG simple (pseudo-aléatoire déterministe)
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  const random = x - Math.floor(x); // 0-1

  // Amplitude selon le feel
  const amplitude = feel === "ambient" ? 0.01 : feel === "aggressive" ? 0.04 : 0.02;

  return (random - 0.5) * 2 * amplitude;
}

/**
 * Génère un timing offset naturel pour le lancement de B.
 * Un vrai DJ ne lance jamais B au milliseconde exact — il y a toujours
 * un léger offset "humain" (±20ms typiquement).
 */
export function getHumanizedTimingOffset(feel: TransitionFeel): number {
  const base = feel === "smooth" ? 10 : feel === "punchy" ? 5 : 15;
  // Variation ±base ms
  return (Math.random() - 0.5) * 2 * base;
}

/**
 * Calcule le "feel" recommandé basé sur les caractéristiques des morceaux.
 */
export function recommendFeel(
  bpmA: number,
  bpmB: number,
  energyA: number,
  energyB: number,
  transitionStyle: string
): TransitionFeel {
  const bpmDiff = Math.abs(bpmA - bpmB);
  const energyDiff = Math.abs(energyA - energyB);
  const avgEnergy = (energyA + energyB) / 2;

  // Transitions types → feel
  if (transitionStyle === "cut_drop") return "punchy";
  if (transitionStyle === "ambient_fade") return "ambient";
  if (transitionStyle === "bass_swap") return "aggressive";

  // Analyse des caractéristiques
  if (bpmDiff > 10) return "lazy"; // Grand écart BPM → transition lente
  if (avgEnergy > 0.75) return "punchy"; // Haute énergie → percutant
  if (avgEnergy < 0.35) return "ambient"; // Basse énergie → ambiant
  if (energyDiff > 0.4) return "aggressive"; // Grand saut d'énergie → agressif

  return "smooth";
}

// --- EQ Curves (simulated via volume only in expo-audio) ---

export interface EQTransitionCurve {
  // Simuler un EQ progressif via le volume
  // (en vrai on ne peut pas faire d'EQ dans expo-audio,
  //  mais on simule l'effet perceptif)
  lowCutProgress: number[];  // 0 = full bass, 1 = bass removed
  highBoostProgress: number[]; // 0 = normal, 1 = boosted highs feel
}

/**
 * Génère une courbe EQ simulée.
 * Dans un vrai DJ software, on baisserait les basses de A progressivement
 * pendant qu'on monte les basses de B.
 * 
 * Ici, on simule ça avec un léger dip de volume sur A aux moments critiques.
 */
export function generateEQSimulation(
  steps: number,
  feel: TransitionFeel
): EQTransitionCurve {
  const lowCutProgress: number[] = [];
  const highBoostProgress: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;

    // Le "bass swap" : couper les basses de A progressivement
    // Simulé par un dip plus prononcé au milieu de la transition
    const bassSwapCurve = feel === "aggressive"
      ? Math.pow(t, 0.8)  // Coupe rapide
      : Math.pow(t, 1.5); // Coupe douce

    lowCutProgress.push(bassSwapCurve);

    // Les aigus montent en premier sur B (impression de clarté)
    const highBoost = Math.pow(t, 0.7);
    highBoostProgress.push(highBoost);
  }

  return { lowCutProgress, highBoostProgress };
}

// --- Utility ---

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
