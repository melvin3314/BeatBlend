/**
 * SmartMixEngine
 * ==============
 * Cerveau central du système de transitions DJ intelligent.
 *
 * Utilise les données du backend Python (BPM, beatgrid, downbeats,
 * phrases, sections, drops, builds, énergie, tonalité, genre, vocals)
 * pour décider QUAND et COMMENT faire les transitions.
 *
 * RÈGLE D'OR : jamais de timer simple. Tout est musical.
 */

import type {
    BackendTrackAnalysis,
    BassSwapPlan,
    DJTransitionType,
    DropPreparation,
    SmartMixPlan,
    SmartMixState,
    TransitionCandidate,
    VocalBlendPlan,
} from "../types/transitions";

import type { Genre } from "../services/analysis/genreDetectionService";
import { calculateCamelotCompatibility } from "../services/analysis/keyDetectionService";
import { getMixProfile, mergeProfiles } from "../services/mix/genreMixProfiles";
import {
    transitionIntentEngine,
    type IntentContext,
} from "../services/mix/TransitionIntentEngine";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MIN_TRANSITION_TIME: 30,         // jamais avant 30s
  MIN_BEFORE_END: 20,              // jamais dans les 20 dernières secondes
  MAX_TRANSITION_WINDOW_START: 0.55,  // fenêtre de recherche début
  MAX_TRANSITION_WINDOW_END: 0.92,    // fenêtre de recherche fin
  PHRASE_ALIGN_BONUS: 0.25,
  DOWNBEAT_ALIGN_BONUS: 0.20,
  DROP_PREP_BONUS: 0.30,
  ENERGY_COHERENCE_BONUS: 0.15,
  KEY_COMPAT_BONUS: 0.15,
  VOCAL_CLASH_PENALTY: 0.40,
  MIN_CANDIDATE_SCORE: 0.35,
  BUILDUP_LOOKAHEAD: 8,            // secondes avant un drop pour préparer
  BASS_SWAP_DURATION: 4,           // secondes
  DEFAULT_ENTRY_OFFSET: 0,       // offset depuis le in-point (0 = exact)
};

// ============================================================================
// CAMEL WHEEL COMPATIBILITY (pour tonalité)
// ============================================================================

function keyCompatibility(camelotA: string, camelotB: string): number {
  if (!camelotA || !camelotB) return 0.5;
  return calculateCamelotCompatibility(camelotA, camelotB);
}

// ============================================================================
// SCORING ENGINE
// ============================================================================

interface ScoredPoint {
  time: number;
  score: number;
  reasons: string[];
}

/**
 * Évalue tous les points de transition possibles sur un morceau.
 * Retourne une liste de points triés par score décroissant.
 */
