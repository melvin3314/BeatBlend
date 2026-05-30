/**
 * TransitionIntentEngine
 * ========================
 * Le cerveau émotionnel du DJ.
 *
 * Ce moteur ne se contente PAS de trouver un point technique valide.
 * Il se demande : "Est-ce que cette transition est MUSICALEMENT
 * une bonne idée ? Un humain serait-il satisfait ?"
 *
 * Si la réponse est non, il :
 * - attend
 * - prolonge avec une loop
 * - prépare la tension
 * - cherche un meilleur moment
 */

import type { BackendTrackAnalysis, TransitionCandidate } from "../../types/transitions";
import type { Genre } from "../analysis/genreDetectionService";
import { calculateCamelotCompatibility } from "../analysis/keyDetectionService";

// ============================================================================
// TYPES
// ============================================================================

export interface IntentScore {
  total: number;           // 0-1, score global
  musical: number;         // cohérence musicale
  emotional: number;       // impact émotionnel
  narrative: number;       // avancement de l'histoire
  vocal: number;           // respect des vocals
  tension: number;         // anticipation satisfaite
  patience: number;        // récompense d'attente
  technical: number;       // qualité technique
}

export interface TransitionIntent {
  shouldTransition: boolean;
  score: IntentScore;
  candidate: TransitionCandidate | null;
  reason: string;
  alternativeAction: "wait" | "loop" | "extend" | "build_tension" | "transition_now";
  waitDuration: number;    // secondes à attendre si shouldTransition=false
  confidence: number;        // certitude de la décision
}

export interface MusicalMoment {
  time: number;
  type: "phrase_end" | "drop" | "buildup_start" | "vocal_pause" | "downbeat" | "section_change" | "energy_peak" | "energy_valley";
  energy: number;          // 0-1
  hasVocals: boolean;
  isSignificant: boolean;  // moment important de la chanson
  label: string;
}

export interface EnergyArc {
  current: number;         // énergie actuelle (0-1)
  trend: "rising" | "falling" | "plateau" | "peak" | "valley";
  nextPeak?: number;      // timestamp du prochain pic
  nextValley?: number;    // timestamp de la prochaine vallée
  phase: "intro" | "build" | "climax" | "release" | "outro";
}

export interface VocalContext {
  isInVocalSection: boolean;
  isAtPhraseEnd: boolean;
  isAtBreath: boolean;
  timeUntilVocalEnd: number;
  timeUntilNextVocal: number;
  isPunchline: boolean;
  protected: boolean;      // NE PAS COUPER
}

export interface TensionState {
  level: number;           // 0-1, tension actuelle
  target: number;          // tension cible
  isBuilding: boolean;
  timeToDrop: number;      // secondes jusqu'au prochain drop
  shouldPrepare: boolean;  // faut-il préparer la tension ?
}

export interface DJPersonality {
  patienceLevel: number;       // 0-1, 1 = très patient
  prefersLongTransitions: boolean;
  dropChaser: boolean;         // aime les drops
  vocalRespectLevel: number;   // 0-1, 1 = ne coupe JAMAIS
  energyBuilder: boolean;      // construit des arcs
  surpriseFactor: number;      // 0-1, aime surprendre
  minWaitBars: number;         // bars minimum avant transition
  maxWaitBars: number;         // bars maximum avant transition
}

// ============================================================================
// PERSONNALITÉS PAR GENRE
// ============================================================================

