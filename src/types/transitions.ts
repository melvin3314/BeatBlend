export type TransitionStyle =
  | "crossfade" // Crossfade classique
  | "echo_out" // Echo sur le morceau sortant
  | "cut_drop" // Cut brutal sur le drop
  | "filter" // Filtre progressif (low-pass)
  | "reverb" // Reverb transition
  | "fade_instrumental" // Fade instrumental uniquement
  | "silence" // Transition sur silence
  | "double_drop" // Double drop synchronisé
  | "beat_jump" // Saut de beats
  | "backspin" // Backspin simulé
  | "pause_drop" // Pause dramatique avant drop
  | "accelerate" // Accélération progressive du BPM
  | "decelerate" // Ralentissement progressif
  | "loop_4" // Loop de 4 beats
  | "loop_8"; // Loop de 8 beats

export interface TransitionStyleConfig {
  style: TransitionStyle;
  duration: number; // Durée en ms
  energyMatch: number; // Score de correspondance d'énergie (0-1)
  harmonicMatch: number; // Score de correspondance harmonique (0-1)
  bpmProximity: number; // Score de proximité des BPM (0-1)
  confidence: number; // Score global de confiance (0-1)
}

export interface TransitionEffect {
  type: "volume" | "filter" | "echo" | "reverb" | "pitch" | "loop";
  target: "trackA" | "trackB" | "both";
  startTime: number; // Temps relatif au début de la transition (ms)
  duration: number; // Durée de l'effet (ms)
  parameters: Record<string, number>;
}

export interface TransitionPlan {
  style: TransitionStyle;
  effects: TransitionEffect[];
  trackAOutPoint: number;
  trackBInPoint: number;
  totalDuration: number;
  energyMatch: number;
  harmonicMatch: number;
  bpmProximity: number;
  confidence: number;
}

export interface PlaylistTrack {
  id: string;
  name: string;
  uri: string;
  bpm: number;
  duration: number;
  energy: number; // Énergie moyenne (0-1)
  key?: string; // Tonalité (ex: "C", "Cm")
  camelotWheel?: string; // Position sur Camelot wheel (ex: "1A", "8B")
  beats: number[];
  sections: EnergySection[];
  drops: DropPoint[];
  buildups: DropPoint[];
  genre?: string; // Genre détecté
  genreConfidence?: number;
}

export interface PlaylistTransition {
  fromTrackId: string;
  toTrackId: string;
  transitionPlan: TransitionPlan;
  estimatedTime: number; // Temps estimé de la transition (ms)
}

export interface Playlist {
  tracks: PlaylistTrack[];
  transitions: PlaylistTransition[];
  totalDuration: number;
  averageBpm: number;
  energyCurve: number[]; // Courbe d'énergie du set
}

export interface EnergySection {
  startTime: number;
  endTime: number;
  energyLevel: "low" | "medium" | "high" | "explosive";
  type: "intro" | "verse" | "chorus" | "bridge" | "outro" | "break" | "buildup" | "drop" | "breakdown" | "unknown";
}

export interface DropPoint {
  timestamp: number;
  energyBefore: number;
  energyAfter: number;
  type: "drop" | "buildup";
}

// ============================================================================
// BACKEND ANALYSIS TYPES (from Python server)
// ============================================================================

export interface BackendPhrase {
  start: number;
  end: number;
  confidence: number;
}

export interface BackendBuild {
  start: number;
  end: number;
  energyRise: number;
  confidence: number;
}

export interface BackendDrop {
  timestamp: number;
  intensity: number;
  confidence: number;
}

export interface BackendBreakdown {
  start: number;
  end: number;
  confidence: number;
}

export interface BackendVocalSection {
  start: number;
  end: number;
  confidence: number;
}

export interface EnergyCurvePoint {
  time: number;
  value: number;
  level: "low" | "medium" | "high" | "explosive";
  rms: number;
}

export interface BackendSection {
  start: number;
  end: number;
  type: string;
  energy: number;
  kickDensity: number;
}

export interface ConfidenceScores {
  bpm: number;
  structure: number;
  genre: number;
}

/**
 * Complete analysis result from the Python backend server.
 */
export interface BackendTrackAnalysis {
  success: boolean;
  bpm: number;
  key: string;
  camelot: string;
  genre: string;
  beats: number[];
  downbeats: number[];
  bars: number[];
  phrases: BackendPhrase[];
  drops: BackendDrop[];
  builds: BackendBuild[];
  breakdowns: BackendBreakdown[];
  energyCurve: EnergyCurvePoint[];
  vocalSections: BackendVocalSection[];
  sections: BackendSection[];
  recommendedTransitionPoints?: { time: number; score: number; reason: string }[];
  confidence: ConfidenceScores;
}

// ============================================================================
// SMART TRANSITION TYPES
// ============================================================================

export type DJTransitionType =
  | "smooth_blend"
  | "bass_swap"
  | "drop_switch"
  | "echo_transition"
  | "cinematic_transition"
  | "loop_transition"
  | "hard_cut_sync"
  | "atmospheric_bridge"
  | "build_transition";

export interface TransitionCandidate {
  outPoint: number; // seconds on track A
  inPoint: number;  // seconds on track B
  type: DJTransitionType;
  score: number;
  reason: string;
  phraseAligned: boolean;
  downbeatAligned: boolean;
  energyCoherent: boolean;
  keyCompatible: boolean;
  vocalClashRisk: boolean;
  dropPreparation: boolean;
}

export interface BassSwapPlan {
  active: boolean;
  startTime: number;
  endTime: number;
  deckA_bassCutoff: number; // Hz, low-pass filter cutoff for A
  deckB_bassIntro: number; // Hz, low-pass filter cutoff for B
  preserveVocalA: boolean;
}

export interface VocalBlendPlan {
  active: boolean;
  deckA_vocalFade: number; // 0-1
  deckB_vocalFade: number; // 0-1
  overlapAllowed: boolean;
  reason: string;
}

export interface DropPreparation {
  dropIncoming: boolean;
  dropTimestamp: number;
  buildStart: number;
  fxSequence: string[];
  tensionLevel: number; // 0-1
}

export interface SmartMixState {
  beatSyncLocked: boolean;
  phraseMatch: boolean;
  transitionReady: boolean;
  dropIncoming: boolean;
  smartMixActive: boolean;
  bassSwapActive: boolean;
  vocalBlendActive: boolean;
  currentTransition?: TransitionCandidate;
  nextDrop?: DropPreparation;
  humanReason?: string;      // pourquoi le DJ attend ou transitionne
  intentScore?: number;      // score d'intention (0-1)
  shouldTransition?: boolean; // le moteur a-t-il approuvé ?
  recommendedAction?: "wait" | "loop" | "extend" | "build_tension" | "transition_now";
}

export interface SmartMixPlan {
  candidate: TransitionCandidate;
  bassSwap: BassSwapPlan;
  vocalBlend: VocalBlendPlan;
  dropPrep: DropPreparation;
  fxPreset: string;
  estimatedDuration: number;
  intentScore?: number;       // score d'intention musical
  humanReason?: string;        // explication lisible
  shouldTransition?: boolean; // approuvé par le DJ ?
  alternativeAction?: "wait" | "loop" | "extend" | "build_tension" | "transition_now";
  waitDuration?: number;       // si wait/loop/extend
}