function scoreOutPoints(
  analysis: BackendTrackAnalysis,
  currentTime: number
): ScoredPoint[] {
  const dur = analysis.beats.length > 0
    ? analysis.beats[analysis.beats.length - 1] + 60 / analysis.bpm
    : 180;

  const candidates: ScoredPoint[] = [];

  // 1) Points de fin de phrase
  for (const phrase of analysis.phrases) {
    if (phrase.end < currentTime + 5) continue; // trop tôt
    if (phrase.end > dur - CONFIG.MIN_BEFORE_END) continue;

    let score = 0.5;
    const reasons: string[] = [];

    // Bonus si c'est la fin d'une phrase
    score += 0.15;
    reasons.push("fin de phrase");

    // Bonus si downbeat aligné
    const nearestDownbeat = findNearestDownbeat(analysis.downbeats, phrase.end);
    if (nearestDownbeat && Math.abs(nearestDownbeat - phrase.end) < 0.15) {
      score += CONFIG.DOWNBEAT_ALIGN_BONUS;
      reasons.push("aligné sur downbeat");
    }

    candidates.push({ time: phrase.end, score: Math.min(1, score), reasons });
  }

  // 2) Points avant un drop (transition OUT avant que le drop arrive)
  for (const drop of analysis.drops) {
    const outTime = drop.timestamp - 0.5; // juste avant le drop
    if (outTime < currentTime + 5) continue;
    if (outTime > dur - CONFIG.MIN_BEFORE_END) continue;

    let score = 0.55;
    const reasons = ["sortie avant drop"];

    // Meilleur si on est dans un build
    const inBuild = analysis.builds.some(
      b => outTime >= b.start && outTime <= b.end
    );
    if (inBuild) {
      score += 0.15;
      reasons.push("en plein buildup");
    }

    candidates.push({ time: outTime, score: Math.min(1, score), reasons });
  }

  // 3) Points de fin de section (outro, breakdown)
  for (const section of analysis.sections) {
    if (section.type === "outro" || section.type === "breakdown") {
      const t = section.end;
      if (t < currentTime + 5) continue;
      if (t > dur - CONFIG.MIN_BEFORE_END) continue;

      let score = 0.45;
      const reasons = [`fin de ${section.type}`];

      if (section.type === "outro") {
        score += 0.10;
        reasons.push("outro naturelle");
      }

      candidates.push({ time: t, score: Math.min(1, score), reasons });
    }
  }

  // 4) Downbeats dans la fenêtre de transition
  const windowStart = Math.max(currentTime + 5, dur * CONFIG.MAX_TRANSITION_WINDOW_START);
  const windowEnd = Math.min(dur - CONFIG.MIN_BEFORE_END, dur * CONFIG.MAX_TRANSITION_WINDOW_END);

  for (const db of analysis.downbeats) {
    if (db < windowStart || db > windowEnd) continue;

    // Éviter les doublons proches
    const tooClose = candidates.some(c => Math.abs(c.time - db) < 0.5);
    if (tooClose) continue;

    let score = 0.35;
    const reasons = ["downbeat dans fenêtre"];

    // Bonus si énergie en baisse (évite de couper un moment fort)
    const energyAt = getEnergyAt(analysis.energyCurve, db);
    if (energyAt && energyAt.level === "low") {
      score += 0.10;
      reasons.push("énergie basse");
    }

    candidates.push({ time: db, score: Math.min(1, score), reasons });
  }

  // Dédoublonner et trier
  const deduped = deduplicateCandidates(candidates, 1.0);
  deduped.sort((a, b) => b.score - a.score);
  return deduped;
}

/**
 * Évalue tous les points d'entrée possibles sur le morceau suivant.
 */
function scoreInPoints(
  analysis: BackendTrackAnalysis
): ScoredPoint[] {
  const dur = analysis.beats.length > 0
    ? analysis.beats[analysis.beats.length - 1] + 60 / analysis.bpm
    : 180;

  const candidates: ScoredPoint[] = [];

  // 1) Entrée sur un drop (meilleur choix)
  for (const drop of analysis.drops) {
    const t = drop.timestamp;
    if (t < CONFIG.MIN_TRANSITION_TIME) continue;
    if (t > dur * 0.75) continue; // éviter fin

    let score = 0.90;
    const reasons = ["entrée sur drop"];

    if (drop.intensity > 0.7) {
      score += 0.05;
      reasons.push("drop intense");
    }

    candidates.push({ time: t, score: Math.min(1, score), reasons });
  }

  // 2) Entrée au début d'un build
  for (const build of analysis.builds) {
    const t = build.start;
    if (t < CONFIG.MIN_TRANSITION_TIME) continue;
    if (t > dur * 0.70) continue;

    let score = 0.75;
    const reasons = ["entrée sur buildup"];

    if (build.energyRise > 0.3) {
      score += 0.10;
      reasons.push("montée énergique");
    }

    candidates.push({ time: t, score: Math.min(1, score), reasons });
  }

  // 3) Entrée sur downbeat après une section haute énergie
  for (const section of analysis.sections) {
    if (section.type === "drop" || section.type === "chorus") {
      const t = section.start;
      if (t < CONFIG.MIN_TRANSITION_TIME) continue;
      if (t > dur * 0.70) continue;

      let score = 0.65;
      const reasons = [`entrée sur ${section.type}`];

      candidates.push({ time: t, score: Math.min(1, score), reasons });
    }
  }

  // 4) Entrée sur downbeat dans les 30-50 premières secondes
  for (const db of analysis.downbeats) {
    if (db < CONFIG.MIN_TRANSITION_TIME) continue;
    if (db > dur * 0.50) continue;

    const tooClose = candidates.some(c => Math.abs(c.time - db) < 0.5);
    if (tooClose) continue;

    candidates.push({ time: db, score: 0.50, reasons: ["downbeat stable"] });
  }

  // Fallback : premier downbeat après 30s
  if (candidates.length === 0 && analysis.downbeats.length > 0) {
    const firstValid = analysis.downbeats.find(d => d >= CONFIG.MIN_TRANSITION_TIME);
    if (firstValid) {
      candidates.push({ time: firstValid, score: 0.40, reasons: ["downbeat fallback"] });
    }
  }

  const deduped = deduplicateCandidates(candidates, 1.0);
  deduped.sort((a, b) => b.score - a.score);
  return deduped;
}