const GENRE_PERSONALITIES: Record<string, DJPersonality> = {
  "techno": {
    patienceLevel: 0.85,
    prefersLongTransitions: true,
    dropChaser: false,
    vocalRespectLevel: 0.3,
    energyBuilder: true,
    surpriseFactor: 0.2,
    minWaitBars: 8,
    maxWaitBars: 64,
  },
  "house": {
    patienceLevel: 0.75,
    prefersLongTransitions: true,
    dropChaser: true,
    vocalRespectLevel: 0.6,
    energyBuilder: true,
    surpriseFactor: 0.3,
    minWaitBars: 8,
    maxWaitBars: 48,
  },
  "trap": {
    patienceLevel: 0.4,
    prefersLongTransitions: false,
    dropChaser: true,
    vocalRespectLevel: 0.9,
    energyBuilder: false,
    surpriseFactor: 0.7,
    minWaitBars: 4,
    maxWaitBars: 16,
  },
  "rap": {
    patienceLevel: 0.5,
    prefersLongTransitions: false,
    dropChaser: false,
    vocalRespectLevel: 0.95,
    energyBuilder: false,
    surpriseFactor: 0.5,
    minWaitBars: 4,
    maxWaitBars: 24,
  },
  "phonk": {
    patienceLevel: 0.3,
    prefersLongTransitions: false,
    dropChaser: true,
    vocalRespectLevel: 0.4,
    energyBuilder: false,
    surpriseFactor: 0.8,
    minWaitBars: 4,
    maxWaitBars: 12,
  },
  "hyperpop": {
    patienceLevel: 0.35,
    prefersLongTransitions: false,
    dropChaser: true,
    vocalRespectLevel: 0.5,
    energyBuilder: true,
    surpriseFactor: 0.9,
    minWaitBars: 4,
    maxWaitBars: 16,
  },
  "hard_techno": {
    patienceLevel: 0.6,
    prefersLongTransitions: false,
    dropChaser: true,
    vocalRespectLevel: 0.2,
    energyBuilder: true,
    surpriseFactor: 0.6,
    minWaitBars: 4,
    maxWaitBars: 32,
  },
  "lofi": {
    patienceLevel: 0.9,
    prefersLongTransitions: true,
    dropChaser: false,
    vocalRespectLevel: 0.8,
    energyBuilder: true,
    surpriseFactor: 0.1,
    minWaitBars: 16,
    maxWaitBars: 64,
  },
  "reggae": {
    patienceLevel: 0.8,
    prefersLongTransitions: true,
    dropChaser: false,
    vocalRespectLevel: 0.85,
    energyBuilder: true,
    surpriseFactor: 0.2,
    minWaitBars: 8,
    maxWaitBars: 48,
  },
  "default": {
    patienceLevel: 0.5,
    prefersLongTransitions: false,
    dropChaser: true,
    vocalRespectLevel: 0.6,
    energyBuilder: true,
    surpriseFactor: 0.4,
    minWaitBars: 4,
    maxWaitBars: 32,
  },
};

function getPersonality(genre: Genre): DJPersonality {
  return GENRE_PERSONALITIES[genre] || GENRE_PERSONALITIES["default"];
}

// ============================================================================
// MUSICAL MOMENT DETECTION
// ============================================================================

function detectMusicalMoments(analysis: BackendTrackAnalysis): MusicalMoment[] {
  const moments: MusicalMoment[] = [];

  // Phrase ends
  for (const phrase of analysis.phrases) {
    const phraseEnergy = getEnergyAt(analysis.energyCurve, phrase.end)?.value || 0.5;
    const phraseDuration = phrase.end - phrase.start;
    const barCount = Math.round(phraseDuration / ((60 / analysis.bpm) * 4));
    moments.push({
      time: phrase.end,
      type: "phrase_end",
      energy: phraseEnergy,
      hasVocals: analysis.vocalSections.some(v => v.start <= phrase.end && v.end >= phrase.end),
      isSignificant: barCount >= 16,
      label: `Fin phrase ${barCount}b`,
    });
  }

  // Drops
  for (const drop of analysis.drops) {
    moments.push({
      time: drop.timestamp,
      type: "drop",
      energy: drop.intensity,
      hasVocals: false,
      isSignificant: drop.intensity > 0.7,
      label: drop.intensity > 0.7 ? "DROP INTENSE" : "Drop",
    });
  }

  // Buildups
  for (const build of analysis.builds) {
    moments.push({
      time: build.start,
      type: "buildup_start",
      energy: 0.4 + build.energyRise * 0.4,
      hasVocals: analysis.vocalSections.some(v => v.start <= build.start && v.end >= build.start),
      isSignificant: build.energyRise > 0.3,
      label: "Buildup",
    });
  }

  // Section changes
  for (const section of analysis.sections) {
    if (section.start > 0) {
      moments.push({
        time: section.start,
        type: "section_change",
        energy: section.energy,
        hasVocals: false,
        isSignificant: section.type === "drop" || section.type === "chorus",
        label: `Section ${section.type}`,
      });
    }
  }

  // Downbeats
  for (const db of analysis.downbeats) {
    // Only keep significant downbeats (every 4 bars = every 4th downbeat)
    const barIndex = analysis.downbeats.indexOf(db);
    if (barIndex % 4 === 0) {
      moments.push({
        time: db,
        type: "downbeat",
        energy: getEnergyAt(analysis.energyCurve, db)?.value || 0.5,
        hasVocals: analysis.vocalSections.some(v => v.start <= db && v.end >= db),
        isSignificant: false,
        label: "Downbeat",
      });
    }
  }

  // Vocal pauses (gaps between vocal sections)
  const sortedVocals = [...analysis.vocalSections].sort((a, b) => a.end - b.end);
  for (let i = 0; i < sortedVocals.length - 1; i++) {
    const gap = sortedVocals[i + 1].start - sortedVocals[i].end;
    if (gap > 2) {
      moments.push({
        time: sortedVocals[i].end + gap * 0.5,
        type: "vocal_pause",
        energy: getEnergyAt(analysis.energyCurve, sortedVocals[i].end)?.value || 0.5,
        hasVocals: false,
        isSignificant: gap > 4,
        label: "Pause vocale",
      });
    }
  }

  return moments.sort((a, b) => a.time - b.time);
}

