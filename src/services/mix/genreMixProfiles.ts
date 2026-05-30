/**
 * Genre Mix Profiles
 * Définit pour chaque genre musical le style de mix optimal.
 *
 * Chaque profil contrôle :
 * - Durée des transitions
 * - Presets prioritaires
 * - FX utilisés
 * - Gestion des vocals
 * - Intensité des drops
 * - Vitesse des cuts
 * - Comportement global du mix
 */

import type { PresetName } from "../../engine/TransitionPresets";
import type { Genre } from "../analysis/genreDetectionService";

export type MixFeel = "smooth" | "aggressive" | "abrupt" | "ethereal" | "punchy";

export interface GenreMixProfile {
  /** Nom affiché du style */
  label: string;

  /** Durée de transition préférée en ms */
  transitionDuration: number;
  /** Variance autour de la durée */
  durationVariance: number;

  /** Durée de crossfade en ms */
  crossfadeDuration: number;

  /** Durée de tempo transition en ms */
  tempoTransitionDuration: number;

  /** Presets prioritaires (ordre = priorité) */
  preferredPresets: PresetName[];

  /** Presets à éviter */
  avoidPresets: PresetName[];

  /** Feel global des transitions */
  feel: MixFeel;

  /** Intensité du ducking (0-1) */
  duckingAmount: number;

  /** Gestion des vocals */
  vocalHandling: "preserve" | "cut" | "blend" | "echo_out";

  /** Intensité des drops (0-1) */
  dropIntensity: number;

  /** Vitesse des cuts (0=lent, 1=rapide) */
  cutSpeed: number;

  /** Utiliser des loops rythmiques ? */
  useLoops: boolean;

  /** Loop duration en beats si useLoops=true */
  loopBeats: number;

  /** FX principaux à déclencher */
  primaryFx: string[];

  /** Adaptation du BPM matching */
  bpmMatching: "strict" | "relaxed" | "creative";

  /** Description du comportement pour debug */
  description: string;
}