// ============================================================================
// VOCAL CLASH DETECTION
// ============================================================================

/**
 * Détecte si une transition entre outPoint et inPoint crée un clash vocal.
 */
function detectVocalClash(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number,
  transitionDuration: number
): { clash: boolean; severity: number; reason: string } {
  const overlapStart = outPoint;
  const overlapEnd = outPoint + transitionDuration;
  const bStart = inPoint;
  const bEnd = inPoint + transitionDuration;

  let clash = false;
  let severity = 0;
  const reasons: string[] = [];

  // Vérifier les vocals de A pendant la transition
  const vocalsA = analysisA.vocalSections.filter(
    v => v.start < overlapEnd && v.end > overlapStart
  );

  // Vérifier les vocals de B pendant la transition
  const vocalsB = analysisB.vocalSections.filter(
    v => v.start < bEnd && v.end > bStart
  );

  // Si les deux ont des vocals en même temps → clash
  if (vocalsA.length > 0 && vocalsB.length > 0) {
    clash = true;
    severity = 0.8;
    reasons.push("vocals A et B en simultané");
  } else if (vocalsA.length > 0) {
    // A a des vocals, B est instrumental → OK avec fade
    severity = 0.2;
    reasons.push("vocals A présents");
  } else if (vocalsB.length > 0) {
    // B a des vocals, A est instrumental → OK avec fade
    severity = 0.2;
    reasons.push("vocals B présents");
  }

  return {
    clash,
    severity,
    reason: reasons.join(", ") || "pas de vocals détectés",
  };
}

// ============================================================================
// ENERGY COHERENCE
// ============================================================================

function evaluateEnergyCoherence(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number
): { coherent: boolean; score: number; direction: "up" | "down" | "flat" } {
  const energyA = getEnergyAt(analysisA.energyCurve, outPoint);
  const energyB = getEnergyAt(analysisB.energyCurve, inPoint);

  if (!energyA || !energyB) return { coherent: true, score: 0.5, direction: "flat" };

  const valA = energyA.value;
  const valB = energyB.value;
  const diff = valB - valA;

  // Détecter la direction
  let direction: "up" | "down" | "flat" = "flat";
  if (diff > 0.15) direction = "up";
  else if (diff < -0.15) direction = "down";

  // Score de cohérence : préférer les transitions douces
  const score = 1 - Math.min(1, Math.abs(diff) / 0.5);

  return { coherent: score > 0.5, score, direction };
}

// ============================================================================
// DROP PREPARATION
// ============================================================================

