import { PRESETS, type PresetName } from "../../engine/TransitionPresets";
import type { PlaylistTrack } from "../../types/transitions";
import type { Genre } from "../analysis/genreDetectionService";
import { calculateCamelotCompatibility } from "../analysis/keyDetectionService";
import { getMixProfile } from "../mix/genreMixProfiles";

export interface TransitionSelectorConfig {
  preferVariation: boolean;
  energyThreshold: number;
  bpmTolerance: number;
  harmonicWeight: number;
  energyWeight: number;
  bpmWeight: number;
  sectionWeight: number;
  dropWeight: number;
}

export interface PresetSelection {
  presetName: PresetName;
  seed: number; // seed pour la randomisation déterministe de la durée
  confidence: number;
  scores: Record<string, number>;
}

/**
 * Smart Transition Selector
 * Choisit dynamiquement le meilleur preset de transition selon 10+ critères musicaux.
 *
 * Critères évalués pour chaque preset :
 * 1. Différence de BPM
 * 2. Énergie RMS des sections
 * 3. Section actuelle (intro/outro/drop/verse)
 * 4. Présence de drop proche
 * 5. Compatibilité harmonique Camelot
 * 6. Durée restante du morceau
 * 7. Variation vs styles récents
 * 8. Randomisation contrôlée
 */
export class TransitionSelector {
  private config: TransitionSelectorConfig;
  private recentPresets: PresetName[] = [];
  private maxRecentPresets = 3;

  constructor(config?: Partial<TransitionSelectorConfig>) {
    this.config = {
      preferVariation: true,
      energyThreshold: 0.3,
      bpmTolerance: 10,
      harmonicWeight: 0.25,
      energyWeight: 0.25,
      bpmWeight: 0.2,
      sectionWeight: 0.15,
      dropWeight: 0.15,
      ...config,
    };
  }

  /**
   * Sélectionne le meilleur preset de transition entre deux morceaux.
   * Retourne le preset + un seed pour la durée déterministe.
   */
  selectPreset(
    trackA: PlaylistTrack,
    trackB: PlaylistTrack,
    trackAOutPoint: number,
    trackBInPoint: number
  ): PresetSelection {
    const presetNames = Object.keys(PRESETS) as PresetName[];
    const scored = presetNames.map((name) => ({
      name,
      ...this.scorePreset(name, trackA, trackB, trackAOutPoint, trackBInPoint),
    }));

    // Trier par score global
    scored.sort((a, b) => b.totalScore - a.totalScore);

    // Éviter la répétition si variation activée
    let best = scored[0];
    if (this.config.preferVariation && this.recentPresets.includes(best.name)) {
      const alternative = scored.find((s) => !this.recentPresets.includes(s.name));
      if (alternative && alternative.totalScore > best.totalScore * 0.7) {
        best = alternative;
      }
    }

    this.updateRecentPresets(best.name);

    // Seed déterministe basé sur le hash du nom de morceau A+B
    const seed = this.hashSeed(`${trackA.name}|${trackB.name}`);

    return {
      presetName: best.name,
      seed,
      confidence: best.totalScore,
      scores: best.scores,
    };
  }

