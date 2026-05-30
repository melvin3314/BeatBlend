import {
    Playlist,
    PlaylistTrack,
    PlaylistTransition
} from "../../types/transitions";
import { detectBars } from "../analysis/barDetectionService";
import { analyzeBpm } from "../analysis/bpmDetectionService";
import { detectDrops } from "../analysis/dropDetectionService";
import { analyzeEnergy, analyzeEnergyFallback } from "../analysis/energyAnalysisService";
import { transitionSelector } from "../transition/transitionSelector";

export interface PlaylistManagerConfig {
  minTracks: number;
  energyCurvePreference: "ascending" | "descending" | "varied";
  harmonicWeight: number;
  bpmTolerance: number;
}

/**
 * Gestionnaire de playlist intelligente
 * Analyse, ordonne et planifie les transitions pour un set DJ complet
 */
export class PlaylistManager {
  private config: PlaylistManagerConfig;
  private playlist: Playlist | null = null;

  constructor(config?: Partial<PlaylistManagerConfig>) {
    this.config = {
      minTracks: 4,
      energyCurvePreference: "varied",
      harmonicWeight: 0.3,
      bpmTolerance: 10,
      ...config,
    };
  }

  /**
   * Analyse tous les morceaux de la playlist
   */
  async analyzePlaylist(tracks: { name: string; uri: string }[]): Promise<Playlist> {
    const analyzedTracks: PlaylistTrack[] = [];

    for (const track of tracks) {
      const analyzed = await this.analyzeTrack(track);
      analyzedTracks.push(analyzed);
    }

    // Ordonner les morceaux intelligemment
    const orderedTracks = this.orderTracks(analyzedTracks);

    // Calculer les transitions
    const transitions = await this.calculateTransitions(orderedTracks);

    // Calculer la courbe d'énergie
    const energyCurve = this.calculateEnergyCurve(orderedTracks);

    const playlist: Playlist = {
      tracks: orderedTracks,
      transitions,
      totalDuration: orderedTracks.reduce((sum, t) => sum + t.duration, 0),
      averageBpm: this.calculateAverageBpm(orderedTracks),
      energyCurve,
    };

    this.playlist = playlist;
    return playlist;
  }

  /**
   * Analyse un morceau individuel
   */
  private async analyzeTrack(track: { name: string; uri: string }): Promise<PlaylistTrack> {
    const bpmResult = await analyzeBpm(track.uri);
    const energyResult = await analyzeEnergy(track.uri);

    const beats = (bpmResult as any)?.beats || [];
    const bars = detectBars(beats).bars;
    const energyFinal = energyResult || analyzeEnergyFallback(beats, bpmResult?.duration || 0);
    const drops = detectDrops(energyFinal.sections, energyFinal.rms, energyFinal.timestamps);

    return {
      id: Math.random().toString(36).substr(2, 9),
      name: track.name,
      uri: track.uri,
      bpm: bpmResult?.bpm || 0,
      duration: bpmResult?.duration || 0,
      energy: this.calculateAverageEnergy(energyFinal.sections),
      beats,
      sections: energyFinal.sections,
      drops: drops.drops,
      buildups: drops.buildups,
    };
  }

  /**
   * Ordonne les morceaux intelligemment
   */
  private orderTracks(tracks: PlaylistTrack[]): PlaylistTrack[] {
    if (tracks.length < 2) {
      return tracks;
    }

    // Stratégie d'ordonnancement selon la préférence
    switch (this.config.energyCurvePreference) {
      case "ascending":
        return this.orderByAscendingEnergy(tracks);
      case "descending":
        return this.orderByDescendingEnergy(tracks);
      case "varied":
      default:
        return this.orderVariedEnergy(tracks);
    }
  }

  /**
   * Ordonne par énergie ascendante
   */
  private orderByAscendingEnergy(tracks: PlaylistTrack[]): PlaylistTrack[] {
    return [...tracks].sort((a, b) => a.energy - b.energy);
  }

  /**
   * Ordonne par énergie descendante
   */
  private orderByDescendingEnergy(tracks: PlaylistTrack[]): PlaylistTrack[] {
    return [...tracks].sort((a, b) => b.energy - a.energy);
  }

  /**
   * Ordonne avec énergie variée (montée et descente)
   */
  private orderVariedEnergy(tracks: PlaylistTrack[]): PlaylistTrack[] {
    const sorted = [...tracks].sort((a, b) => a.energy - b.energy);
    const ordered: PlaylistTrack[] = [];
    let low = 0;
    let high = sorted.length - 1;

    // Alterner entre basse et haute énergie
    for (let i = 0; i < sorted.length; i++) {
      if (i % 2 === 0) {
        ordered.push(sorted[high]);
        high--;
      } else {
        ordered.push(sorted[low]);
        low++;
      }
    }

    return ordered;
  }