// ============================================================================
// VOCAL INTELLIGENCE
// ============================================================================

function analyzeVocalContext(
  analysis: BackendTrackAnalysis,
  time: number
): VocalContext {
  const vocals = analysis.vocalSections;
  const current = vocals.find(v => v.start <= time && v.end >= time);

  // Find next vocal section
  const nextVocal = vocals.find(v => v.start > time);
  const prevVocal = [...vocals].reverse().find(v => v.end < time);

  const timeUntilVocalEnd = current ? current.end - time : 0;
  const timeUntilNextVocal = nextVocal ? nextVocal.start - time : Infinity;

  // Is this a punchline? (vocal section with high energy near a drop)
  let isPunchline = false;
  if (current) {
    const nearDrop = analysis.drops.some(d => Math.abs(d.timestamp - current.end) < 2);
    const vocalDuration = current.end - current.start;
    isPunchline = nearDrop && vocalDuration < 4;
  }

  // Protected: never cut this
  const protected_ = !!(
    current && (
      isPunchline ||
      (timeUntilVocalEnd > 1 && timeUntilVocalEnd < 4) || // mid-phrase
      (nextVocal && nextVocal.start - current.end > 6)  // last vocal before big gap
    )
  );

  // At phrase end of vocals?
  const isAtPhraseEnd = !!(
    current &&
    timeUntilVocalEnd < 1.5 &&
    timeUntilNextVocal > 1
  );

  // At a natural breath?
  const isAtBreath = !!(
    !current &&
    prevVocal &&
    time - prevVocal.end < 2 &&
    time - prevVocal.end > 0.3
  );

  return {
    isInVocalSection: !!current,
    isAtPhraseEnd,
    isAtBreath,
    timeUntilVocalEnd,
    timeUntilNextVocal,
    isPunchline,
    protected: protected_,
  };
}

// ============================================================================
// ENERGY ARC ANALYSIS
// ============================================================================

function analyzeEnergyArc(
  analysis: BackendTrackAnalysis,
  currentTime: number
): EnergyArc {
  const curve = analysis.energyCurve;
  if (curve.length === 0) {
    return { current: 0.5, trend: "plateau", phase: "build" };
  }

  const current = getEnergyAt(curve, currentTime)?.value || 0.5;

  // Trend: look at next 8 seconds
  const future = curve.filter(p => p.time > currentTime && p.time < currentTime + 8);
  const past = curve.filter(p => p.time > currentTime - 8 && p.time < currentTime);

  const futureAvg = future.length > 0 ? future.reduce((s, p) => s + p.value, 0) / future.length : current;
  const pastAvg = past.length > 0 ? past.reduce((s, p) => s + p.value, 0) / past.length : current;

  let trend: EnergyArc["trend"] = "plateau";
  if (futureAvg > pastAvg + 0.1) trend = "rising";
  else if (futureAvg < pastAvg - 0.1) trend = "falling";
  else if (current > 0.7) trend = "peak";
  else if (current < 0.3) trend = "valley";

  // Find next peak and valley
  let nextPeak: number | undefined;
  let nextValley: number | undefined;

  for (const point of curve.filter(p => p.time > currentTime)) {
    if (point.value > 0.7 && !nextPeak) nextPeak = point.time;
    if (point.value < 0.3 && !nextValley) nextValley = point.time;
    if (nextPeak && nextValley) break;
  }

  // Phase detection
  let phase: EnergyArc["phase"] = "build";
  const section = analysis.sections.find(s => currentTime >= s.start && currentTime <= s.end);
  if (section) {
    if (section.type === "intro") phase = "intro";
    else if (section.type === "drop" || section.type === "chorus") phase = "climax";
    else if (section.type === "outro") phase = "outro";
    else if (section.type === "breakdown" || section.type === "verse") phase = "release";
    else phase = "build";
  }

  return { current, trend, nextPeak, nextValley, phase };
}

