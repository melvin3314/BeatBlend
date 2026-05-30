/**
 * TransitionPresets
 * Bibliothèque de presets de transitions DJ riches et variés.
 *
 * Chaque preset définit :
 * - Courbes de volume pour les deux decks (table de mapping 0-1)
 * - Courbes de rate (optionnel)
 * - Paramètres de base (durée, overlap, feel)
 * - Score de compatibilité par défaut
 */

export type PresetName =
  | "smooth_blend"
  | "bass_swap"
  | "echo_out"
  | "filter_transition"
  | "energy_boost"
  | "ambient_fade"
  | "quick_cut"
  | "beat_jump"
  | "harmonic_blend"
  | "kick_sync_cut"
  | "vocal_dip"
  | "rise_up"
  | "tension_release"
  | "drop_in"
  | "power_cut";

export interface VolumeCurve {
  /** Points de la courbe: [progress 0-1, volume 0-1] */
  points: [number, number][];
}

export interface RateCurve {
  points: [number, number][]; // [progress, rate multiplier]
}

export interface TransitionPreset {
  name: PresetName;
  label: string;
  description: string;
  /** Durée totale de la transition en ms */
  baseDuration: number;
  /** Variation aléatoire autour de la durée (+/- ms) */
  durationVariance: number;
  /** Courbe de volume du deck A (outgoing) */
  deckA_volume: VolumeCurve;
  /** Courbe de volume du deck B (incoming) */
  deckB_volume: VolumeCurve;
  /** Courbe de rate du deck A (optionnel) */
  deckA_rate?: RateCurve;
  /** Courbe de rate du deck B (optionnel) */
  deckB_rate?: RateCurve;
  /** Délai avant de démarrer le deck B (ms) */
  deckB_startDelay: number;
  /** Feel général: smooth, punchy, aggressive, ethereal */
  feel: "smooth" | "punchy" | "aggressive" | "ethereal" | "abrupt";
  /** Priorité naturelle du preset (0-1, plus haut = plus préféré par défaut) */
  basePriority: number;
  /** Amount de ducking auto: deck A baisse quand B monte (0-1) */
  duckingAmount: number;
  /** Si true, coupe instantanément sur le beat le plus proche */
  kickSyncCut: boolean;
}

// --- Helper: lerp entre deux points ---
function sampleCurve(curve: VolumeCurve | RateCurve, t: number): number {
  const pts = curve.points;
  if (pts.length === 0) return 1;
  if (pts.length === 1) return pts[0][1];

  // Find the segment
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i];
    const [t1, v1] = pts[i + 1];
    if (t >= t0 && t <= t1) {
      const localT = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * localT;
    }
  }
  return pts[pts.length - 1][1];
}

export function sampleVolume(curve: VolumeCurve, t: number): number {
  return Math.max(0, Math.min(1, sampleCurve(curve, t)));
}

export function sampleRate(curve: RateCurve, t: number): number {
  return sampleCurve(curve, t);
}

// =========================== PRESETS ===========================