export const GENRE_MIX_PROFILES: Record<Genre, GenreMixProfile> = {
  // --- TECHNO ---
  techno: {
    label: "Techno",
    transitionDuration: 12000,
    durationVariance: 3000,
    crossfadeDuration: 10000,
    tempoTransitionDuration: 6000,
    preferredPresets: [
      "smooth_blend",
      "filter_transition",
      "ambient_fade",
      "energy_boost",
    ],
    avoidPresets: ["power_cut", "kick_sync_cut", "quick_cut"],
    feel: "smooth",
    duckingAmount: 0.2,
    vocalHandling: "blend",
    dropIntensity: 0.6,
    cutSpeed: 0.2,
    useLoops: true,
    loopBeats: 8,
    primaryFx: ["filter_highpass", "filter_lowpass", "loop_roll", "reverb_tail"],
    bpmMatching: "strict",
    description:
      "Transitions longues et hypnotiques. EQ blending progressif, filtres, loops 8 beats. BPM match strict pour garder le groove.",
  },

  // --- HARD TECHNO ---
  hard_techno: {
    label: "Hard Techno",
    transitionDuration: 8000,
    durationVariance: 2000,
    crossfadeDuration: 6000,
    tempoTransitionDuration: 4000,
    preferredPresets: [
      "power_cut",
      "kick_sync_cut",
      "energy_boost",
      "drop_in",
    ],
    avoidPresets: ["ambient_fade", "smooth_blend"],
    feel: "aggressive",
    duckingAmount: 0.0,
    vocalHandling: "cut",
    dropIntensity: 0.95,
    cutSpeed: 0.7,
    useLoops: true,
    loopBeats: 4,
    primaryFx: [
      "distortion",
      "sidechain",
      "transient_duck",
      "beat_repeat",
      "vinyl_brake",
    ],
    bpmMatching: "strict",
    description:
      "Transitions agressives et explosives. Kick sync cuts, power cuts, distortion. Vocals coupées net. Loops 4 beats pour maintenir la tension.",
  },

  // --- HOUSE ---
  house: {
    label: "House",
    transitionDuration: 10000,
    durationVariance: 2500,
    crossfadeDuration: 8000,
    tempoTransitionDuration: 5000,
    preferredPresets: [
      "smooth_blend",
      "filter_transition",
      "echo_out",
      "energy_boost",
    ],
    avoidPresets: ["power_cut", "kick_sync_cut"],
    feel: "smooth",
    duckingAmount: 0.3,
    vocalHandling: "blend",
    dropIntensity: 0.5,
    cutSpeed: 0.3,
    useLoops: true,
    loopBeats: 8,
    primaryFx: [
      "eq_fade",
      "filter_highpass",
      "delay_throw",
      "reverb_tail",
      "stereo_widen",
    ],
    bpmMatching: "strict",
    description:
      "Transitions fluides et groove-oriented. EQ fades, delays, reverb tails. Vocals préservées et blendées. Ambiance chaude et naturelle.",
  },

  // --- EDM ---
  edm: {
    label: "EDM",
    transitionDuration: 8000,
    durationVariance: 2000,
    crossfadeDuration: 6000,
    tempoTransitionDuration: 4000,
    preferredPresets: [
      "drop_in",
      "energy_boost",
      "tension_release",
      "smooth_blend",
    ],
    avoidPresets: ["ambient_fade"],
    feel: "punchy",
    duckingAmount: 0.15,
    vocalHandling: "echo_out",
    dropIntensity: 0.85,
    cutSpeed: 0.5,
    useLoops: false,
    loopBeats: 4,
    primaryFx: [
      "riser",
      "downlifter",
      "impact_hit",
      "white_noise",
      "echo_out",
      "reverb_tail",
    ],
    bpmMatching: "creative",
    description:
      "Transitions dramatiques avec build-ups et drops. Risers, impacts, white noise. Echo out sur vocals. Energy management fort.",
  },

  // --- TRAP ---
  trap: {
    label: "Trap",
    transitionDuration: 7000,
    durationVariance: 2000,
    crossfadeDuration: 5000,
    tempoTransitionDuration: 3500,
    preferredPresets: [
      "kick_sync_cut",
      "power_cut",
      "tension_release",
      "drop_in",
    ],
    avoidPresets: ["ambient_fade"],
    feel: "aggressive",
    duckingAmount: 0.1,
    vocalHandling: "echo_out",
    dropIntensity: 0.9,
    cutSpeed: 0.8,
    useLoops: true,
    loopBeats: 4,
    primaryFx: [
      "bass_swap",
      "tape_stop",
      "echo_out",
      "stutter_cut",
      "beat_repeat",
      "transient_duck",
    ],
    bpmMatching: "creative",
    description:
      "Bass swaps, tape stops, stutter cuts. Vocals en echo out. Transitions rapides et punchy. 808 priority.",
  },

  // --- RAP ---
  rap: {
    label: "Rap",
    transitionDuration: 8000,
    durationVariance: 2000,
    crossfadeDuration: 6000,
    tempoTransitionDuration: 4000,
    preferredPresets: [
      "smooth_blend",
      "echo_out",
      "tension_release",
      "kick_sync_cut",
    ],
    avoidPresets: ["power_cut"],
    feel: "punchy",
    duckingAmount: 0.25,
    vocalHandling: "preserve",
    dropIntensity: 0.6,
    cutSpeed: 0.4,
    useLoops: false,
    loopBeats: 4,
    primaryFx: [
      "echo_out",
      "reverb_tail",
      "eq_fade",
      "bass_swap",
      "delay_throw",
    ],
    bpmMatching: "relaxed",
    description:
      "Vocals prioritaires — jamais coupés brutalement. Echo out, reverb tails. Bass swaps sur les breaks. Transitions respectueuses du flow.",
  },

  // --- RAGE ---
  rage: {
    label: "Rage",
    transitionDuration: 5000,
    durationVariance: 1500,
    crossfadeDuration: 3500,
    tempoTransitionDuration: 2500,
    preferredPresets: ["power_cut", "kick_sync_cut", "drop_in", "quick_cut"],
    avoidPresets: ["ambient_fade", "smooth_blend"],
    feel: "abrupt",
    duckingAmount: 0.0,
    vocalHandling: "cut",
    dropIntensity: 1.0,
    cutSpeed: 1.0,
    useLoops: true,
    loopBeats: 2,
    primaryFx: [
      "distortion",
      "tape_stop",
      "beat_repeat",
      "stutter_cut",
      "vinyl_brake",
      "transient_duck",
    ],
    bpmMatching: "creative",
    description:
      "Cuts ultra-rapides, distortion, vinyl brake. 2-beat loops. Vocals coupés net. Maximum d'agressivité et d'impact.",
  },

  // --- PHONK ---
  phonk: {
    label: "Phonk",
    transitionDuration: 7000,
    durationVariance: 2000,
    crossfadeDuration: 5000,
    tempoTransitionDuration: 3500,
    preferredPresets: [
      "power_cut",
      "tension_release",
      "kick_sync_cut",
      "echo_out",
    ],
    avoidPresets: ["smooth_blend"],
    feel: "aggressive",
    duckingAmount: 0.05,
    vocalHandling: "echo_out",
    dropIntensity: 0.85,
    cutSpeed: 0.7,
    useLoops: true,
    loopBeats: 4,
    primaryFx: [
      "distortion",
      "reverse_swell",
      "vinyl_brake",
      "cowbell",
      "bass_impact",
      "tape_stop",
    ],
    bpmMatching: "creative",
    description:
      "Distortion, reverse FX, vinyl brake, cowbell accents. Bass impacts. Atmosphère sombre et lourde. Transitions brutes.",
  },

  // --- DRILL ---
  drill: {
    label: "Drill",
    transitionDuration: 6000,
    durationVariance: 1500,
    crossfadeDuration: 4500,
    tempoTransitionDuration: 3000,
    preferredPresets: [
      "kick_sync_cut",
      "power_cut",
      "tension_release",
      "drop_in",
    ],
    avoidPresets: ["ambient_fade", "smooth_blend"],
    feel: "aggressive",
    duckingAmount: 0.0,
    vocalHandling: "cut",
    dropIntensity: 0.9,
    cutSpeed: 0.8,
    useLoops: true,
    loopBeats: 4,
    primaryFx: [
      "slide",
      "beat_repeat",
      "bass_swap",
      "transient_duck",
      "stutter_cut",
    ],
    bpmMatching: "creative",
    description:
      "Slide FX, beat repeats, bass swaps. Aggressif mais structuré. Vocals coupés sur les drops. 4-beat loops sur les breaks.",
  },

  // --- REGGAE ---
  reggae: {
    label: "Reggae",
    transitionDuration: 12000,
    durationVariance: 3000,
    crossfadeDuration: 10000,
    tempoTransitionDuration: 6000,
    preferredPresets: [
      "smooth_blend",
      "ambient_fade",
      "echo_out",
      "filter_transition",
    ],
    avoidPresets: ["power_cut", "kick_sync_cut", "quick_cut"],
    feel: "smooth",
    duckingAmount: 0.4,
    vocalHandling: "preserve",
    dropIntensity: 0.2,
    cutSpeed: 0.1,
    useLoops: false,
    loopBeats: 8,
    primaryFx: [
      "delay_throw",
      "reverb_tail",
      "eq_fade",
      "stereo_widen",
    ],
    bpmMatching: "relaxed",
    description:
      "Crossfades ultra-doux, delays, reverb tails. Vocals sacrées — jamais coupés. Groove naturel préservé. Ambiance roots et relax.",
  },

  // --- AFRO ---
  afro: {
    label: "Afro",
    transitionDuration: 9000,
    durationVariance: 2500,
    crossfadeDuration: 7000,
    tempoTransitionDuration: 4500,
    preferredPresets: [
      "smooth_blend",
      "energy_boost",
      "filter_transition",
      "echo_out",
    ],
    avoidPresets: ["power_cut"],
    feel: "smooth",
    duckingAmount: 0.3,
    vocalHandling: "blend",
    dropIntensity: 0.5,
    cutSpeed: 0.3,
    useLoops: true,
    loopBeats: 8,
    primaryFx: [
      "delay_throw",
      "reverb_tail",
      "eq_fade",
      "stereo_widen",
      "percussion_bridge",
    ],
    bpmMatching: "relaxed",
    description:
      "Transitions chaudes avec percussion bridges. Delays et reverbs. Vocals blendées. Groove africain préservé. 8-beat loops.",
  },

  // --- HYPERPOP ---
  hyperpop: {
    label: "Hyperpop",
    transitionDuration: 5000,
    durationVariance: 1500,
    crossfadeDuration: 3500,
    tempoTransitionDuration: 2500,
    preferredPresets: [
      "power_cut",
      "drop_in",
      "quick_cut",
      "kick_sync_cut",
    ],
    avoidPresets: ["ambient_fade", "smooth_blend"],
    feel: "abrupt",
    duckingAmount: 0.0,
    vocalHandling: "cut",
    dropIntensity: 0.95,
    cutSpeed: 0.9,
    useLoops: true,
    loopBeats: 2,
    primaryFx: [
      "stutter_cut",
      "beat_repeat",
      "pitch_shift",
      "bitcrush",
      "reverse_swell",
      "distortion",
    ],
    bpmMatching: "creative",
    description:
      "Cuts chaotiques, stutter, pitch shifts, bitcrush. Maximum d'énergie digitale. Vocals glitchés et coupés. 2-beat loops.",
  },

  // --- LOFI ---
  lofi: {
    label: "Lo-Fi",
    transitionDuration: 14000,
    durationVariance: 4000,
    crossfadeDuration: 12000,
    tempoTransitionDuration: 8000,
    preferredPresets: [
      "ambient_fade",
      "smooth_blend",
      "echo_out",
      "filter_transition",
    ],
    avoidPresets: ["power_cut", "kick_sync_cut", "drop_in", "quick_cut"],
    feel: "ethereal",
    duckingAmount: 0.5,
    vocalHandling: "preserve",
    dropIntensity: 0.1,
    cutSpeed: 0.0,
    useLoops: false,
    loopBeats: 16,
    primaryFx: [
      "vinyl_brake",
      "tape_stop",
      "reverb_tail",
      "delay_throw",
      "eq_fade",
      "stereo_widen",
    ],
    bpmMatching: "relaxed",
    description:
      "Transitions très longues et atmosphériques. Vinyl brake, tape stop doux, reverbs. Vocals préservées. Aucun cut agressif. Ambiance chill.",
  },

  // --- POP ---
  pop: {
    label: "Pop",
    transitionDuration: 8000,
    durationVariance: 2000,
    crossfadeDuration: 6000,
    tempoTransitionDuration: 4000,
    preferredPresets: [
      "smooth_blend",
      "echo_out",
      "energy_boost",
      "filter_transition",
    ],
    avoidPresets: ["power_cut", "kick_sync_cut"],
    feel: "smooth",
    duckingAmount: 0.35,
    vocalHandling: "preserve",
    dropIntensity: 0.5,
    cutSpeed: 0.2,
    useLoops: false,
    loopBeats: 8,
    primaryFx: [
      "eq_fade",
      "reverb_tail",
      "delay_throw",
      "stereo_widen",
    ],
    bpmMatching: "relaxed",
    description:
      "Transitions propres et accessibles. EQ fades, reverbs. Vocals toujours préservées. Pas de cuts bruts. Pop-friendly.",
  },

  // --- UNKNOWN ---
  unknown: {
    label: "Unknown",
    transitionDuration: 8000,
    durationVariance: 2000,
    crossfadeDuration: 6000,
    tempoTransitionDuration: 4000,
    preferredPresets: ["smooth_blend", "echo_out", "filter_transition"],
    avoidPresets: [],
    feel: "smooth",
    duckingAmount: 0.3,
    vocalHandling: "blend",
    dropIntensity: 0.5,
    cutSpeed: 0.3,
    useLoops: false,
    loopBeats: 8,
    primaryFx: ["eq_fade", "reverb_tail"],
    bpmMatching: "relaxed",
    description: "Transitions par défaut — smooth et safe.",
  },
};

