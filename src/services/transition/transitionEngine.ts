import {
    DropPoint,
    EnergySection,
    TransitionPlan,
    TransitionPoint,
} from "../../types/audioAnalysis";
import { findNearestBar, isBarStart } from "../analysis/barDetectionService";
import { findBestDropPoint } from "../analysis/dropDetectionService";
import { findHighEnergySections, findLowEnergySections } from "../analysis/energyAnalysisService";

export interface TransitionEngineConfig {
  transitionWindow: number; // Fenêtre de transition en secondes (ex: 30)
  crossfadeDuration: number; // Durée du crossfade en secondes (ex: 8)
  tempoTransitionDuration: number; // Durée de la transition de tempo (ex: 4)
  minEnergyThreshold: number; // Énergie minimale pour une transition
  preferBarAlignment: boolean; // Préférer l'alignement sur les mesures
}

/**
 * Moteur de transition intelligent pour Auto-DJ
 */
export class TransitionEngine {
  private config: TransitionEngineConfig;

  constructor(config?: Partial<TransitionEngineConfig>) {
    this.config = {
      transitionWindow: 30,
      crossfadeDuration: 8,
      tempoTransitionDuration: 4,
      minEnergyThreshold: 0.3,
      preferBarAlignment: true,
      ...config,
    };
  }

  /**
   * Calcule le plan de transition optimal entre deux morceaux
   */
  calculateTransitionPlan(
    trackADuration: number,
    trackBDuration: number,
    trackASections: EnergySection[],
    trackBSections: EnergySection[],
    trackABars: number[],
    trackBBars: number[],
    trackADrops: DropPoint[],
    trackBDrops: DropPoint[],
    trackABuildups: DropPoint[],
    trackBBuildups: DropPoint[]
  ): TransitionPlan {
    // Point de sortie optimal pour Track A
    const trackAOutPoint = this.findOptimalOutPoint(
      trackADuration,
      trackASections,
      trackABars,
      trackADrops,
      trackABuildups
    );

    // Point d'entrée optimal pour Track B
    const trackBInPoint = this.findOptimalInPoint(
      trackBDuration,
      trackBSections,
      trackBBars,
      trackBDrops,
      trackBBuildups
    );

    // Calculer le score de correspondance
    const energyMatch = this.calculateEnergyMatch(
      trackAOutPoint,
      trackBInPoint,
      trackASections,
      trackBSections
    );

    const harmonicMatch = this.calculateHarmonicMatch(); // TODO: implémenter

    const confidence = (energyMatch + harmonicMatch) / 2;

    return {
      trackAOutPoint,
      trackBInPoint,
      transitionDuration: this.config.crossfadeDuration,
      energyMatch,
      harmonicMatch,
      confidence,
    };
  }

  /**
   * Trouve le point de sortie optimal pour Track A
   */
  private findOptimalOutPoint(
    duration: number,
    sections: EnergySection[],
    bars: number[],
    drops: DropPoint[],
    buildups: DropPoint[]
  ): number {
    const targetTime = duration - this.config.transitionWindow;

    // Éviter les sections à basse énergie
    const lowEnergySections = findLowEnergySections(sections);
    const lowEnergyRanges = lowEnergySections.map(s => ({
      start: s.startTime,
      end: s.endTime,
    }));

    // Trouver les points candidats dans la fenêtre de transition
    const candidates: number[] = [];

    // Ajouter les débuts de mesures dans la fenêtre
    if (this.config.preferBarAlignment) {
      for (const bar of bars) {
        if (bar >= targetTime - 5 && bar <= targetTime + 5) {
          candidates.push(bar);
        }
      }
    }

    // Ajouter les drops dans la fenêtre
    for (const drop of drops) {
      if (drop.timestamp >= targetTime - 5 && drop.timestamp <= targetTime + 5) {
        candidates.push(drop.timestamp);
      }
    }

    // Si aucun candidat, utiliser le temps cible
    if (candidates.length === 0) {
      return targetTime;
    }

    // Filtrer les candidats qui sont dans des zones à basse énergie
    const validCandidates = candidates.filter(
      c => !this.isInLowEnergyRange(c, lowEnergyRanges)
    );

    // Si aucun candidat valide, utiliser le temps cible
    if (validCandidates.length === 0) {
      return targetTime;
    }

    // Retourner le candidat le plus proche du temps cible
    return findNearestBar(validCandidates, targetTime);
  }