// ============================================================================
// TENSION / DROP PSYCHOLOGY
// ============================================================================

function analyzeTension(
  analysis: BackendTrackAnalysis,
  currentTime: number,
  inPoint: number
): TensionState {
  const nextDrop = analysis.drops.find(d => d.timestamp > currentTime);
  const nextBuild = analysis.builds.find(b => b.start > currentTime);

  const dropTime = nextDrop?.timestamp ?? Infinity;
  const buildTime = nextBuild?.start ?? Infinity;

  const timeToDrop = Math.min(dropTime, buildTime) - currentTime;
  const isBuilding = timeToDrop < 16 && timeToDrop > 0;

  // Tension level based on proximity to drop
  let level = 0;
  if (timeToDrop < 4) level = 0.9;
  else if (timeToDrop < 8) level = 0.7;
  else if (timeToDrop < 16) level = 0.4;
  else level = 0.1;

  // If inPoint is right at drop, that's ideal
  const target = inPoint >= dropTime - 1 && inPoint <= dropTime + 1 ? 0.9 : 0.5;

  return {
    level,
    target,
    isBuilding,
    timeToDrop,
    shouldPrepare: isBuilding && timeToDrop > 4,
  };
}

// ============================================================================
// SCORING ENGINE
// ============================================================================

function scoreMusical(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number,
  personality: DJPersonality
): number {
  let score = 0.5;

  // Phrase alignment
  const phraseEndA = analysisA.phrases.some(p => Math.abs(p.end - outPoint) < 0.5);
  const phraseStartB = analysisB.phrases.some(p => Math.abs(p.start - inPoint) < 0.5);
  if (phraseEndA && phraseStartB) score += 0.25;
  else if (phraseEndA || phraseStartB) score += 0.10;

  // Downbeat alignment
  const downbeatA = analysisA.downbeats.some(d => Math.abs(d - outPoint) < 0.15);
  const downbeatB = analysisB.downbeats.some(d => Math.abs(d - inPoint) < 0.15);
  if (downbeatA && downbeatB) score += 0.15;
  else if (downbeatA || downbeatB) score += 0.05;

  // Bar alignment
  const beatDurA = 60 / analysisA.bpm;
  const beatDurB = 60 / analysisB.bpm;
  const barAlignedA = analysisA.beats.some(b => Math.abs(b - outPoint) < beatDurA * 0.3);
  const barAlignedB = analysisB.beats.some(b => Math.abs(b - inPoint) < beatDurB * 0.3);
  if (barAlignedA && barAlignedB) score += 0.10;

  // Key compatibility
  const keyScore = calculateCamelotCompatibility(analysisA.camelot, analysisB.camelot);
  score += keyScore * 0.15;

  // Genre personality bonus
  if (personality.prefersLongTransitions) {
    const sectionA = analysisA.sections.find(s => outPoint >= s.start && outPoint <= s.end);
    if (sectionA?.type === "outro") score += 0.10;
  }

  return Math.min(1, score);
}