/**
 * Récupère le profil de mix pour un genre donné.
 */
export function getMixProfile(genre: Genre): GenreMixProfile {
  return GENRE_MIX_PROFILES[genre] ?? GENRE_MIX_PROFILES.unknown;
}

/**
 * Fusionne deux profils pour une transition cross-genre.
 * Privilégie le profil le plus conservateur (smooth > aggressive > abrupt).
 */
export function mergeProfiles(from: Genre, to: Genre): Partial<GenreMixProfile> {
  const pA = getMixProfile(from);
  const pB = getMixProfile(to);

  const feelPriority: Record<MixFeel, number> = {
    ethereal: 0,
    smooth: 1,
    punchy: 2,
    aggressive: 3,
    abrupt: 4,
  };

  // Choisir le feel le plus smooth/conservateur
  const dominantFeel =
    feelPriority[pA.feel] <= feelPriority[pB.feel] ? pA.feel : pB.feel;

  // Intersection des presets préférés
  const commonPresets = pA.preferredPresets.filter((p) =>
    pB.preferredPresets.includes(p)
  );

  return {
    transitionDuration: Math.max(pA.transitionDuration, pB.transitionDuration),
    crossfadeDuration: Math.max(pA.crossfadeDuration, pB.crossfadeDuration),
    feel: dominantFeel,
    duckingAmount: Math.max(pA.duckingAmount, pB.duckingAmount),
    vocalHandling:
      pA.vocalHandling === "preserve" || pB.vocalHandling === "preserve"
        ? "preserve"
        : pA.vocalHandling,
    dropIntensity: Math.max(pA.dropIntensity, pB.dropIntensity),
    cutSpeed: Math.min(pA.cutSpeed, pB.cutSpeed),
    preferredPresets: commonPresets.length > 0 ? commonPresets : pA.preferredPresets,
    useLoops: pA.useLoops || pB.useLoops,
    loopBeats: Math.max(pA.loopBeats, pB.loopBeats),
    primaryFx: Array.from(new Set([...pA.primaryFx, ...pB.primaryFx])),
    bpmMatching:
      pA.bpmMatching === "strict" || pB.bpmMatching === "strict"
        ? "strict"
        : "relaxed",
  };
}