  /**
   * Trouve le point d'entrée optimal pour Track B
   */
  private findOptimalInPoint(
    duration: number,
    sections: EnergySection[],
    bars: number[],
    drops: DropPoint[],
    buildups: DropPoint[]
  ): number {
    // Préférer les drops pour l'entrée
    const bestDrop = findBestDropPoint(drops, 0, 10);
    if (bestDrop) {
      return bestDrop.timestamp;
    }

    // Sinon, préférer une section à haute énergie
    const highEnergySections = findHighEnergySections(sections);
    if (highEnergySections.length > 0) {
      return highEnergySections[0].startTime;
    }

    // Sinon, utiliser le début d'une mesure
    if (bars.length > 0) {
      return bars[0];
    }

    // Fallback: début du morceau
    return 0;
  }

  /**
   * Vérifie si un timestamp est dans une zone à basse énergie
   */
  private isInLowEnergyRange(
    timestamp: number,
    ranges: { start: number; end: number }[]
  ): boolean {
    for (const range of ranges) {
      if (timestamp >= range.start && timestamp <= range.end) {
        return true;
      }
    }
    return false;
  }

  /**
   * Calcule le score de correspondance d'énergie
   */
  private calculateEnergyMatch(
    outPoint: number,
    inPoint: number,
    trackASections: EnergySection[],
    trackBSections: EnergySection[]
  ): number {
    // Trouver la section de sortie
    const outSection = trackASections.find(
      s => outPoint >= s.startTime && outPoint <= s.endTime
    );

    // Trouver la section d'entrée
    const inSection = trackBSections.find(
      s => inPoint >= s.startTime && inPoint <= s.endTime
    );

    if (!outSection || !inSection) {
      return 0.5; // Score moyen par défaut
    }

    // Préférer les transitions haute énergie → haute énergie
    const energyScore = this.getEnergyScore(outSection.energyLevel) *
                        this.getEnergyScore(inSection.energyLevel);

    return energyScore;
  }

  /**
   * Calcule le score d'énergie pour un niveau
   */
  private getEnergyScore(level: 'low' | 'medium' | 'high' | 'explosive'): number {
    switch (level) {
      case 'low': return 0.3;
      case 'explosive': return 1.2;
      case 'medium': return 0.6;
      case 'high': return 1.0;
    }
  }

  /**
   * Calcule le score de correspondance harmonique (TODO)
   */
  private calculateHarmonicMatch(): number {
    // TODO: implémenter avec Camelot wheel
    return 0.5;
  }

  /**
   * Génère les points de transition pour un morceau
   */
  generateTransitionPoints(
    duration: number,
    sections: EnergySection[],
    bars: number[],
    drops: DropPoint[]
  ): TransitionPoint[] {
    const points: TransitionPoint[] = [];
    const windowStart = duration - this.config.transitionWindow;

    // Générer des points tous les 0.5 secondes dans la fenêtre
    for (let t = windowStart; t < duration; t += 0.5) {
      const section = sections.find(
        s => t >= s.startTime && t <= s.endTime
      );

      const isBar = isBarStart(bars, t, 0.1);
      const energyLevel = section?.energyLevel || 'medium';
      const sectionType = section?.type || 'unknown';

      // Calculer la confiance basée sur plusieurs facteurs
      let confidence = 0.5;

      // Préférer les débuts de mesure
      if (isBar) confidence += 0.2;

      // Préférer les sections à haute énergie
      if (energyLevel === 'high') confidence += 0.2;
      else if (energyLevel === 'low') confidence -= 0.2;

      // Éviter les intros et outros
      if (sectionType === 'intro' || sectionType === 'outro') {
        confidence -= 0.3;
      }

      confidence = Math.max(0, Math.min(1, confidence));

      points.push({
        timestamp: t,
        energyLevel,
        sectionType,
        isBarStart: isBar,
        confidence,
      });
    }

    // Trier par confiance décroissante
    points.sort((a, b) => b.confidence - a.confidence);

    return points;
  }

  /**
   * Met à jour la configuration du moteur
   */
  updateConfig(config: Partial<TransitionEngineConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Obtient la configuration actuelle
   */
  getConfig(): TransitionEngineConfig {
    return { ...this.config };
  }
}

// Instance singleton
export const transitionEngine = new TransitionEngine();