function scoreEmotional(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number,
  personality: DJPersonality
): number {
  let score = 0.5;

  const arcA = analyzeEnergyArc(analysisA, outPoint);
  const arcB = analyzeEnergyArc(analysisB, inPoint);

  // Emotional flow: what direction is the energy going?
  const energyDiff = arcB.current - arcA.current;

  // Techno/house: prefers smooth, hypnotic transitions
  if (personality.prefersLongTransitions) {
    // Prefer similar energy levels for smooth blending
    const smoothness = 1 - Math.abs(energyDiff);
    score += smoothness * 0.3;
  } else {
    // Rap/trap/phonk: can handle energy jumps if they make sense
    if (energyDiff > 0.2) score += 0.15; // energy boost
    else if (energyDiff < -0.3) score -= 0.10; // too much drop
  }

  // Drop psychology: entering on a drop is emotionally satisfying
  const enteringDrop = analysisB.drops.some(d => Math.abs(d.timestamp - inPoint) < 1);
  if (enteringDrop) score += 0.25;

  // Buildup entry creates anticipation
  const enteringBuild = analysisB.builds.some(b => Math.abs(b.start - inPoint) < 1);
  if (enteringBuild) score += 0.15;

  // Exiting at a natural ending point
  const exitingOutro = analysisA.sections.some(s => s.type === "outro" && outPoint >= s.start);
  if (exitingOutro) score += 0.10;

  return Math.min(1, score);
}

function scoreNarrative(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number
): number {
  let score = 0.5;

  const arcA = analyzeEnergyArc(analysisA, outPoint);
  const arcB = analyzeEnergyArc(analysisB, inPoint);

  // Story flow: don't jump from climax to intro (anti-climactic)
  if (arcA.phase === "climax" && arcB.phase === "intro") {
    score -= 0.20;
  }

  // Good flow: release → build → climax
  if (arcA.phase === "release" && arcB.phase === "build") {
    score += 0.20;
  }
  if (arcA.phase === "build" && arcB.phase === "climax") {
    score += 0.25;
  }

  // Outro → intro is a natural handoff
  if (arcA.phase === "outro" && arcB.phase === "intro") {
    score += 0.15;
  }

  // Don't exit too early in a song (waste of potential)
  const durA = analysisA.beats.length > 0
    ? analysisA.beats[analysisA.beats.length - 1] + 60 / analysisA.bpm
    : 180;
  if (outPoint < durA * 0.3) {
    score -= 0.15; // exiting too early
  }

  return Math.max(0, Math.min(1, score));
}

function scoreVocal(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number,
  personality: DJPersonality
): number {
  let score = 0.7; // start high, deduct for vocal problems

  const vocalA = analyzeVocalContext(analysisA, outPoint);
  const vocalB = analyzeVocalContext(analysisB, inPoint);

  // NEVER cut a protected vocal section
  if (vocalA.protected) {
    score -= 0.5 * personality.vocalRespectLevel;
  }

  // Cutting at a natural vocal pause is ideal
  if (vocalA.isAtPhraseEnd || vocalA.isAtBreath) {
    score += 0.15 * personality.vocalRespectLevel;
  }

  // Both tracks with vocals during transition = clash
  if (vocalA.isInVocalSection && vocalB.isInVocalSection) {
    score -= 0.35 * personality.vocalRespectLevel;
  }

  // One has vocals, other is instrumental = good for blending
  if ((vocalA.isInVocalSection && !vocalB.isInVocalSection) ||
      (!vocalA.isInVocalSection && vocalB.isInVocalSection)) {
    score += 0.10;
  }

  // Entering on a vocal section is risky
  if (vocalB.isInVocalSection && !vocalB.isAtPhraseEnd) {
    score -= 0.15;
  }

  // Punchline protection
  if (vocalA.isPunchline || vocalB.isPunchline) {
    score -= 0.3 * personality.vocalRespectLevel;
  }

  return Math.max(0, Math.min(1, score));
}

function scoreTension(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number,
  personality: DJPersonality
): number {
  const tensionB = analyzeTension(analysisB, inPoint - 8, inPoint);

  let score = 0.5;

  // If we're entering right at a drop, the tension was built and released = satisfying
  const enteringDrop = analysisB.drops.some(d => Math.abs(d.timestamp - inPoint) < 1);
  if (enteringDrop && tensionB.isBuilding) {
    score += 0.25;
  }

  // If we're cutting tension short, that's unsatisfying
  const dropSoon = analysisB.drops.some(d => d.timestamp > inPoint && d.timestamp - inPoint < 4);
  if (dropSoon && !enteringDrop) {
    score -= 0.20; // we're landing just before a drop, creating a double impact that's messy
  }

  // For patient genres, building tension over time is important
  if (personality.patienceLevel > 0.7 && tensionB.isBuilding) {
    score += 0.10;
  }

  return Math.max(0, Math.min(1, score));
}