function prepareDrop(
  analysis: BackendTrackAnalysis,
  currentTime: number
): DropPreparation {
  const nextDrop = analysis.drops.find(d => d.timestamp > currentTime + 2);
  const nextBuild = analysis.builds.find(b => b.start > currentTime + 1);

  if (!nextDrop && !nextBuild) {
    return {
      dropIncoming: false,
      dropTimestamp: 0,
      buildStart: 0,
      fxSequence: [],
      tensionLevel: 0,
    };
  }

  const dropTime = nextDrop?.timestamp ?? Infinity;
  const buildTime = nextBuild?.start ?? Infinity;

  // Utiliser le build si plus proche et avant le drop
  const isBuildPrep = buildTime < dropTime && buildTime < currentTime + CONFIG.BUILDUP_LOOKAHEAD;
  const targetTime = isBuildPrep ? buildTime : dropTime;
  const timeUntil = targetTime - currentTime;

  if (timeUntil > CONFIG.BUILDUP_LOOKAHEAD + 3) {
    return {
      dropIncoming: false,
      dropTimestamp: 0,
      buildStart: 0,
      fxSequence: [],
      tensionLevel: 0,
    };
  }

  const tensionLevel = Math.min(1, 1 - timeUntil / CONFIG.BUILDUP_LOOKAHEAD);

  const fxSequence: string[] = [];
  if (tensionLevel > 0.3) fxSequence.push("filter_open");
  if (tensionLevel > 0.5) fxSequence.push("rise_volume");
  if (tensionLevel > 0.7) fxSequence.push("white_noise");
  if (tensionLevel > 0.85) fxSequence.push("impact_hit");

  return {
    dropIncoming: true,
    dropTimestamp: nextDrop?.timestamp ?? 0,
    buildStart: nextBuild?.start ?? 0,
    fxSequence,
    tensionLevel,
  };
}

// ============================================================================
// BASS SWAP PLANNING
// ============================================================================

function planBassSwap(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number,
  genreA: Genre,
  genreB: Genre
): BassSwapPlan {
  const profileA = getMixProfile(genreA);
  const profileB = getMixProfile(genreB);

  // Bass swap principalement pour rap/trap/phonk/drill/techno/house
  const bassSwapGenres: Genre[] = ["trap", "rap", "phonk", "drill", "techno", "house", "hard_techno", "edm"];
  const shouldSwap = bassSwapGenres.includes(genreA) || bassSwapGenres.includes(genreB);

  if (!shouldSwap) {
    return {
      active: false,
      startTime: 0,
      endTime: 0,
      deckA_bassCutoff: 0,
      deckB_bassIntro: 0,
      preserveVocalA: false,
    };
  }

  // Détecter si A a des vocals à préserver
  const vocalOverlap = analysisA.vocalSections.some(
    v => v.start < outPoint + CONFIG.BASS_SWAP_DURATION && v.end > outPoint
  );

  // Timing : démarrer le bass swap 1-2 beats avant le point de transition
  const beatDuration = 60 / analysisA.bpm;
  const swapStart = outPoint - beatDuration;
  const swapEnd = outPoint + CONFIG.BASS_SWAP_DURATION;

  return {
    active: true,
    startTime: Math.max(0, swapStart),
    endTime: swapEnd,
    deckA_bassCutoff: 250,   // Low-pass : garde les basses de A, coupe progressivement
    deckB_bassIntro: 250,    // Low-pass : intro douce des basses de B
    preserveVocalA: vocalOverlap,
  };
}

// ============================================================================
// VOCAL BLEND PLANNING
// ============================================================================

function planVocalBlend(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number,
  transitionDuration: number
): VocalBlendPlan {
  const clash = detectVocalClash(analysisA, analysisB, outPoint, inPoint, transitionDuration);

  if (!clash.clash) {
    // Pas de clash → blend doux possible
    return {
      active: false,
      deckA_vocalFade: 1.0,
      deckB_vocalFade: 0.0,
      overlapAllowed: true,
      reason: clash.reason,
    };
  }

  // Clash détecté → planifier un fade vocal intelligent
  const vocalsA = analysisA.vocalSections.some(
    v => v.start < outPoint + transitionDuration && v.end > outPoint
  );
  const vocalsB = analysisB.vocalSections.some(
    v => v.start < inPoint + transitionDuration && v.end > inPoint
  );

  if (vocalsA && vocalsB) {
    // Les deux ont des vocals : fade A avant d'introduire B
    return {
      active: true,
      deckA_vocalFade: 0.0,   // coupe A rapidement
      deckB_vocalFade: 1.0,   // B entre en douceur
      overlapAllowed: false,
      reason: "évite clash vocal A↔B",
    };
  }

  if (vocalsA) {
    return {
      active: true,
      deckA_vocalFade: 0.7,   // baisse un peu A
      deckB_vocalFade: 1.0,
      overlapAllowed: true,
      reason: "préservation vocal A",
    };
  }

  return {
    active: true,
    deckA_vocalFade: 0.3,
    deckB_vocalFade: 0.7,
    overlapAllowed: true,
    reason: "préservation vocal B",
  };
}