  /**
   * Score un preset selon les critères musicaux.
   */
  private scorePreset(
    presetName: PresetName,
    trackA: PlaylistTrack,
    trackB: PlaylistTrack,
    trackAOutPoint: number,
    trackBInPoint: number
  ): { totalScore: number; scores: Record<string, number> } {
    const preset = PRESETS[presetName];
    const scores: Record<string, number> = {};

    // --- 1. DIFFÉRENCE BPM ---
    const bpmDiff = Math.abs(trackA.bpm - trackB.bpm);
    const bpmScore = Math.max(0, 1 - bpmDiff / 30);
    scores.bpm = bpmScore;

    // --- 2. ÉNERGIE RMS ---
    const sectionA = trackA.sections.find(
      (s) => trackAOutPoint >= s.startTime && trackAOutPoint <= s.endTime
    );
    const sectionB = trackB.sections.find(
      (s) => trackBInPoint >= s.startTime && trackBInPoint <= s.endTime
    );
    const energyA = this.getEnergyScore(sectionA?.energyLevel ?? "medium");
    const energyB = this.getEnergyScore(sectionB?.energyLevel ?? "medium");
    const energyScore = 1 - Math.abs(energyA - energyB); // préfère cohérence
    scores.energy = energyScore;

    // Calcul de l'énergie moyenne (utilisé plus tard aussi)
    const avgEnergy = (trackA.energy + trackB.energy) / 2;

    // --- 3. SECTION SPÉCIFIQUE ---
    let sectionScore = 0.5;
    if (presetName === "ambient_fade" && (sectionA?.type === "outro" || sectionB?.type === "intro")) {
      sectionScore = 0.95;
    } else if (presetName === "energy_boost" && (sectionB?.type === "drop" || sectionB?.energyLevel === "high")) {
      sectionScore = 0.95;
    } else if (presetName === "quick_cut" && (sectionB?.type === "drop" || sectionA?.type === "break")) {
      sectionScore = 0.85;
    } else if (presetName === "bass_swap" && sectionA?.type !== "outro" && sectionB?.type !== "intro") {
      sectionScore = 0.8;
    } else if (presetName === "vocal_dip" && (sectionA?.type === "verse" || sectionB?.type === "verse")) {
      sectionScore = 0.9;
    } else if (presetName === "rise_up" && (sectionB?.type === "buildup" || sectionB?.energyLevel === "high")) {
      sectionScore = 0.95;
    } else if (presetName === "tension_release" && avgEnergy > 0.6) {
      sectionScore = 0.9;
    } else if ((presetName === "kick_sync_cut" || presetName === "power_cut") && sectionB?.type === "drop") {
      sectionScore = 0.95;
    } else if (presetName === "drop_in" && sectionB?.type === "drop") {
      sectionScore = 1.0;
    }
    scores.section = sectionScore;

    // --- 4. DROP PROXIMITÉ ---
    const dropNearB = trackB.drops.some(
      (d) => Math.abs(d.timestamp - trackBInPoint) < 3
    );
    const dropNearA = trackA.drops.some(
      (d) => Math.abs(d.timestamp - trackAOutPoint) < 3
    );
    let dropScore = 0.5;
    if (presetName === "energy_boost" && dropNearB) dropScore = 1.0;
    else if (presetName === "quick_cut" && dropNearB) dropScore = 0.9;
    else if (presetName === "bass_swap" && !dropNearA && !dropNearB) dropScore = 0.8;
    else if (presetName === "echo_out" && !dropNearA) dropScore = 0.85;
    else if (presetName === "ambient_fade" && !dropNearA && !dropNearB) dropScore = 0.9;
    else if (presetName === "drop_in" && dropNearB) dropScore = 1.0;
    else if ((presetName === "kick_sync_cut" || presetName === "power_cut") && dropNearB) dropScore = 0.95;
    else if (presetName === "rise_up" && !dropNearB) dropScore = 0.85;
    else if (presetName === "tension_release" && dropNearB) dropScore = 0.9;
    scores.drop = dropScore;

    // --- 5. HARMONIE CAMELOT ---
    const harmonicScore = trackA.camelotWheel && trackB.camelotWheel
      ? calculateCamelotCompatibility(trackA.camelotWheel, trackB.camelotWheel)
      : 0.5;
    scores.harmonic = harmonicScore;

    // --- 6. DURÉE RESTANTE ---
    const timeRemaining = trackA.duration - trackAOutPoint;
    let durationScore = 0.5;
    if (presetName === "ambient_fade" && timeRemaining > 20) durationScore = 0.95;
    else if (presetName === "smooth_blend" && timeRemaining > 8) durationScore = 0.9;
    else if (presetName === "quick_cut" && timeRemaining < 5) durationScore = 0.9;
    else if (presetName === "echo_out" && timeRemaining > 12) durationScore = 0.85;
    else if (presetName === "kick_sync_cut" && timeRemaining < 2) durationScore = 0.95;
    else if (presetName === "power_cut" && timeRemaining < 2) durationScore = 0.95;
    else if (presetName === "drop_in" && timeRemaining > 3) durationScore = 0.9;
    else if (presetName === "rise_up" && timeRemaining > 8) durationScore = 0.85;
    else if (presetName === "tension_release" && timeRemaining > 5) durationScore = 0.9;
    else if (presetName === "vocal_dip" && timeRemaining > 8) durationScore = 0.85;
    scores.duration = durationScore;

    // --- 7. FEEL vs ÉNERGIE GLOBALE ---
    let feelScore = 0.5;
    if (preset.feel === "ethereal" && avgEnergy < 0.4) feelScore = 0.9;
    else if (preset.feel === "aggressive" && avgEnergy > 0.7) feelScore = 0.9;
    else if (preset.feel === "smooth" && avgEnergy >= 0.3 && avgEnergy <= 0.7) feelScore = 0.85;
    else if (preset.feel === "punchy" && avgEnergy > 0.5) feelScore = 0.8;
    scores.feel = feelScore;

    // --- 8. SCORE GENRE ---
    let genreScore = 0.5;
    const fromGenre = (trackA.genre as Genre) ?? "unknown";
    const toGenre = (trackB.genre as Genre) ?? "unknown";
    const profileA = getMixProfile(fromGenre);
    const profileB = getMixProfile(toGenre);

    if (profileA.preferredPresets.includes(presetName)) {
      genreScore += 0.3;
    }
    if (profileB.preferredPresets.includes(presetName)) {
      genreScore += 0.2;
    }
    if (profileA.avoidPresets.includes(presetName)) {
      genreScore -= 0.4;
    }
    if (profileB.avoidPresets.includes(presetName)) {
      genreScore -= 0.3;
    }
    // Bonus si les deux genres préfèrent le même preset (cohérence)
    if (
      profileA.preferredPresets.includes(presetName) &&
      profileB.preferredPresets.includes(presetName)
    ) {
      genreScore += 0.15;
    }
    genreScore = Math.max(0, Math.min(1, genreScore));
    scores.genre = genreScore;

    // --- 9. PRIORITÉ DE BASE DU PRESET ---
    scores.basePriority = preset.basePriority;

    // --- CALCUL GLOBAL PONDÉRÉ ---
    const totalScore =
      bpmScore * this.config.bpmWeight +
      energyScore * this.config.energyWeight +
      sectionScore * this.config.sectionWeight +
      dropScore * this.config.dropWeight +
      harmonicScore * this.config.harmonicWeight +
      durationScore * 0.08 +
      feelScore * 0.08 +
      genreScore * 0.12 +
      preset.basePriority * 0.1;

    return { totalScore: Math.min(1, totalScore), scores };
  }