function scorePatience(
  outPoint: number,
  currentTime: number,
  analysisA: BackendTrackAnalysis,
  personality: DJPersonality
): number {
  const beatDur = 60 / analysisA.bpm;
  const barsWaited = (outPoint - currentTime) / (beatDur * 4);

  // If we've waited a reasonable amount, reward it
  if (barsWaited >= personality.minWaitBars && barsWaited <= personality.maxWaitBars) {
    return 0.7 + (personality.patienceLevel * 0.2);
  }

  // If we're rushing (too little wait), penalize
  if (barsWaited < personality.minWaitBars) {
    return 0.3;
  }

  // If we've waited too long, slightly penalize (boring)
  if (barsWaited > personality.maxWaitBars) {
    return 0.5;
  }

  return 0.5;
}

function scoreTechnical(
  analysisA: BackendTrackAnalysis,
  analysisB: BackendTrackAnalysis,
  outPoint: number,
  inPoint: number
): number {
  let score = 0.5;

  // BPM compatibility
  const bpmDiff = Math.abs(analysisA.bpm - analysisB.bpm);
  const bpmRatio = Math.max(analysisA.bpm, analysisB.bpm) / Math.min(analysisA.bpm, analysisB.bpm);

  if (bpmDiff < 2) score += 0.2;
  else if (bpmDiff < 6) score += 0.1;
  else if (bpmRatio > 1.5) score -= 0.15;

  // Timing precision
  const beatDurA = 60 / analysisA.bpm;
  const nearestBeatA = analysisA.beats.find(b => Math.abs(b - outPoint) < beatDurA * 0.5);
  const nearestBeatB = analysisB.beats.find(b => Math.abs(b - inPoint) < 60 / analysisB.bpm * 0.5);

  if (nearestBeatA && nearestBeatB) score += 0.15;
  else if (nearestBeatA || nearestBeatB) score += 0.05;

  return Math.min(1, score);
}

// ============================================================================
// INTENT COMPUTATION
// ============================================================================

export interface IntentContext {
  analysisA: BackendTrackAnalysis;
  analysisB: BackendTrackAnalysis;
  currentTime: number;
  genreA: Genre;
  genreB: Genre;
  previousTransitions: number; // count in this session
  overallEnergy: number;      // current mix energy level
}

function computeIntentScore(
  ctx: IntentContext,
  outPoint: number,
  inPoint: number
): IntentScore {
  const personality = getPersonality(ctx.genreA);

  const musical = scoreMusical(ctx.analysisA, ctx.analysisB, outPoint, inPoint, personality);
  const emotional = scoreEmotional(ctx.analysisA, ctx.analysisB, outPoint, inPoint, personality);
  const narrative = scoreNarrative(ctx.analysisA, ctx.analysisB, outPoint, inPoint);
  const vocal = scoreVocal(ctx.analysisA, ctx.analysisB, outPoint, inPoint, personality);
  const tension = scoreTension(ctx.analysisA, ctx.analysisB, outPoint, inPoint, personality);
  const patience = scorePatience(outPoint, ctx.currentTime, ctx.analysisA, personality);
  const technical = scoreTechnical(ctx.analysisA, ctx.analysisB, outPoint, inPoint);

  // Weight by genre personality
  const weights = {
    musical: 0.20,
    emotional: 0.20,
    narrative: 0.15,
    vocal: personality.vocalRespectLevel * 0.20,
    tension: 0.10,
    patience: 0.05,
    technical: 0.10,
  };

  // Normalize weights
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  const total = (
    musical * weights.musical +
    emotional * weights.emotional +
    narrative * weights.narrative +
    vocal * weights.vocal +
    tension * weights.tension +
    patience * weights.patience +
    technical * weights.technical
  ) / totalWeight;

  return {
    total: Math.max(0, Math.min(1, total)),
    musical,
    emotional,
    narrative,
    vocal,
    tension,
    patience,
    technical,
  };
}