// ============================================================================
// TRANSITION TYPE SELECTION
// ============================================================================

function selectTransitionType(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number,
  genreA: Genre,
  genreB: Genre,
  energyDirection: "up" | "down" | "flat"
): DJTransitionType {
  const sectionA = analysisA.sections.find(s => outPoint >= s.start && outPoint <= s.end);
  const sectionB = analysisB.sections.find(s => inPoint >= s.start && inPoint <= s.end);

  const isDropEntry = analysisB.drops.some(d => Math.abs(d.timestamp - inPoint) < 1.0);
  const isBuildEntry = analysisB.builds.some(b => Math.abs(b.start - inPoint) < 1.0);
  const isBuildExit = sectionA?.type === "build";
  const isOutroExit = sectionA?.type === "outro";
  const isBreakdownExit = sectionA?.type === "breakdown";

  const bpmDiff = Math.abs(analysisA.bpm - analysisB.bpm);
  const bpmRatio = Math.max(analysisA.bpm, analysisB.bpm) / (Math.min(analysisA.bpm, analysisB.bpm) + 0.01);
  const largeBpmGap = bpmDiff > 15 || bpmRatio > 1.25;

  const hasVocalsA = analysisA.vocalSections.some(
    v => v.start < outPoint + 4 && v.end > outPoint - 2
  );

  // Drop switch : entrée sur un drop depuis un build ou outro
  if (isDropEntry && (isBuildEntry || isOutroExit || energyDirection === "up")) {
    return "drop_switch";
  }

  // Build transition : entrée sur un build
  if (isBuildEntry) {
    return "build_transition";
  }

  // Hard cut: large BPM gaps or aggressive genres with energy jump
  if (largeBpmGap) {
    return "hard_cut_sync";
  }

  const aggressiveGenres: Genre[] = ["rage", "hyperpop", "hard_techno"];
  if (aggressiveGenres.includes(genreA) || aggressiveGenres.includes(genreB)) {
    if (energyDirection === "up" || isDropEntry) return "hard_cut_sync";
  }

  // Echo transition: vocals on A need space to decay
  if (hasVocalsA && (isOutroExit || isBreakdownExit || energyDirection === "down")) {
    return "echo_transition";
  }

  // Bass swap: bass-heavy genres with compatible BPM
  const bassSwapGenres: Genre[] = ["trap", "phonk", "drill", "techno", "house", "hard_techno", "edm"];
  if (bassSwapGenres.includes(genreA) || bassSwapGenres.includes(genreB)) {
    if (!isOutroExit && !isDropEntry && !largeBpmGap) {
      return "bass_swap";
    }
  }

  // Loop transition: outro with loop-friendly genre profile
  const profileA = getMixProfile(genreA);
  if (profileA.useLoops && (isOutroExit || isBuildExit)) {
    return "loop_transition";
  }

  // Cinematic: soft genres, both tracks gentle
  const softGenres: Genre[] = ["lofi", "reggae", "afro"];
  if (softGenres.includes(genreA) && softGenres.includes(genreB)) {
    return "cinematic_transition";
  }

  // Atmospheric bridge: energy drops significantly
  if (energyDirection === "down") {
    return "atmospheric_bridge";
  }

  // Smooth blend: default for compatible tracks
  return "smooth_blend";
}

// ============================================================================
// CANDIDATE GENERATION
// ============================================================================

/**
 * Génère les meilleures combinaisons outPoint/inPoint et les score.
 */
