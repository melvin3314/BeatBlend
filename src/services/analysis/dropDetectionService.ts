import { DropDetectionResult, DropPoint, EnergySection } from "../../types/audioAnalysis";

/**
 * Détecte les drops et buildups basés sur l'analyse d'énergie
 */
export const detectDrops = (
  energySections: EnergySection[],
  rms: number[],
  timestamps: number[]
): DropDetectionResult => {
  const drops: DropPoint[] = [];
  const buildups: DropPoint[] = [];

  // Chercher les transitions basse énergie → haute énergie (drops)
  for (let i = 1; i < energySections.length; i++) {
    const prevSection = energySections[i - 1];
    const currentSection = energySections[i];

    // Transition low → high = drop
    if (
      prevSection.energyLevel === 'low' &&
      currentSection.energyLevel === 'high'
    ) {
      const timestamp = currentSection.startTime;
      const energyBefore = getEnergyAtTimestamp(rms, timestamps, timestamp - 0.5);
      const energyAfter = getEnergyAtTimestamp(rms, timestamps, timestamp + 0.5);

      drops.push({
        timestamp,
        energyBefore,
        energyAfter,
        type: 'drop',
      });
    }

    // Transition high → low = buildup (fin)
    if (
      prevSection.energyLevel === 'high' &&
      currentSection.energyLevel === 'low'
    ) {
      const timestamp = prevSection.endTime;
      const energyBefore = getEnergyAtTimestamp(rms, timestamps, timestamp - 0.5);
      const energyAfter = getEnergyAtTimestamp(rms, timestamps, timestamp + 0.5);

      buildups.push({
        timestamp,
        energyBefore,
        energyAfter,
        type: 'buildup',
      });
    }
  }

  // Détecter les buildups (montées progressives)
  for (let i = 1; i < rms.length - 10; i++) {
    const currentEnergy = rms[i];
    const futureEnergy = rms[i + 10];
    const timestamp = timestamps[i];

    // Si l'énergie monte significativement
    if (futureEnergy > currentEnergy * 1.5 && currentEnergy < 0.5) {
      // Vérifier si ce n'est pas déjà détecté comme drop
      const isNearDrop = drops.some(
        d => Math.abs(d.timestamp - timestamp) < 2
      );

      if (!isNearDrop) {
        buildups.push({
          timestamp,
          energyBefore: currentEnergy,
          energyAfter: futureEnergy,
          type: 'buildup',
        });
      }
    }
  }

  return { drops, buildups };
};

/**
 * Obtient l'énergie à un timestamp donné
 */
const getEnergyAtTimestamp = (
  rms: number[],
  timestamps: number[],
  targetTimestamp: number
): number => {
  // Trouver l'index le plus proche
  let closestIndex = 0;
  let minDiff = Math.abs(timestamps[0] - targetTimestamp);

  for (let i = 1; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - targetTimestamp);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }

  return rms[closestIndex];
};

/**
 * Trouve le meilleur point de drop pour une transition
 */
export const findBestDropPoint = (
  drops: DropPoint[],
  targetTime: number,
  tolerance: number = 5
): DropPoint | null => {
  // Trouver le drop le plus proche du temps cible
  let bestDrop: DropPoint | null = null;
  let minDiff = tolerance;

  for (const drop of drops) {
    const diff = Math.abs(drop.timestamp - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      bestDrop = drop;
    }
  }

  return bestDrop;
};

/**
 * Trouve le meilleur point de buildup pour une transition
 */
export const findBestBuildupPoint = (
  buildups: DropPoint[],
  targetTime: number,
  tolerance: number = 5
): DropPoint | null => {
  // Trouver le buildup le plus proche du temps cible
  let bestBuildup: DropPoint | null = null;
  let minDiff = tolerance;

  for (const buildup of buildups) {
    const diff = Math.abs(buildup.timestamp - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      bestBuildup = buildup;
    }
  }

  return bestBuildup;
};