  /**
   * Calcule les transitions entre les morceaux
   */
  private async calculateTransitions(tracks: PlaylistTrack[]): Promise<PlaylistTransition[]> {
    const transitions: PlaylistTransition[] = [];

    for (let i = 0; i < tracks.length - 1; i++) {
      const fromTrack = tracks[i];
      const toTrack = tracks[i + 1];

      // Calculer les points de transition optimaux
      const trackAOutPoint = this.findOptimalOutPoint(fromTrack);
      const trackBInPoint = this.findOptimalInPoint(toTrack);

      // Générer le plan de transition
      const transitionPlan = transitionSelector.generateTransitionPlan(
        fromTrack,
        toTrack,
        trackAOutPoint,
        trackBInPoint
      );

      transitions.push({
        fromTrackId: fromTrack.id,
        toTrackId: toTrack.id,
        transitionPlan,
        estimatedTime: transitionPlan.totalDuration,
      });
    }

    return transitions;
  }

  /**
   * Trouve le point de sortie optimal pour un morceau
   */
  private findOptimalOutPoint(track: PlaylistTrack): number {
    const targetTime = track.duration - 30; // 30 secondes avant la fin

    // Éviter les sections à basse énergie
    const lowEnergySections = track.sections.filter(s => s.energyLevel === "low");
    const lowEnergyRanges = lowEnergySections.map(s => ({
      start: s.startTime,
      end: s.endTime,
    }));

    // Chercher les drops dans la fenêtre
    const dropsInWindow = track.drops.filter(
      d => d.timestamp >= targetTime - 5 && d.timestamp <= targetTime + 5
    );

    if (dropsInWindow.length > 0) {
      // Retourner le drop le plus proche
      return dropsInWindow[0].timestamp;
    }

    // Sinon, utiliser le temps cible
    return targetTime;
  }

  /**
   * Trouve le point d'entrée optimal pour un morceau
   */
  private findOptimalInPoint(track: PlaylistTrack): number {
    // Préférer les drops
    if (track.drops.length > 0) {
      return track.drops[0].timestamp;
    }

    // Sinon, préférer une section à haute énergie
    const highEnergySections = track.sections.filter(s => s.energyLevel === "high");
    if (highEnergySections.length > 0) {
      return highEnergySections[0].startTime;
    }

    // Fallback: début du morceau
    return 0;
  }

  /**
   * Calcule la courbe d'énergie du set
   */
  private calculateEnergyCurve(tracks: PlaylistTrack[]): number[] {
    return tracks.map(t => t.energy);
  }

  /**
   * Calcule le BPM moyen du set
   */
  private calculateAverageBpm(tracks: PlaylistTrack[]): number {
    if (tracks.length === 0) return 0;
    const sum = tracks.reduce((acc, t) => acc + t.bpm, 0);
    return sum / tracks.length;
  }

  /**
   * Calcule l'énergie moyenne d'un morceau
   */
  private calculateAverageEnergy(sections: any[]): number {
    if (sections.length === 0) return 0.5;

    const energySum = sections.reduce((sum, s) => {
      const score = this.getEnergyScore(s.energyLevel);
      return sum + score;
    }, 0);

    return energySum / sections.length;
  }

  /**
   * Obtient le score d'énergie pour un niveau
   */
  private getEnergyScore(level: "low" | "medium" | "high"): number {
    switch (level) {
      case "low":
        return 0.3;
      case "medium":
        return 0.6;
      case "high":
        return 1.0;
    }
  }

  /**
   * Obtient la playlist actuelle
   */
  getPlaylist(): Playlist | null {
    return this.playlist;
  }

  /**
   * Obtient le morceau actuel
   */
  getCurrentTrack(): PlaylistTrack | null {
    if (!this.playlist || this.playlist.tracks.length === 0) {
      return null;
    }
    return this.playlist.tracks[0];
  }

  /**
   * Obtient le prochain morceau
   */
  getNextTrack(): PlaylistTrack | null {
    if (!this.playlist || this.playlist.tracks.length < 2) {
      return null;
    }
    return this.playlist.tracks[1];
  }

  /**
   * Passe au morceau suivant
   */
  advanceToNext(): PlaylistTrack | null {
    if (!this.playlist || this.playlist.tracks.length < 2) {
      return null;
    }

    const current = this.playlist.tracks.shift();
    const currentTransition = this.playlist.transitions.shift();

    return current || null;
  }

  /**
   * Met à jour la configuration
   */
  updateConfig(config: Partial<PlaylistManagerConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Réinitialise la playlist
   */
  reset() {
    this.playlist = null;
  }
}

// Instance singleton
export const playlistManager = new PlaylistManager();
