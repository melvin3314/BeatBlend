import type { EnergyAnalysisResult, EnergySection } from "../../types/audioAnalysis";
import { getEnergyCurveBackend } from "../backend/beatBlendBackend";

/**
 * Analyse l'énergie d'un morceau via le backend Python (base64 JSON).
 */
export const analyzeEnergy = async (
  trackUri: string
): Promise<EnergyAnalysisResult | null> => {
  try {
    const data = await getEnergyCurveBackend(trackUri, "track.mp3");
    if (!data) return null;

    // Mapper energyCurve → rms, timestamps, sections
    const rms = data.map(p => p.rms);
    const spectralCentroid = data.map(p => p.value * 8000); // approx centroid from normalized value
    const timestamps = data.map(p => p.time);
    const sections = mapEnergyCurveToSections(data);

    console.log("[Energy Backend]", data.length, "frames |", sections.length, "sections");

    return {
      rms,
      spectralCentroid,
      timestamps,
      sections,
    };
  } catch (error) {
    console.log("[Energy] Backend unavailable, using fallback");
    return null;
  }
};

/**
 * Convertit la courbe d'énergie du backend en sections EnergySection.
 */
function mapEnergyCurveToSections(curve: { time: number; value: number; level: string; rms: number }[]): EnergySection[] {
  if (curve.length === 0) return [];

  const sections: EnergySection[] = [];
  let current: EnergySection | null = null;

  for (const pt of curve) {
    const level = pt.level as EnergySection["energyLevel"];
    const time = pt.time;

    if (!current) {
      current = {
        startTime: time,
        endTime: time,
        energyLevel: level,
        type: "unknown",
      };
    } else if (current.energyLevel !== level) {
      sections.push(current);
      current = {
        startTime: time,
        endTime: time,
        energyLevel: level,
        type: "unknown",
      };
    } else {
      current.endTime = time;
    }
  }

  if (current) sections.push(current);

  // Classifier
  if (sections.length > 0) {
    sections[0].type = "intro";
    sections[sections.length - 1].type = "outro";
    for (let i = 1; i < sections.length - 1; i++) {
      if (sections[i].energyLevel === "high" || sections[i].energyLevel === "explosive") {
        sections[i].type = "chorus";
      } else if (sections[i].energyLevel === "low") {
        sections[i].type = "verse";
      } else {
        sections[i].type = "break";
      }
    }
  }

  return sections;
}

/**
 * Fallback: analyse d'énergie simple côté client (basée sur les beats)
 */
export const analyzeEnergyFallback = (
  beats: number[],
  duration: number
): EnergyAnalysisResult => {
  const segmentDuration = 1; // 1 seconde par segment
  const numSegments = Math.floor(duration / segmentDuration);
  const rms: number[] = [];
  const timestamps: number[] = [];

  // Simuler l'énergie basée sur la densité de beats
  for (let i = 0; i < numSegments; i++) {
    const startTime = i * segmentDuration;
    const endTime = (i + 1) * segmentDuration;
    
    // Compter les beats dans ce segment
    const beatsInSegment = beats.filter(
      b => b >= startTime && b < endTime
    ).length;
    
    // Énergie approximative basée sur la densité de beats
    const energy = beatsInSegment / segmentDuration;
    rms.push(energy);
    timestamps.push(startTime);
  }

  // Détecter les sections basées sur l'énergie
  const sections = detectSections(rms, timestamps);

  return {
    rms,
    spectralCentroid: rms, // Fallback: utiliser RMS comme centroïde
    timestamps,
    sections,
  };
};

/**
 * Détecte les sections basées sur l'énergie
 */
const detectSections = (
  rms: number[],
  timestamps: number[]
): EnergySection[] => {
  const sections: EnergySection[] = [];
  const thresholdLow = 0.3;
  const thresholdHigh = 0.7;

  let currentSection: EnergySection | null = null;

  for (let i = 0; i < rms.length; i++) {
    const energy = rms[i];
    const time = timestamps[i];

    let energyLevel: 'low' | 'medium' | 'high';
    if (energy < thresholdLow) {
      energyLevel = 'low';
    } else if (energy < thresholdHigh) {
      energyLevel = 'medium';
    } else {
      energyLevel = 'high';
    }

    if (!currentSection) {
      currentSection = {
        startTime: time,
        endTime: time,
        energyLevel,
        type: 'unknown',
      };
    } else if (currentSection.energyLevel !== energyLevel) {
      sections.push(currentSection);
      currentSection = {
        startTime: time,
        endTime: time,
        energyLevel,
        type: 'unknown',
      };
    } else {
      currentSection.endTime = time;
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  // Classifier les sections
  classifySections(sections);

  return sections;
};

/**
 * Classifie les sections en intro, verse, chorus, etc.
 */
const classifySections = (sections: EnergySection[]) => {
  if (sections.length === 0) return;

  // Intro: première section
  sections[0].type = 'intro';

  // Outro: dernière section
  sections[sections.length - 1].type = 'outro';

  // Chorus: sections haute énergie au milieu
  for (let i = 1; i < sections.length - 1; i++) {
    if (sections[i].energyLevel === 'high') {
      sections[i].type = 'chorus';
    } else {
      sections[i].type = 'verse';
    }
  }
};

/**
 * Trouve les sections avec haute énergie
 */
export const findHighEnergySections = (
  sections: EnergySection[]
): EnergySection[] => {
  return sections.filter(s => s.energyLevel === 'high');
};

/**
 * Trouve les sections avec basse énergie (à éviter pour les transitions)
 */
export const findLowEnergySections = (
  sections: EnergySection[]
): EnergySection[] => {
  return sections.filter(s => s.energyLevel === 'low');
};