// ============================================================================
// MAIN ENGINE
// ============================================================================

export interface HumanDJDecision {
  intent: TransitionIntent;
  bestOutPoint: number;
  bestInPoint: number;
  momentsA: MusicalMoment[];
  momentsB: MusicalMoment[];
  recommendation: string;
}

export class TransitionIntentEngine {
  private lastTransitionTime: number = 0;
  private transitionHistory: { time: number; score: number; genreA: string; genreB: string }[] = [];

  /**
   * Évalue si une transition est une bonne idée musicale.
   * C'est la fonction principale.
   */
  evaluateTransition(
    ctx: IntentContext,
    candidate: TransitionCandidate
  ): TransitionIntent {
    const score = computeIntentScore(ctx, candidate.outPoint, candidate.inPoint);

    // Determine if we should transition based on score
    const personality = getPersonality(ctx.genreA);

    // Minimum score thresholds by genre
    const minScore = 0.35 + (personality.patienceLevel * 0.25); // 0.35-0.60

    let shouldTransition = score.total >= minScore;
    let reason = "";
    let alternativeAction: TransitionIntent["alternativeAction"] = "wait";
    let waitDuration = 0;

    // Check vocal protection - absolute veto
    const vocalA = analyzeVocalContext(ctx.analysisA, candidate.outPoint);
    if (vocalA.protected && personality.vocalRespectLevel > 0.5) {
      shouldTransition = false;
      reason = `Vocal protégé - attendre ${vocalA.timeUntilVocalEnd.toFixed(1)}s`;
      alternativeAction = "wait";
      waitDuration = vocalA.timeUntilVocalEnd + 1;
    }

    // Check if we're in a buildup that shouldn't be interrupted
    const arcA = analyzeEnergyArc(ctx.analysisA, candidate.outPoint);
    if (arcA.trend === "rising" && arcA.nextPeak && arcA.nextPeak - candidate.outPoint < 4) {
      // We're about to hit a peak, don't cut it short
      // Use a genre-aware threshold: impatient genres are more willing to cut through buildups
      const buildupThreshold = 0.55 + (personality.patienceLevel * 0.20); // 0.55-0.75
      if (score.total < buildupThreshold) {
        shouldTransition = false;
        reason = `Buildup en cours - pic dans ${(arcA.nextPeak - candidate.outPoint).toFixed(1)}s`;
        alternativeAction = "wait";
        // Wait at least until past the peak, but minimum 4s to avoid rapid re-firing
        waitDuration = Math.max(4, arcA.nextPeak - candidate.outPoint + 2);
      }
    }

    // If score is mediocre, prefer waiting
    if (!shouldTransition && score.total < minScore) {
      reason = reason || `Score faible (${(score.total * 100).toFixed(0)}%) - attendre un meilleur moment`;
      alternativeAction = "wait";
      // Wait until next significant moment, minimum 4s to avoid rapid re-firing
      const nextMoment = this.findNextSignificantMoment(ctx.analysisA, ctx.currentTime);
      waitDuration = Math.max(4, nextMoment ? nextMoment.time - ctx.currentTime : 8);
    }

    // If score is good, transition
    if (shouldTransition) {
      reason = `Transition approuvée: ${(score.total * 100).toFixed(0)}% | musical=${(score.musical * 100).toFixed(0)}% emotional=${(score.emotional * 100).toFixed(0)}% vocal=${(score.vocal * 100).toFixed(0)}%`;
      alternativeAction = "transition_now";
      waitDuration = 0;
    }

    // Cap wait duration
    waitDuration = Math.min(waitDuration, 16);

    return {
      shouldTransition,
      score,
      candidate: shouldTransition ? candidate : null,
      reason,
      alternativeAction,
      waitDuration,
      confidence: shouldTransition ? score.total : (1 - score.total),
    };
  }