export const PRESETS: Record<PresetName, TransitionPreset> = {
  // --- 1. SMOOTH BLEND ---
  smooth_blend: {
    name: "smooth_blend",
    label: "Smooth Blend",
    description: "Crossfade progressif classique, doux et transparent",
    baseDuration: 9000,
    durationVariance: 2000,
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.3, 0.85],
        [0.6, 0.5],
        [0.85, 0.15],
        [1.0, 0.0],
      ],
    },
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.15, 0.08],
        [0.4, 0.35],
        [0.7, 0.75],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 0,
    feel: "smooth",
    basePriority: 0.5,
    duckingAmount: 0.15,
    kickSyncCut: false,
  },

  // --- 2. BASS SWAP ---
  bass_swap: {
    name: "bass_swap",
    label: "Bass Swap",
    description: "Cut progressif des basses: A descend d'abord, B monte après",
    baseDuration: 7000,
    durationVariance: 1500,
    // A: reste fort au début puis chute rapidement
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.25, 1.0],
        [0.45, 0.6],
        [0.6, 0.2],
        [0.75, 0.0],
        [1.0, 0.0],
      ],
    },
    // B: delay d'entrée puis montée rapide
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.3, 0.0],
        [0.45, 0.2],
        [0.6, 0.55],
        [0.8, 0.9],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 500,
    feel: "punchy",
    basePriority: 0.6,
    duckingAmount: 0.25,
    kickSyncCut: false,
  },

  // --- 3. ECHO OUT ---
  echo_out: {
    name: "echo_out",
    label: "Echo Out",
    description: "Echo/reverb sur la fin du morceau A, B entre progressivement",
    baseDuration: 10000,
    durationVariance: 2000,
    // A: chute lente puis reverb tail (simulé par volume très bas mais audible)
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.2, 0.9],
        [0.4, 0.6],
        [0.6, 0.25],
        [0.8, 0.08],
        [0.95, 0.02],
        [1.0, 0.0],
      ],
    },
    // B: entre progressivement après le début de l'echo
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.25, 0.0],
        [0.45, 0.15],
        [0.65, 0.45],
        [0.85, 0.8],
        [1.0, 1.0],
      ],
    },
    deckA_rate: {
      points: [
        [0.0, 1.0],
        [0.6, 1.0],
        [0.85, 0.92],
        [1.0, 0.85],
      ],
    },
    deckB_startDelay: 1500,
    feel: "ethereal",
    basePriority: 0.4,
    duckingAmount: 0.1,
    kickSyncCut: false,
  },

  // --- 4. FILTER TRANSITION ---
  filter_transition: {
    name: "filter_transition",
    label: "Filter",
    description: "Low-pass / high-pass progressif, effet montée/descente",
    baseDuration: 8000,
    durationVariance: 1500,
    // A: volume stable puis chute rapide (simule filtre qui ferme)
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.35, 1.0],
        [0.5, 0.7],
        [0.65, 0.3],
        [0.85, 0.05],
        [1.0, 0.0],
      ],
    },
    // B: delay puis montée (simule filtre qui s'ouvre)
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.3, 0.0],
        [0.45, 0.15],
        [0.6, 0.5],
        [0.8, 0.85],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 800,
    feel: "smooth",
    basePriority: 0.5,
    duckingAmount: 0.2,
    kickSyncCut: false,
  },

  // --- 5. ENERGY BOOST ---
  energy_boost: {
    name: "energy_boost",
    label: "Energy Boost",
    description: "Transition agressive avec montée d'énergie, adaptée aux drops",
    baseDuration: 4500,
    durationVariance: 1000,
    // A: chute rapide (laisse la place au drop)
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.15, 0.8],
        [0.35, 0.3],
        [0.55, 0.0],
        [1.0, 0.0],
      ],
    },
    // B: entrée explosive
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.2, 0.05],
        [0.35, 0.4],
        [0.5, 0.85],
        [0.7, 1.0],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 200,
    feel: "aggressive",
    basePriority: 0.7,
    duckingAmount: 0.3,
    kickSyncCut: false,
  },

  // --- 6. AMBIENT FADE ---
  ambient_fade: {
    name: "ambient_fade",
    label: "Ambient Fade",
    description: "Transition très lente et atmosphérique, idéale pour intros/outros calmes",
    baseDuration: 14000,
    durationVariance: 3000,
    // A: chute très progressive
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.2, 0.95],
        [0.4, 0.75],
        [0.6, 0.45],
        [0.8, 0.15],
        [1.0, 0.0],
      ],
    },
    // B: entrée très douce, presque imperceptible
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.15, 0.02],
        [0.35, 0.1],
        [0.55, 0.3],
        [0.75, 0.6],
        [1.0, 1.0],
      ],
    },
    deckA_rate: {
      points: [
        [0.0, 1.0],
        [0.5, 0.97],
        [0.8, 0.92],
        [1.0, 0.88],
      ],
    },
    deckB_startDelay: 0,
    feel: "ethereal",
    basePriority: 0.35,
    duckingAmount: 0.05,
    kickSyncCut: false,
  },

  // --- 7. QUICK CUT ---
  quick_cut: {
    name: "quick_cut",
    label: "Quick Cut",
    description: "Transition rapide sur beat, style radio mix / hip-hop",
    baseDuration: 1500,
    durationVariance: 400,
    // A: chute quasi instantanée
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.3, 0.5],
        [0.5, 0.0],
        [1.0, 0.0],
      ],
    },
    // B: montée quasi instantanée
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.2, 0.0],
        [0.4, 0.7],
        [0.55, 1.0],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 0,
    feel: "abrupt",
    basePriority: 0.45,
    duckingAmount: 0.0,
    kickSyncCut: true,
  },

  // --- 8. BEAT JUMP ---
  beat_jump: {
    name: "beat_jump",
    label: "Beat Jump",
    description: "Recalage automatique sur la mesure suivante, synchronisation propre",
    baseDuration: 6000,
    durationVariance: 1200,
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.3, 0.9],
        [0.5, 0.5],
        [0.7, 0.1],
        [1.0, 0.0],
      ],
    },
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.2, 0.0],
        [0.4, 0.3],
        [0.6, 0.7],
        [0.85, 1.0],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 0,
    feel: "punchy",
    basePriority: 0.55,
    duckingAmount: 0.2,
    kickSyncCut: false,
  },

  // --- 9. HARMONIC BLEND ---
  harmonic_blend: {
    name: "harmonic_blend",
    label: "Harmonic Blend",
    description: "Transition favorisant la compatibilité harmonique Camelot",
    baseDuration: 10000,
    durationVariance: 2000,
    // A: chute lente avec plateau médian (superposition harmonique longue)
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.25, 0.9],
        [0.5, 0.6],
        [0.65, 0.35],
        [0.85, 0.1],
        [1.0, 0.0],
      ],
    },
    // B: montée lente, les deux morceaux cohabitent longtemps
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.15, 0.1],
        [0.35, 0.3],
        [0.55, 0.55],
        [0.75, 0.8],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 0,
    feel: "smooth",
    basePriority: 0.65,
    duckingAmount: 0.1,
    kickSyncCut: false,
  },

  // --- 10. KICK SYNC CUT ---
  kick_sync_cut: {
    name: "kick_sync_cut",
    label: "Kick Sync Cut",
    description: "Cut brutal synchronisé exactement sur le prochain kick. Style club DJ.",
    baseDuration: 300,
    durationVariance: 80,
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.4, 1.0],
        [0.5, 0.0],
        [1.0, 0.0],
      ],
    },
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.5, 0.0],
        [0.55, 1.0],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 0,
    feel: "abrupt",
    basePriority: 0.5,
    duckingAmount: 0.0,
    kickSyncCut: true,
  },

  // --- 11. VOCAL DIP ---
  vocal_dip: {
    name: "vocal_dip",
    label: "Vocal Dip",
    description: "Baisse automatique du deck A quand B entre, pour éviter de masquer les vocals.",
    baseDuration: 7000,
    durationVariance: 1500,
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.2, 0.9],
        [0.4, 0.5],
        [0.6, 0.2],
        [0.8, 0.05],
        [1.0, 0.0],
      ],
    },
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.15, 0.0],
        [0.35, 0.3],
        [0.55, 0.6],
        [0.75, 0.85],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 300,
    feel: "smooth",
    basePriority: 0.55,
    duckingAmount: 0.35,
    kickSyncCut: false,
  },

  // --- 12. RISE UP ---
  rise_up: {
    name: "rise_up",
    label: "Rise Up",
    description: "Montée progressive d'énergie: B entre très doucement puis explose. Parfait pour les build-ups.",
    baseDuration: 8500,
    durationVariance: 1500,
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.25, 0.95],
        [0.5, 0.7],
        [0.7, 0.3],
        [0.85, 0.05],
        [1.0, 0.0],
      ],
    },
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.3, 0.05],
        [0.5, 0.15],
        [0.65, 0.5],
        [0.8, 0.9],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 0,
    feel: "punchy",
    basePriority: 0.6,
    duckingAmount: 0.2,
    kickSyncCut: false,
  },

  // --- 13. TENSION RELEASE ---
  tension_release: {
    name: "tension_release",
    label: "Tension Release",
    description: "Montée de tension puis relâchement brutal. Style techno/hardstyle.",
    baseDuration: 6000,
    durationVariance: 1200,
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.15, 1.0],
        [0.35, 0.8],
        [0.5, 0.4],
        [0.6, 0.0],
        [1.0, 0.0],
      ],
    },
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.3, 0.0],
        [0.5, 0.1],
        [0.6, 0.8],
        [0.75, 1.0],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 1000,
    feel: "aggressive",
    basePriority: 0.5,
    duckingAmount: 0.15,
    kickSyncCut: false,
  },

  // --- 14. DROP IN ---
  drop_in: {
    name: "drop_in",
    label: "Drop In",
    description: "Transition précise juste avant un drop du morceau B. Energy max.",
    baseDuration: 3500,
    durationVariance: 800,
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.1, 0.9],
        [0.25, 0.5],
        [0.4, 0.0],
        [1.0, 0.0],
      ],
    },
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.15, 0.1],
        [0.3, 0.4],
        [0.45, 0.9],
        [0.6, 1.0],
        [1.0, 1.0],
      ],
    },
    deckB_startDelay: 0,
    feel: "aggressive",
    basePriority: 0.75,
    duckingAmount: 0.3,
    kickSyncCut: true,
  },

  // --- 15. POWER CUT ---
  power_cut: {
    name: "power_cut",
    label: "Power Cut",
    description: "Cut instantané brutal sur le kick. Style hip-hop / battle DJ.",
    baseDuration: 150,
    durationVariance: 40,
    deckA_volume: {
      points: [
        [0.0, 1.0],
        [0.3, 0.0],
        [1.0, 0.0],
      ],
    },
    deckB_volume: {
      points: [
        [0.0, 0.0],
        [0.35, 1.0],
        [1.0, 1.0],
      ],
    },
    deckA_rate: {
      points: [
        [0.0, 1.0],
        [0.2, 0.6],
        [0.35, 0.25],
        [0.5, 0.1],
        [1.0, 0.1],
      ],
    },
    deckB_startDelay: 0,
    feel: "abrupt",
    basePriority: 0.4,
    duckingAmount: 0.0,
    kickSyncCut: true,
  },
};

/** Liste de tous les presets dans l'ordre de priorité décroissante */
export const PRESET_LIST = Object.values(PRESETS).sort(
  (a, b) => b.basePriority - a.basePriority
);

/**
 * Retourne la durée réelle d'un preset avec randomisation contrôlée.
 * La variance est appliquée de manière déterministe basée sur un seed
 * (ex: hash du nom de fichier) pour garantir la reproductibilité.
 */
export function getPresetDuration(preset: TransitionPreset, seed: number = Math.random()): number {
  const variance = (seed - 0.5) * 2 * preset.durationVariance; // +/- variance
  return Math.round(preset.baseDuration + variance);
}