function generateCandidates(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  currentTime: number,
  genreA: Genre,
  genreB: Genre,
  antiRepeatPenalty: (type: DJTransitionType) => number,
  diversityBonus: (type: DJTransitionType) => number
): TransitionCandidate[] {
  const outs = scoreOutPoints(analysisA, currentTime);
  const ins = scoreInPoints(analysisB);

  const candidates: TransitionCandidate[] = [];

  for (const out of outs.slice(0, 8)) { // top 8 out points
    for (const inp of ins.slice(0, 5)) { // top 5 in points
      const keyScore = keyCompatibility(analysisA.camelot, analysisB.camelot);
      const energy = evaluateEnergyCoherence(analysisA, analysisB, out.time, inp.time);
      const vocal = detectVocalClash(analysisA, analysisB, out.time, inp.time, 4);
      const nearestDownbeatA = findNearestDownbeat(analysisA.downbeats, out.time);
      const nearestDownbeatB = findNearestDownbeat(analysisB.downbeats, inp.time);

      const isPhraseAligned = analysisA.phrases.some(
        p => Math.abs(p.end - out.time) < 0.3
      ) && analysisB.phrases.some(
        p => Math.abs(p.start - inp.time) < 0.3
      );

      const isDownbeatAligned =
        (nearestDownbeatA !== null && Math.abs(nearestDownbeatA - out.time) < 0.15) ||
        (nearestDownbeatB !== null && Math.abs(nearestDownbeatB - inp.time) < 0.15);

      const dropPrep = analysisB.drops.some(
        d => Math.abs(d.timestamp - inp.time) < 2
      );

      const type = selectTransitionType(
        analysisA, analysisB, out.time, inp.time, genreA, genreB, energy.direction
      );

      // Score composite
      let score = out.score * 0.35 + inp.score * 0.30;
      if (isPhraseAligned) score += CONFIG.PHRASE_ALIGN_BONUS;
      if (isDownbeatAligned) score += CONFIG.DOWNBEAT_ALIGN_BONUS;
      if (dropPrep) score += CONFIG.DROP_PREP_BONUS;
      score += energy.score * CONFIG.ENERGY_COHERENCE_BONUS;
      score += keyScore * CONFIG.KEY_COMPAT_BONUS;
      if (vocal.clash) score -= CONFIG.VOCAL_CLASH_PENALTY * vocal.severity;

      // Anti-repetition & diversity
      score += antiRepeatPenalty(type);
      score += diversityBonus(type);

      score = Math.max(0, Math.min(1, score));

      if (score >= CONFIG.MIN_CANDIDATE_SCORE) {
        candidates.push({
          outPoint: out.time,
          inPoint: inp.time,
          type,
          score,
          reason: `${out.reasons.join(", ")} → ${inp.reasons.join(", ")}`,
          phraseAligned: isPhraseAligned,
          downbeatAligned: isDownbeatAligned,
          energyCoherent: energy.coherent,
          keyCompatible: keyScore > 0.6,
          vocalClashRisk: vocal.clash,
          dropPreparation: dropPrep,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ============================================================================
// FX PRESET SELECTION
// ============================================================================

function selectFxPreset(
  type: DJTransitionType,
  genreA: Genre,
  genreB: Genre
): string {
  const merged = mergeProfiles(genreA, genreB);
  const available = merged.primaryFx || [];

  switch (type) {
    case "bass_swap":
      return available.includes("bass_swap") ? "bass_swap" : "eq_fade";
    case "drop_switch":
      return available.includes("impact_hit") ? "impact_hit" : "white_noise";
    case "echo_transition":
      return available.includes("echo_out") ? "echo_out" : "reverb_tail";
    case "hard_cut_sync":
      return available.includes("beat_repeat") ? "beat_repeat" : "transient_duck";
    case "build_transition":
      return available.includes("riser") ? "riser" : "filter_open";
    case "cinematic_transition":
      return available.includes("reverb_tail") ? "reverb_tail" : "delay_throw";
    case "loop_transition":
      return available.includes("loop_roll") ? "loop_roll" : "beat_repeat";
    case "atmospheric_bridge":
      return available.includes("stereo_widen") ? "stereo_widen" : "reverb_tail";
    case "smooth_blend":
    default:
      return available.includes("eq_fade") ? "eq_fade" : "filter_transition";
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function findNearestDownbeat(downbeats: number[], time: number): number | null {
  if (downbeats.length === 0) return null;
  let closest = downbeats[0];
  let minDist = Math.abs(downbeats[0] - time);
  for (const db of downbeats) {
    const dist = Math.abs(db - time);
    if (dist < minDist) {
      minDist = dist;
      closest = db;
    }
  }
  return closest;
}

function getEnergyAt(curve: { time: number; value: number; level: string }[], time: number) {
  if (curve.length === 0) return null;
  let closest = curve[0];
  let minDist = Math.abs(curve[0].time - time);
  for (const pt of curve) {
    const dist = Math.abs(pt.time - time);
    if (dist < minDist) {
      minDist = dist;
      closest = pt;
    }
  }
  return closest;
}

function deduplicateCandidates(candidates: ScoredPoint[], minGapSec: number): ScoredPoint[] {
  const sorted = [...candidates].sort((a, b) => a.time - b.time);
  const result: ScoredPoint[] = [];
  for (const c of sorted) {
    const tooClose = result.some(r => Math.abs(r.time - c.time) < minGapSec);
    if (!tooClose) result.push(c);
  }
  return result;
}

// ============================================================================
// SMART MIX ENGINE (Singleton API)
// ============================================================================

export interface MixEngineContext {
  analysisA: BackendTrackAnalysis;
  analysisB: BackendTrackAnalysis;
  currentTime: number;
  genreA: Genre;
  genreB: Genre;
}

export class SmartMixEngine {
  private currentPlan: SmartMixPlan | null = null;
  private currentState: SmartMixState = {
    beatSyncLocked: false,
    phraseMatch: false,
    transitionReady: false,
    dropIncoming: false,
    smartMixActive: false,
    bassSwapActive: false,
    vocalBlendActive: false,
  };
  private listeners: Set<(state: SmartMixState) => void> = new Set();

  // Anti-repetition: ring buffer of recent transitions (last 5)
  private recentTransitions: { type: DJTransitionType; outPoint: number; inPoint: number }[] = [];
  private readonly MAX_HISTORY = 5;

  /**
   * Record a completed transition in the history buffer.
   */
  recordTransition(type: DJTransitionType, outPoint: number, inPoint: number): void {
    this.recentTransitions.push({ type, outPoint, inPoint });
    if (this.recentTransitions.length > this.MAX_HISTORY) {
      this.recentTransitions.shift();
    }
  }

  /**
   * Compute anti-repetition penalty for a candidate.
   * Returns 0 = no penalty, negative = penalty applied.
   */
  private antiRepeatPenalty(type: DJTransitionType): number {
    if (this.recentTransitions.length === 0) return 0;

    // Count how many of the last N were the same type
    const sameTypeCount = this.recentTransitions.filter(t => t.type === type).length;

    if (sameTypeCount === 0) return 0;
    // Progressive penalty: 1 repeat = -0.05, 2 = -0.12, 3+ = -0.20
    if (sameTypeCount >= 3) return -0.20;
    if (sameTypeCount === 2) return -0.12;
    return -0.05;
  }

  /**
   * Diversity bonus: reward types NOT recently used.
   */
  private diversityBonus(type: DJTransitionType): number {
    const recentTypes = new Set(this.recentTransitions.map(t => t.type));
    if (!recentTypes.has(type)) return 0.08;
    return 0;
  }

  /**
   * Analyse la situation et génère le meilleur plan de transition.
   * C'est la fonction principale du moteur.
   * NOUVEAU : utilise le TransitionIntentEngine pour évaluer si
   * la transition est MUSICAlEMENT une bonne idée.
   */
  computePlan(ctx: MixEngineContext): SmartMixPlan | null {
    const { analysisA, analysisB, currentTime, genreA, genreB } = ctx;

    if (!analysisA.success || !analysisB.success) return null;

    // 1) Générer tous les candidats (technique)
    const candidates = generateCandidates(
      analysisA, analysisB, currentTime, genreA, genreB,
      this.antiRepeatPenalty.bind(this),
      this.diversityBonus.bind(this)
    );
    if (candidates.length === 0) return null;

    // 2) ÉVALUATION INTENTIONNELLE : est-ce une bonne idée musicale ?
    const intentCtx: IntentContext = {
      analysisA,
      analysisB,
      currentTime,
      genreA,
      genreB,
      previousTransitions: 0,
      overallEnergy: 0.5,
    };

    // Use the best candidate and evaluate its musical intent
    const best = candidates[0];
    const intent = transitionIntentEngine.evaluateTransition(intentCtx, best);

    // If the engine says WAIT, we still build a plan but mark it as "not approved"
    const duration = getMixProfile(genreA).transitionDuration / 1000;

    // 3) Planifier le bass swap (seulement si approuvé)
    const bassSwap = intent.shouldTransition
      ? planBassSwap(analysisA, analysisB, best.outPoint, best.inPoint, genreA, genreB)
      : { active: false, startTime: 0, endTime: 0, deckA_bassCutoff: 0, deckB_bassIntro: 0, preserveVocalA: false };

    // 4) Planifier le vocal blend
    const vocalBlend = planVocalBlend(analysisA, analysisB, best.outPoint, best.inPoint, duration);

    // 5) Préparer le drop
    const dropPrep = prepareDrop(analysisB, best.inPoint);

    // 6) Choisir les FX
    const fxPreset = selectFxPreset(best.type, genreA, genreB);

    // 7) Construire le plan avec l'intention
    const plan: SmartMixPlan = {
      candidate: best,
      bassSwap,
      vocalBlend,
      dropPrep,
      fxPreset,
      estimatedDuration: duration,
      intentScore: intent.score.total,
      humanReason: intent.reason,
      shouldTransition: intent.shouldTransition,
      alternativeAction: intent.shouldTransition ? undefined : intent.alternativeAction,
      waitDuration: intent.shouldTransition ? undefined : intent.waitDuration,
    };

    this.currentPlan = plan;

    console.log(
      `[SmartMix] ${intent.shouldTransition ? "✅ APPROVED" : "⏳ WAIT"} | ` +
      `score=${(intent.score.total * 100).toFixed(0)}% | ` +
      `${intent.reason}`
    );

    return plan;
  }

  /**
   * Met à jour l'état visuel en temps réel.
   * Appelé régulièrement depuis le hook useAutoDJ.
   */
  updateState(ctx: MixEngineContext, currentTime: number): SmartMixState {
    const { analysisA, analysisB } = ctx;
    const plan = this.currentPlan;

    const bpmDiff = Math.abs(analysisA.bpm - analysisB.bpm);
    const beatSyncLocked = bpmDiff < 3 || (bpmDiff < 6 && analysisA.bpm > 0);

    const phraseMatch = plan?.candidate.phraseAligned ?? false;
    const transitionReady = plan !== null && currentTime >= (plan.candidate.outPoint - 8);

    const dropPrep = prepareDrop(analysisA, currentTime);
    const dropIncoming = dropPrep.dropIncoming;

    const bassSwapActive = plan?.bassSwap.active ?? false;
    const vocalBlendActive = plan?.vocalBlend.active ?? false;
    const smartMixActive = plan !== null;

    const newState: SmartMixState = {
      beatSyncLocked,
      phraseMatch,
      transitionReady,
      dropIncoming,
      smartMixActive,
      bassSwapActive,
      vocalBlendActive,
      currentTransition: plan?.candidate,
      nextDrop: dropIncoming ? dropPrep : undefined,
      humanReason: plan?.humanReason,
      intentScore: plan?.intentScore,
      shouldTransition: plan?.shouldTransition,
      recommendedAction: plan?.shouldTransition ? "transition_now" : plan?.alternativeAction,
    };

    this.currentState = newState;
    this.notifyListeners();
    return newState;
  }

  getState(): SmartMixState {
    return { ...this.currentState };
  }

  getPlan(): SmartMixPlan | null {
    return this.currentPlan;
  }

  clearPlan(): void {
    this.currentPlan = null;
    this.currentState = {
      beatSyncLocked: false,
      phraseMatch: false,
      transitionReady: false,
      dropIncoming: false,
      smartMixActive: false,
      bassSwapActive: false,
      vocalBlendActive: false,
    };
    this.notifyListeners();
  }

  onStateChange(listener: (state: SmartMixState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const snapshot = { ...this.currentState };
    for (const l of this.listeners) {
      try { l(snapshot); } catch (e) { console.error("SmartMixEngine listener error:", e); }
    }
  }
}

export const smartMixEngine = new SmartMixEngine();