  /**
   * Hash simple pour générer un seed déterministe à partir d'une string.
   */
  private hashSeed(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) / 2147483647; // Normaliser 0-1
  }

  private getEnergyScore(level: "low" | "medium" | "high" | "explosive"): number {
    switch (level) {
      case "low": return 0.3;
      case "medium": return 0.6;
      case "high": return 0.85;
      case "explosive": return 1.0;
    }
  }

  private updateRecentPresets(name: PresetName) {
    this.recentPresets.unshift(name);
    if (this.recentPresets.length > this.maxRecentPresets) {
      this.recentPresets.pop();
    }
  }

  updateConfig(config: Partial<TransitionSelectorConfig>) {
    this.config = { ...this.config, ...config };
  }

  resetHistory() {
    this.recentPresets = [];
  }

  /**
   * Compatibilité avec l'ancienne API utilisée par playlistManager.
   * Retourne un TransitionPlan basique à partir du preset sélectionné.
   */
  generateTransitionPlan(
    trackA: PlaylistTrack,
    trackB: PlaylistTrack,
    trackAOutPoint: number,
    trackBInPoint: number
  ): import("../../types/transitions").TransitionPlan {
    const sel = this.selectPreset(trackA, trackB, trackAOutPoint, trackBInPoint);
    const preset = PRESETS[sel.presetName];
    const duration = preset.baseDuration;

    return {
      style: "crossfade", // legacy field
      effects: [],
      trackAOutPoint,
      trackBInPoint,
      totalDuration: duration,
      energyMatch: sel.confidence,
      harmonicMatch: sel.scores.harmonic ?? 0.5,
      bpmProximity: sel.scores.bpm ?? 0.5,
      confidence: sel.confidence,
    };
  }
}

export const transitionSelector = new TransitionSelector();