  /**
   * Cherche le MEILLEUR moment de transition dans les prochaines phrases.
   * Regarde plus loin qu'un simple point immédiat.
   */
  findBestMoment(
    ctx: IntentContext,
    lookAheadBars: number = 32
  ): HumanDJDecision | null {
    const beatDur = 60 / ctx.analysisA.bpm;
    const lookAheadSec = lookAheadBars * beatDur * 4;
    const endTime = Math.min(
      ctx.currentTime + lookAheadSec,
      ctx.analysisA.beats[ctx.analysisA.beats.length - 1] || ctx.currentTime + 60
    );

    // Generate candidate points from musical moments
    const momentsA = detectMusicalMoments(ctx.analysisA).filter(m =>
      m.time > ctx.currentTime + 5 && m.time < endTime
    );
    const momentsB = detectMusicalMoments(ctx.analysisB).filter(m =>
      m.time > 5 && m.time < ctx.analysisB.beats[ctx.analysisB.beats.length - 1] || 180
    );

    let bestScore = -1;
    let bestOut = 0;
    let bestIn = 0;
    let bestReason = "";

    for (const momentA of momentsA) {
      for (const momentB of momentsB) {
        const outPoint = momentA.time;
        const inPoint = momentB.time;

        const score = computeIntentScore(ctx, outPoint, inPoint);

        if (score.total > bestScore) {
          bestScore = score.total;
          bestOut = outPoint;
          bestIn = inPoint;
          bestReason = `${momentA.label} → ${momentB.label}`;
        }
      }
    }

    if (bestScore < 0) return null;

    const personality = getPersonality(ctx.genreA);
    const minScore = 0.35 + (personality.patienceLevel * 0.25);

    const intent: TransitionIntent = {
      shouldTransition: bestScore >= minScore,
      score: computeIntentScore(ctx, bestOut, bestIn),
      candidate: null,
      reason: bestReason,
      alternativeAction: bestScore >= minScore ? "transition_now" : "wait",
      waitDuration: 0,
      confidence: bestScore,
    };

    return {
      intent,
      bestOutPoint: bestOut,
      bestInPoint: bestIn,
      momentsA,
      momentsB,
      recommendation: bestScore >= minScore
        ? `GO: ${bestReason} (score ${(bestScore * 100).toFixed(0)}%)`
        : `WAIT: ${bestReason} (score ${(bestScore * 100).toFixed(0)}%)`,
    };
  }

  /**
   * Recommande une action quand on attend.
   */
  suggestWaitAction(
    ctx: IntentContext,
    currentTime: number
  ): { action: "loop" | "extend" | "build_tension" | "wait"; duration: number; reason: string } {
    const arcA = analyzeEnergyArc(ctx.analysisA, currentTime);
    const personality = getPersonality(ctx.genreA);
    const vocalA = analyzeVocalContext(ctx.analysisA, currentTime);

    // If in outro, loop it
    if (arcA.phase === "outro") {
      return { action: "loop", duration: 8, reason: "Loop outro en attendant le bon moment" };
    }

    // If vocals are active, wait for them to end
    if (vocalA.isInVocalSection && !vocalA.isAtPhraseEnd) {
      return { action: "wait", duration: vocalA.timeUntilVocalEnd + 0.5, reason: "Attendre fin des vocals" };
    }

    // If building to a peak, extend the buildup
    if (arcA.trend === "rising" && arcA.nextPeak) {
      const timeToPeak = arcA.nextPeak - currentTime;
      if (timeToPeak < 8) {
        return { action: "build_tension", duration: timeToPeak, reason: "Construire tension vers le pic" };
      }
    }

    // Default: just wait for next phrase
    const beatDur = 60 / ctx.analysisA.bpm;
    const barsToNextPhrase = personality.minWaitBars;
    return { action: "wait", duration: barsToNextPhrase * beatDur * 4, reason: `Attendre ${barsToNextPhrase} mesures` };
  }

  private findNextSignificantMoment(analysis: BackendTrackAnalysis, after: number): MusicalMoment | null {
    const moments = detectMusicalMoments(analysis);
    return moments.find(m => m.time > after && m.isSignificant) || null;
  }

  recordTransition(time: number, score: number, genreA: string, genreB: string) {
    this.lastTransitionTime = time;
    this.transitionHistory.push({ time, score, genreA, genreB });
    if (this.transitionHistory.length > 50) this.transitionHistory.shift();
  }

  getLastTransitionTime(): number {
    return this.lastTransitionTime;
  }

  getHistory() {
    return [...this.transitionHistory];
  }
}

export const transitionIntentEngine = new TransitionIntentEngine();

// ============================================================================
// UTILS
// ============================================================================

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
