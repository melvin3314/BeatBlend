import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useRef, useState } from "react";

import { detectBars } from "../services/analysis/barDetectionService";
import { alignTracks } from "../services/analysis/BeatAlignmentEngine";
import { buildBeatGrid, type BeatGrid } from "../services/analysis/BeatGrid";
import { analyzeBpm } from "../services/analysis/bpmDetectionService";
import { generateCuePoints, type CuePointSet } from "../services/analysis/cuePointService";
import { detectDrops } from "../services/analysis/dropDetectionService";
import { analyzeEnergy, analyzeEnergyFallback } from "../services/analysis/energyAnalysisService";
import { detectGenre, type Genre } from "../services/analysis/genreDetectionService";
import { estimateKey } from "../services/analysis/keyDetectionService";
import { checkMusicalGate, findNextMusicalMoment } from "../services/analysis/musicalGateService";
import { detectPhrases, type Phrase, type PhraseDetectionResult } from "../services/analysis/phraseDetectionService";
import { computeTransitionTiming } from "../services/analysis/SmartTransitionTimer";
import { analyzeTrackBackend } from "../services/backend/beatBlendBackend";
import { clearAnalysisCache, loadCachedAnalysis, saveCachedAnalysis } from "../services/cache/analysisCacheService";
import { getMixProfile, mergeProfiles } from "../services/mix/genreMixProfiles";
import { transitionSelector } from "../services/transition/transitionSelector";

import { audioEngine } from "../engine/AudioEngine";
import { smartMixEngine, type MixEngineContext } from "../engine/SmartMixEngine";
import type { RateMorphConfig } from "../engine/TransitionEngine";
import { transitionEngine, type TransitionProgress } from "../engine/TransitionEngine";
import { PRESETS } from "../engine/TransitionPresets";
import { usePlaylist } from "./usePlaylist";

import type { SelectedTrack } from "../types/audio";
import type { DropPoint, EnergyAnalysisResult, EnergySection } from "../types/audioAnalysis";
import type { BackendTrackAnalysis, PlaylistTrack, SmartMixPlan, SmartMixState } from "../types/transitions";

// --- Track Analysis Cache ---

interface TrackAnalysis {
  bpm: number;
  duration: number;
  beats: number[];
  bars: number[];
  sections: EnergySection[];
  drops: DropPoint[];
  buildups: DropPoint[];
  energy: number;
  phrases: Phrase[];
  phraseData: PhraseDetectionResult | null;
  cuePoints: CuePointSet | null;
  key?: string;
  camelot?: string;
  beatGrid: BeatGrid | null;
  rms: number[];
  timestamps: number[];
  genre: Genre;
  genreConfidence: number;
  backendAnalysis?: BackendTrackAnalysis; // données du serveur Python
}

/**
 * Convertit les sections du backend Python en EnergySection locales.
 */
function mapBackendSections(
  backendSections: BackendTrackAnalysis["sections"],
  energyCurve: BackendTrackAnalysis["energyCurve"]
): EnergySection[] {
  if (backendSections.length === 0 && energyCurve.length === 0) return [];

  // Si le backend fournit des sections, les utiliser
  if (backendSections.length > 0) {
    return backendSections.map(s => ({
      startTime: s.start,
      endTime: s.end,
      energyLevel: (s.energy > 0.7 ? "high" : s.energy > 0.4 ? "medium" : "low") as EnergySection["energyLevel"],
      type: (s.type as EnergySection["type"]) || "unknown",
    }));
  }

  // Sinon, dériver des points de la courbe d'énergie
  const sections: EnergySection[] = [];
  let current: EnergySection | null = null;

  for (const pt of energyCurve) {
    const level = pt.level as EnergySection["energyLevel"];
    if (!current) {
      current = { startTime: pt.time, endTime: pt.time, energyLevel: level, type: "unknown" };
    } else if (current.energyLevel !== level) {
      sections.push(current);
      current = { startTime: pt.time, endTime: pt.time, energyLevel: level, type: "unknown" };
    } else {
      current.endTime = pt.time;
    }
  }
  if (current) sections.push(current);

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

const DECK_A = "deckA";
const DECK_B = "deckB";

export const useAutoDJ = () => {
  const playlist = usePlaylist();

  // --- Analysis state ---
  const analysisCache = useRef<Map<string, TrackAnalysis>>(new Map());
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [currentAnalysis, setCurrentAnalysis] = useState<TrackAnalysis | null>(null);
  const [nextAnalysis, setNextAnalysis] = useState<TrackAnalysis | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState("Import des morceaux pour commencer");

  // --- Playback state ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);
  const [activeDeck, setActiveDeck] = useState<string>(DECK_A);

  // --- Transition state ---
  const [transitionState, setTransitionState] = useState<TransitionProgress>({
    state: "idle",
    presetName: null,
    progress: 0,
    elapsed: 0,
    total: 0,
    deckA_volume: 1,
    deckB_volume: 0,
  });
  const [transitionPoint, setTransitionPoint] = useState<number | null>(null);
  const isTransitioningRef = useRef(false);

  // --- Compatibility / Preset info ---
  const [selectedPreset, setSelectedPreset] = useState<{ name: string; label: string; confidence: number } | null>(null);
  const [compatibilityScores, setCompatibilityScores] = useState<Record<string, number>>({});

  // --- Loop state ---
  const [isLooping, setIsLooping] = useState(false);
  const [loopBeats, setLoopBeats] = useState(4);

  // --- Smart Mix UI Feedback ---
  const [smartMixState, setSmartMixState] = useState<SmartMixState>({
    beatSyncLocked: false,
    phraseMatch: false,
    transitionReady: false,
    dropIncoming: false,
    smartMixActive: false,
    bassSwapActive: false,
    vocalBlendActive: false,
  });

  // --- Messages ---
  const [statusMessage, setStatusMessage] = useState("Prêt");

  // Refs for callbacks used in engine listener (avoid stale closures)
  const activeDeckRef = useRef(activeDeck);
  activeDeckRef.current = activeDeck;
  const autoplayRef = useRef(playlist.autoplay);
  autoplayRef.current = playlist.autoplay;
  const currentAnalysisRef = useRef(currentAnalysis);
  currentAnalysisRef.current = currentAnalysis;
  const nextAnalysisRef = useRef(nextAnalysis);
  nextAnalysisRef.current = nextAnalysis;
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;

  // Auto-transition trigger point (in seconds). null = not calculated yet
  const autoTransitionPointRef = useRef<number | null>(null);
  const autoTransitionTriggeredRef = useRef(false);
  const cancelRateRampRef = useRef<(() => void) | null>(null);

  // Musical gate state
  const waitingForMusicalGateRef = useRef(false);
  const nextMusicalMomentRef = useRef<{ time: number; reason: string } | null>(null);
  const gateLogDebounceRef = useRef(0);

  // Ref to always call latest version of triggerSmartTransition
  const triggerSmartTransitionRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // --- Smart transition point detection ---

  /**
   * Calcule le point optimal de transition basé sur l'analyse du morceau.
   * Contraintes : jamais avant 30s, jamais dans les 40 dernières secondes.
   * Priorise : drop → buildup → fin de chorus → barre de mesure → fallback musical
   */
  const computeTransitionPoint = (analysis: TrackAnalysis): number => {
    const dur = analysis.duration;
    if (dur <= 0) return 0;

    // Contraintes temporelles strictes
    const minAfterStart = 30; // jamais avant 30s
    const minBeforeEnd = 40;  // jamais dans les 40 dernières secondes

    // Si le morceau est trop court pour les deux contraintes, on privilégie minAfterStart
    if (dur < minAfterStart + minBeforeEnd) {
      return Math.min(minAfterStart, dur * 0.5);
    }

    const maxTransitionPoint = dur - minBeforeEnd;

    // Zone cible : entre 65% et 92% du morceau, respectant les contraintes
    const windowStart = Math.max(minAfterStart, dur * 0.65);
    const windowEnd = Math.min(dur * 0.92, maxTransitionPoint);

    // 1) Chercher un buildup dans la zone (meilleur moment pour mixer)
    const buildupsInWindow = analysis.buildups.filter(
      (b) => b.timestamp >= windowStart && b.timestamp <= windowEnd
    );
    if (buildupsInWindow.length > 0) {
      // Prendre le dernier buildup (plus proche de la fin, transition plus propre)
      return buildupsInWindow[buildupsInWindow.length - 1].timestamp;
    }

    // 2) Chercher la fin d'un chorus/drop dans la zone
    const goodSections = analysis.sections.filter(
      (s) =>
        (s.type === "chorus" || s.type === "drop") &&
        s.endTime >= windowStart &&
        s.endTime <= windowEnd
    );
    if (goodSections.length > 0) {
      return goodSections[goodSections.length - 1].endTime;
    }

    // 3) Chercher un drop dans la zone (transition sur le drop)
    const dropsInWindow = analysis.drops.filter(
      (d) => d.timestamp >= windowStart && d.timestamp <= windowEnd
    );
    if (dropsInWindow.length > 0) {
      return dropsInWindow[dropsInWindow.length - 1].timestamp;
    }

    // 4) Éviter les sections silence/low energy à la fin
    const lowEndSections = analysis.sections.filter(
      (s) => s.energyLevel === "low" && s.endTime >= dur * 0.8
    );
    if (lowEndSections.length > 0) {
      // Transitionner AVANT le silence
      return Math.max(windowStart, lowEndSections[0].startTime - 2);
    }

    // 5) Aligner sur une barre de mesure dans la zone
    const barsInWindow = analysis.bars.filter(
      (b) => b >= windowStart && b <= windowEnd
    );
    if (barsInWindow.length > 0) {
      return barsInWindow[barsInWindow.length - 1];
    }

    // 6) Fallback : 40 secondes avant la fin (minimum)
    return Math.max(0, dur - minBeforeEnd);
  };

  /**
   * Convertit une TrackAnalysis en PlaylistTrack pour le transitionSelector
   */
  const toPlaylistTrack = (analysis: TrackAnalysis, track: SelectedTrack): PlaylistTrack => ({
    id: track.uri,
    name: track.name,
    uri: track.uri,
    bpm: analysis.bpm,
    duration: analysis.duration,
    energy: analysis.energy,
    key: analysis.key,
    camelotWheel: analysis.camelot,
    beats: analysis.beats,
    sections: analysis.sections as any,
    drops: analysis.drops as any,
    buildups: analysis.buildups as any,
    genre: analysis.genre,
    genreConfidence: analysis.genreConfidence,
  });

  /**
   * Trouve le point d'entrée optimal sur le prochain morceau
   * Cherche dans tout le morceau le point qui "colle" le mieux
   * (drop, buildup, ou section haute énergie préférés, éviter fin)
   * Minimum: toujours commencer après 30 secondes
   */
  const computeEntryPoint = (analysis: TrackAnalysis): number => {
    const minEntryPoint = 30; // jamais avant 30s
    let bestScore = -1;
    let bestPoint = minEntryPoint;

    // Évaluer tous les drops (minimum 30s)
    for (const drop of analysis.drops) {
      if (drop.timestamp < minEntryPoint) continue; // Ignorer avant 30s
      if (drop.timestamp > analysis.duration * 0.7) continue; // Éviter fin
      const score = 0.95;
      if (score > bestScore) {
        bestScore = score;
        bestPoint = drop.timestamp;
      }
    }

    // Évaluer tous les buildups (minimum 30s)
    for (const buildup of analysis.buildups) {
      if (buildup.timestamp < minEntryPoint) continue; // Ignorer avant 30s
      if (buildup.timestamp > analysis.duration * 0.7) continue;
      const score = 0.90;
      if (score > bestScore) {
        bestScore = score;
        bestPoint = buildup.timestamp;
      }
    }

    // Évaluer toutes les sections haute énergie (minimum 30s)
    for (const section of analysis.sections) {
      if (section.startTime < minEntryPoint) continue; // Ignorer avant 30s
      if (section.energyLevel === "high" && section.startTime < analysis.duration * 0.7) {
        const score = 0.75;
        if (score > bestScore) {
          bestScore = score;
          bestPoint = section.startTime;
        }
      }
    }

    // Fallback: si rien trouvé après 30s, chercher une barre de mesure
    if (bestScore < 0 && analysis.bars.length > 0) {
      const barsAfter30 = analysis.bars.filter(b => b >= minEntryPoint && b < analysis.duration * 0.5);
      if (barsAfter30.length > 0) {
        bestPoint = barsAfter30[0]; // première barre après 30s
      }
    }

    return Math.max(minEntryPoint, bestPoint);
  };

  // --- Initialize engine listeners ---
  useEffect(() => {
    let lastPositionUpdate = 0;
    let lastDuration = -1;

    const unsubEngine = audioEngine.on((event) => {
      if (event.type === "position-update" && event.deckId === activeDeckRef.current) {
        // Throttle position updates to ~5Hz (200ms) to avoid excessive re-renders
        const now = Date.now();
        if (now - lastPositionUpdate > 250) {
          lastPositionUpdate = now;
          setCurrentPosition(event.position);
        }
        // Duration changes rarely — only update when actually different
        if (event.duration !== lastDuration && event.duration > 0) {
          lastDuration = event.duration;
          setCurrentDuration(event.duration);
        }

        // --- SMART MIX ENGINE : real-time state update ---
        const fromA = currentAnalysisRef.current;
        const toA = nextAnalysisRef.current;
        if (fromA?.backendAnalysis && toA?.backendAnalysis) {
          const ctx: MixEngineContext = {
            analysisA: fromA.backendAnalysis,
            analysisB: toA.backendAnalysis,
            currentTime: event.position,
            genreA: fromA.genre,
            genreB: toA.genre,
          };
          const mixState = smartMixEngine.updateState(ctx, event.position);
          setSmartMixState(mixState);
        }

        // --- AUTO TRANSITION TRIGGER (MUSICAL GATE) ---
        const triggerPoint = autoTransitionPointRef.current;
        if (
          triggerPoint !== null &&
          !isTransitioningRef.current &&
          !autoTransitionTriggeredRef.current &&
          autoplayRef.current &&
          event.position >= triggerPoint
        ) {
          const analysis = currentAnalysisRef.current;
          if (analysis?.beatGrid) {
            // Vérifier si on est à un moment musical cohérent
            const gate = checkMusicalGate(
              event.position,
              analysis.beatGrid,
              analysis.sections,
              analysis.drops,
              analysis.buildups
            );

            if (gate.shouldTrigger) {
              autoTransitionTriggeredRef.current = true;
              waitingForMusicalGateRef.current = false;
              nextMusicalMomentRef.current = null;
              console.log(`[AutoDJ] Musical gate: ${gate.reason} | confidence=${(gate.confidence * 100).toFixed(0)}%`);
              (async () => {
                try {
                  await triggerSmartTransitionRef.current();
                } catch (err: any) {
                  console.error('[AutoDJ] Musical gate transition error:', err);
                }
              })();
            } else {
              // On a dépassé le trigger minimum mais pas de bon moment → attendre
              waitingForMusicalGateRef.current = true;

              // Chercher le prochain moment musical si pas déjà fait
              if (!nextMusicalMomentRef.current) {
                const nextMoment = findNextMusicalMoment(
                  event.position,
                  analysis.beatGrid,
                  analysis.sections,
                  analysis.drops,
                  analysis.buildups
                );
                if (nextMoment) {
                  nextMusicalMomentRef.current = nextMoment;
                }
              }

              // Log débounced (~1Hz)
              const now = Date.now();
              if (now - gateLogDebounceRef.current > 1000) {
                gateLogDebounceRef.current = now;
                const next = nextMusicalMomentRef.current;
                if (next) {
                  const waitSec = (next.time - event.position).toFixed(1);
                  console.log(`[AutoDJ] Waiting for musical gate: ${next.reason} in ${waitSec}s`);
                  setStatusMessage(`Attente: ${next.reason} (+${waitSec}s)`);
                } else {
                  console.log(`[AutoDJ] Waiting for musical gate: no next moment found`);
                }
              }

              // FORCED FALLBACK: si on attend plus de 12s après triggerPoint,
              // forcer sur le prochain downbeat pour ne pas bloquer indéfiniment
              const waited = event.position - triggerPoint;
              if (waited > 12) {
                const { getNextDownbeat } = require("../services/analysis/BeatGrid");
                const nextDownbeat = getNextDownbeat(analysis.beatGrid, event.position);
                if (nextDownbeat && Math.abs(event.position - nextDownbeat) < 0.3) {
                  autoTransitionTriggeredRef.current = true;
                  waitingForMusicalGateRef.current = false;
                  nextMusicalMomentRef.current = null;
                  console.log(`[AutoDJ] Forced fallback: downbeat after ${waited.toFixed(1)}s wait`);
                  (async () => {
                    try {
                      await triggerSmartTransitionRef.current();
                    } catch (err: any) {
                      console.error('[AutoDJ] Musical gate transition error:', err);
                    }
                  })();
                }
              }
            }
          } else {
            // Pas d'analyse disponible → fallback timer (éviter si possible)
            autoTransitionTriggeredRef.current = true;
            (async () => {
              try {
                await triggerSmartTransitionRef.current();
              } catch (err: any) {
                console.error('[AutoDJ] Fallback transition error:', err);
              }
            })();
          }
        }
      }

      // Fallback : si le morceau se termine sans transition
      if (event.type === "deck-ended" && event.deckId === activeDeckRef.current) {
        if (!isTransitioningRef.current && autoplayRef.current) {
          autoTransitionTriggeredRef.current = true;
          (async () => {
            try {
              await triggerSmartTransitionRef.current();
            } catch (err: any) {
              console.error('[AutoDJ] Deck-ended transition error:', err);
            }
          })();
        }
      }
    });

    const unsubTransition = transitionEngine.onProgress((progress) => {
      setTransitionState(progress);

      if (progress.state === "complete") {
        isTransitioningRef.current = false;
      }
    });

    return () => {
      unsubEngine();
      unsubTransition();
      if (analysisAbortRef.current) {
        analysisAbortRef.current.abort();
        analysisAbortRef.current = null;
      }
    };
  }, []);

  // --- Import ---

  const importTracks = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/mpeg",
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        setStatusMessage("Import annulé");
        return;
      }

      if (result.assets.length < 2) {
        setStatusMessage("Sélectionne au moins 2 fichiers MP3");
        return;
      }

      const tracks: SelectedTrack[] = result.assets.map((asset) => ({
        name: asset.name,
        uri: asset.uri,
      }));

      playlist.setPlaylist(tracks);
      analysisCache.current.clear();

      setStatusMessage(`${tracks.length} morceaux importés`);
      setAnalysisMessage("Clique sur Analyser pour détecter les BPM");

      // Load first two tracks into decks
      await audioEngine.loadTrack(DECK_A, tracks[0].uri);
      if (tracks.length > 1) {
        await audioEngine.loadTrack(DECK_B, tracks[1].uri);
      }

      setActiveDeck(DECK_A);
      setIsPlaying(false);
      setCurrentPosition(0);
    } catch (err: any) {
      console.error('[AutoDJ] importTracks error:', err);
      setStatusMessage(`Erreur import: ${err.message || String(err)}`);
    }
  }, []);

  // --- Analysis ---

  const clearCache = useCallback(async () => {
    try {
      await clearAnalysisCache();
      analysisCache.current.clear();
      console.log("[AutoDJ] Cache cleared");
    } catch (err: any) {
      console.error('[AutoDJ] clearCache error:', err);
      setStatusMessage(`Erreur cache: ${err.message || String(err)}`);
    }
  }, []);

  const analyzeTrack = useCallback(async (track: SelectedTrack, force?: boolean): Promise<TrackAnalysis> => {
    // 1. Force reanalysis : skip cache
    if (force) {
      analysisCache.current.delete(track.uri);
      console.log(`[AutoDJ] Force analysis: ${track.name}`);
    }

    // 2. Check in-memory cache
    const memCached = analysisCache.current.get(track.uri);
    if (!force && memCached) {
      console.log(`[AutoDJ] Memory cache hit: ${track.name}`);
      return memCached;
    }

    // 3. Check persistent cache (filesystem) — skip if force
    if (!force) {
      const diskCached = await loadCachedAnalysis(track.name);
      if (diskCached) {
      const restored: TrackAnalysis = {
        bpm: diskCached.bpm,
        duration: diskCached.duration,
        beats: diskCached.beats,
        bars: diskCached.bars,
        sections: diskCached.sections as EnergySection[],
        drops: diskCached.drops as DropPoint[],
        buildups: diskCached.buildups as DropPoint[],
        energy: diskCached.energy,
        phrases: [],
        phraseData: null,
        cuePoints: null,
        key: diskCached.key,
        camelot: diskCached.camelot,
        beatGrid: null,
        rms: (diskCached as any).rms || [],
        timestamps: (diskCached as any).timestamps || [],
        genre: (diskCached as any).genre ?? "unknown",
        genreConfidence: (diskCached as any).genreConfidence ?? 0,
      };
      analysisCache.current.set(track.uri, restored);
      console.log(`[AnalysisCache] Restored from disk: ${track.name} | ${diskCached.bpm} BPM | ${diskCached.camelot}`);
      return restored;
      }
    }

    // 4. Try backend FIRST (single POST /analyze instead of 3 calls)
    let backendAnalysis: BackendTrackAnalysis | undefined;
    let bpm = 120;
    let duration = 0;
    let beats: number[] = [];
    let bars: number[] = [];
    let energyFinal: EnergyAnalysisResult;
    let phraseData: PhraseDetectionResult = { phrases: [], totalPhrases: 0, phraseLength: 8, downbeats: [], phraseStarts: [] };
    let cuePoints: CuePointSet = { cues: [], introCue: null, dropCues: [], outroCue: null, transitionOutCue: null, transitionInCue: null, emergencyCue: null };
    let beatGrid: BeatGrid | null = null;
    let keyResult = estimateKey(track.name, 120, 0.5, []);
    let genreResult = detectGenre(track.name, 120, 0.5);
    let drops = { drops: [] as DropPoint[], buildups: [] as DropPoint[] };

    try {
      // Cancel any previous in-flight backend analysis
      if (analysisAbortRef.current) {
        analysisAbortRef.current.abort();
      }
      const ctrl = new AbortController();
      analysisAbortRef.current = ctrl;
      const opts = { signal: ctrl.signal, timeoutMs: 30000, retries: 1 } as const;
      backendAnalysis = (await analyzeTrackBackend(track.uri, track.name, opts)) ?? undefined;
    } catch (e) {
      console.warn(`[Backend] Offline for ${track.name}`);
    }

    if (backendAnalysis) {
      // Use backend data directly — much faster, one upload only
      bpm = backendAnalysis.bpm || 120;
      duration = backendAnalysis.beats.length > 0
        ? backendAnalysis.beats[backendAnalysis.beats.length - 1] + 60 / bpm
        : 0;
      beats = backendAnalysis.beats || [];
      bars = backendAnalysis.bars || [];

      // Map backend energyCurve → local EnergyAnalysisResult
      const rms = backendAnalysis.energyCurve.map(p => p.rms);
      const timestamps = backendAnalysis.energyCurve.map(p => p.time);
      const sections = mapBackendSections(backendAnalysis.sections, backendAnalysis.energyCurve);
      energyFinal = {
        rms,
        spectralCentroid: rms.map(v => v * 8000),
        timestamps,
        sections,
      };

      keyResult = {
        key: backendAnalysis.key || "Cm",
        camelot: backendAnalysis.camelot || "5A",
        confidence: 0.8,
      };
      genreResult = detectGenre(track.name, bpm, 0.5); // keep local genre detection

      phraseData = detectPhrases(bars, beats, sections, rms, timestamps, bpm);
      cuePoints = generateCuePoints(duration, beats, bars, phraseData.phrases, [], [], sections);
      beatGrid = buildBeatGrid(bpm, duration, beats, bars, 4, phraseData, cuePoints);

      // Map backend drops/builds for detectDrops compatibility
      if (backendAnalysis.drops.length > 0) {
        const mappedDrops = backendAnalysis.drops.map(d => ({
          timestamp: d.timestamp,
          energyBefore: d.intensity * 0.7,
          energyAfter: d.intensity,
          type: "drop" as const,
        }));
        const mappedBuilds = backendAnalysis.builds.map(b => ({
          timestamp: b.start,
          energyBefore: 0.3,
          energyAfter: b.energyRise,
          type: "buildup" as const,
        }));
        drops.drops = mappedDrops;
        drops.buildups = mappedBuilds;
      }

      console.log(`[Backend] ${track.name}: ${bpm} BPM | key=${keyResult.key} | ${backendAnalysis.phrases.length} phrases | ${backendAnalysis.drops.length} drops`);
    } else {
      // Fallback: local analysis (separate /bpm + /energy calls)
      const bpmResult = await analyzeBpm(track.uri);
      const energyResult = await analyzeEnergy(track.uri);

      beats = (bpmResult as any)?.beats || [];
      bars = detectBars(beats).bars;
      energyFinal = energyResult || analyzeEnergyFallback(beats, bpmResult?.duration || 0);
      bpm = bpmResult?.bpm || 120;
      duration = bpmResult?.duration || 0;

      phraseData = detectPhrases(bars, beats, energyFinal.sections, energyFinal.rms, energyFinal.timestamps, bpm);
      cuePoints = generateCuePoints(duration, beats, bars, phraseData.phrases, [], [], energyFinal.sections);
      beatGrid = buildBeatGrid(bpm, duration, beats, bars, 4, phraseData, cuePoints);
      keyResult = estimateKey(track.name, bpm, 0.5, energyFinal.sections);
      genreResult = detectGenre(track.name, bpm, 0.5);

      console.log(`[Local] ${track.name}: ${bpm} BPM | key=${keyResult.key} | ${phraseData.totalPhrases} phrases`);
    }

    drops = detectDrops(energyFinal.sections, energyFinal.rms, energyFinal.timestamps);
    const avgEnergy = energyFinal.sections.length > 0
      ? energyFinal.sections.reduce((sum: number, s: any) => {
          return sum + (s.energyLevel === "high" || s.energyLevel === "explosive" ? 1.0 : s.energyLevel === "medium" ? 0.6 : 0.3);
        }, 0) / energyFinal.sections.length
      : 0.5;

    const analysis: TrackAnalysis = {
      bpm,
      duration,
      beats,
      bars,
      sections: energyFinal.sections,
      drops: drops.drops,
      buildups: drops.buildups,
      energy: avgEnergy,
      phrases: phraseData.phrases,
      phraseData,
      cuePoints,
      key: keyResult.key,
      camelot: keyResult.camelot,
      beatGrid,
      rms: energyFinal.rms || [],
      timestamps: energyFinal.timestamps || [],
      genre: genreResult.genre,
      genreConfidence: genreResult.confidence,
      backendAnalysis,
    };

    // 4. Save to both caches
    analysisCache.current.set(track.uri, analysis);
    await saveCachedAnalysis({
      version: 1,
      uri: track.uri,
      name: track.name,
      timestamp: Date.now(),
      bpm,
      duration,
      energy: avgEnergy,
      key: keyResult.key,
      camelot: keyResult.camelot,
      beats,
      bars,
      sections: energyFinal.sections,
      drops: drops.drops,
      buildups: drops.buildups,
      genre: genreResult.genre,
      genreConfidence: genreResult.confidence,
    });

    return analysis;
  }, []);

  const analyzeCurrentAndNext = useCallback(async () => {
    const current = playlist.currentTrack;
    const next = playlist.nextTrack;

    if (!current) {
      setAnalysisMessage("Aucun morceau à analyser");
      return;
    }

    setAnalysisMessage("Analyse en cours...");

    try {
      const [currentA, nextA] = await Promise.all([
        analyzeTrack(current),
        next ? analyzeTrack(next) : Promise.resolve(null),
      ]);

      setCurrentAnalysis(currentA);
      setNextAnalysis(nextA);

      const bpmInfo = `BPM: ${currentA.bpm}${nextA ? ` / ${nextA.bpm}` : ""}`;
      const sectionInfo = `Sections: ${currentA.sections.length}${nextA ? ` / ${nextA.sections.length}` : ""}`;
      const dropInfo = `Drops: ${currentA.drops.length}${nextA ? ` / ${nextA.drops.length}` : ""}`;

      setAnalysisMessage(`${bpmInfo} | ${sectionInfo} | ${dropInfo}`);
    } catch (error) {
      setAnalysisMessage("Erreur d'analyse: " + String(error));
    }
  }, [playlist.currentTrack, playlist.nextTrack, analyzeTrack]);

  const analyzeAllTracks = useCallback(async () => {
    try {
      if (playlist.tracks.length === 0) {
        setAnalysisMessage("Aucun morceau");
        return;
      }

      // Vider le cache pour forcer la réanalyse complète
      await clearAnalysisCache();
      analysisCache.current.clear();
      console.log("[AutoDJ] Cache cleared — full reanalysis starting");

      setAnalysisMessage(`Analyse de ${playlist.tracks.length} morceaux...`);

      // Parallel analysis with limited concurrency (2 at a time) for speed
      const POOL_SIZE = 2;
      const tracks = [...playlist.tracks];
      let completed = 0;

      async function worker() {
        while (tracks.length > 0) {
          const track = tracks.shift()!;
          setAnalysisMessage(`Analyse ${completed + 1}/${playlist.tracks.length}: ${track.name}`);
          await analyzeTrack(track, true); // force=true
          completed++;
        }
      }

      await Promise.all(Array.from({ length: POOL_SIZE }, worker));

      // Set current analysis
      if (playlist.currentTrack) {
        const current = analysisCache.current.get(playlist.currentTrack.uri);
        if (current) setCurrentAnalysis(current);
      }
      if (playlist.nextTrack) {
        const next = analysisCache.current.get(playlist.nextTrack.uri);
        if (next) setNextAnalysis(next);
      }

      setAnalysisMessage(`${playlist.tracks.length} morceaux analysés ✓`);
    } catch (err: any) {
      console.error('[AutoDJ] analyzeAllTracks error:', err);
      setAnalysisMessage(`Erreur analyse: ${err.message || String(err)}`);
    }
  }, [playlist.tracks, playlist.currentTrack, playlist.nextTrack, analyzeTrack]);

  // --- Lazy Background Analysis Queue ---
  const lazyQueueRef = useRef<SelectedTrack[]>([]);
  const isLazyAnalyzingRef = useRef(false);

  const scheduleLazyAnalysis = useCallback(() => {
    const pl = playlistRef.current;
    if (!pl.currentTrack || pl.tracks.length < 2) return;

    // Find current index in the actual tracks array
    const currentIdx = pl.tracks.findIndex(t => t.uri === pl.currentTrack?.uri);
    if (currentIdx < 0) return;

    // Lookahead window: current + next + 2 ahead
    const lookahead = [0, 1, 2, 3].map(offset => {
      const idx = (currentIdx + offset) % pl.tracks.length;
      return pl.tracks[idx];
    }).filter(Boolean);

    // Add unanalyzed tracks to lazy queue
    for (const track of lookahead) {
      if (!track) continue;
      if (analysisCache.current.has(track.uri)) continue;
      if (lazyQueueRef.current.some(t => t.uri === track.uri)) continue;
      lazyQueueRef.current.push(track);
    }

    // Start background processor if not running
    if (!isLazyAnalyzingRef.current) {
      processLazyQueue();
    }
  }, []);

  const processLazyQueue = async () => {
    if (isLazyAnalyzingRef.current) return;
    isLazyAnalyzingRef.current = true;

    while (lazyQueueRef.current.length > 0) {
      const track = lazyQueueRef.current.shift();
      if (!track) continue;
      if (analysisCache.current.has(track.uri)) continue;

      try {
        await analyzeTrack(track);
        // Small yield to avoid blocking
        await new Promise(r => setTimeout(r, 50));
      } catch (e) {
        console.warn(`[LazyAnalysis] Failed for ${track.name}:`, e);
      }
    }

    isLazyAnalyzingRef.current = false;
  };

  // --- Smart Playlist Ordering (BPM ascending) ---

  const smartOrderPlaylist = useCallback(() => {
    if (playlist.tracks.length < 2) {
      setStatusMessage("Playlist trop courte pour réordonner");
      return;
    }

    const tracksWithBpm = playlist.tracks.map((t) => {
      const analysis = analysisCache.current.get(t.uri);
      return {
        track: t,
        bpm: analysis?.bpm ?? 128,
      };
    });

    // Tri par BPM croissant (du plus petit au plus grand)
    tracksWithBpm.sort((a, b) => a.bpm - b.bpm);

    const orderedTracks = tracksWithBpm.map((t) => t.track);

    playlist.setPlaylist(orderedTracks);

    // Mettre à jour l'analyse courante
    if (orderedTracks[0]) {
      const firstAnalysis = analysisCache.current.get(orderedTracks[0].uri);
      if (firstAnalysis) {
        setCurrentAnalysis(firstAnalysis);
        currentAnalysisRef.current = firstAnalysis;
      }
    }

    const bpmList = tracksWithBpm.map((t) => t.bpm.toFixed(0)).join(" → ");
    setStatusMessage(`Tri BPM: ${bpmList}`);
  }, [playlist.tracks, playlist.setPlaylist]);

  // --- Playback Controls ---

  const play = useCallback(async () => {
    try {
      await audioEngine.play(activeDeck);
      setIsPlaying(true);
      setStatusMessage("Lecture en cours");
    } catch (err: any) {
      console.error('[AutoDJ] play error:', err);
      setStatusMessage(`Erreur lecture: ${err.message || String(err)}`);
    }
  }, [activeDeck]);

  const pause = useCallback(async () => {
    try {
      await audioEngine.pause(activeDeck);
      setIsPlaying(false);
      setStatusMessage("Pause");
    } catch (err: any) {
      console.error('[AutoDJ] pause error:', err);
      setStatusMessage(`Erreur pause: ${err.message || String(err)}`);
    }
  }, [activeDeck]);

  const togglePlayPause = useCallback(async () => {
    if (isPlaying) {
      await pause();
    } else {
      await play();
    }
  }, [isPlaying, play, pause]);

  const seekTo = useCallback(async (seconds: number) => {
    try {
      await audioEngine.seekTo(activeDeck, seconds);
      setCurrentPosition(seconds);
    } catch (err: any) {
      console.error('[AutoDJ] seekTo error:', err);
    }
  }, [activeDeck]);

  const seekForward = useCallback((seconds: number = 10) => {
    const livePos = audioEngine.getCurrentTime(activeDeckRef.current);
    const liveDur = audioEngine.getDuration(activeDeckRef.current);
    const newPos = Math.min(livePos + seconds, liveDur);
    seekTo(newPos);
  }, [seekTo]);

  const seekBackward = useCallback((seconds: number = 10) => {
    const livePos = audioEngine.getCurrentTime(activeDeckRef.current);
    const newPos = Math.max(livePos - seconds, 0);
    seekTo(newPos);
  }, [seekTo]);

  const stop = useCallback(async () => {
    try {
      transitionEngine.abort();
      audioEngine.stopAll();
      setIsPlaying(false);
      setCurrentPosition(0);
      isTransitioningRef.current = false;
      waitingForMusicalGateRef.current = false;
      nextMusicalMomentRef.current = null;
      setStatusMessage("Arrêté");
    } catch (err: any) {
      console.error('[AutoDJ] stop error:', err);
      setStatusMessage(`Erreur arrêt: ${err.message || String(err)}`);
    }
  }, []);

  // --- Smart Transition (core) ---

  /**
   * Déclenche une transition intelligente automatiquement.
   * Appelé par le position tracker quand on atteint le point optimal.
   */
  const triggerSmartTransition = async () => {
    try {
    if (isTransitioningRef.current) return;

    const pl = playlistRef.current;
    const fromAnalysis = currentAnalysisRef.current;
    const toAnalysis = nextAnalysisRef.current;
    const nextTrk = pl.nextTrack;

    if (!nextTrk) {
      // Fin de playlist — skip si repeat
      if (pl.repeat && pl.tracks.length > 0) {
        pl.goToIndex(0);
      } else {
        setIsPlaying(false);
        setStatusMessage("Fin de la playlist");
      }
      return;
    }

    isTransitioningRef.current = true;
    const fromDeck = activeDeckRef.current;
    const toDeck = fromDeck === DECK_A ? DECK_B : DECK_A;

    console.log(`[AutoDJ] Starting smart transition: ${pl.currentTrack?.name} → ${nextTrk.name}`);

    // Charger le prochain morceau
    await audioEngine.loadTrack(toDeck, nextTrk.uri);

    let matchedRateB = 1.0; // rate appliqué à B pour matcher A
    let smartPlan: SmartMixPlan | null = null;

    if (fromAnalysis && toAnalysis && pl.currentTrack) {
      let outPoint = autoTransitionPointRef.current ?? computeTransitionPoint(fromAnalysis);
      let seekPos = computeEntryPoint(toAnalysis);

      // --- SMART MIX ENGINE : backend-driven transition plan ---
      if (fromAnalysis.backendAnalysis && toAnalysis.backendAnalysis) {
        const ctx: MixEngineContext = {
          analysisA: fromAnalysis.backendAnalysis,
          analysisB: toAnalysis.backendAnalysis,
          currentTime: outPoint,
          genreA: fromAnalysis.genre,
          genreB: toAnalysis.genre,
        };
        smartPlan = smartMixEngine.computePlan(ctx);

        if (smartPlan) {
          outPoint = smartPlan.candidate.outPoint;
          seekPos = smartPlan.candidate.inPoint;

          // --- HUMAN DJ GUARD ---
          // Le moteur d'intention a-t-il approuvé cette transition ?
          if (smartPlan.shouldTransition === false) {
            console.log(
              `[AutoDJ] 🛑 Transition REFUSÉE | ${smartPlan.humanReason} | ` +
              `score=${((smartPlan.intentScore ?? 0) * 100).toFixed(0)}% | ` +
              `action=${smartPlan.alternativeAction} | wait=${smartPlan.waitDuration?.toFixed(1)}s`
            );

            // Abandonner cette transition pour l'instant
            isTransitioningRef.current = false;
            autoTransitionTriggeredRef.current = false;
            waitingForMusicalGateRef.current = true;

            // Avancer le point de transition pour éviter de réessayer
            // immédiatement au même endroit
            const waitSec = smartPlan.waitDuration ?? 4;
            const currentPos = audioEngine.getCurrentTime(fromDeck) ?? outPoint;
            const newPoint = Math.max(currentPos, outPoint) + waitSec;
            autoTransitionPointRef.current = newPoint;
            setTransitionPoint(newPoint);
            console.log(`[AutoDJ] Transition point avancé à ${newPoint.toFixed(1)}s (wait ${waitSec}s)`);

            // Nettoyer le loop s'il existe (pour permettre à la track d'avancer)
            if (audioEngine.isLooping(fromDeck)) {
              audioEngine.clearLoop(fromDeck);
              console.log(`[AutoDJ] Loop nettoyée sur ${fromDeck}`);
            }

            // Alternative actions
            if (smartPlan.alternativeAction === "loop" && pl.currentTrack) {
              // Loop la fin de la phrase actuelle
              const beatDur = 60 / fromAnalysis.bpm;
              const loopEnd = outPoint + beatDur * 4;
              const loopStart = Math.max(0, outPoint - beatDur * 4);
              audioEngine.setLoop(fromDeck, loopStart, loopEnd);
              console.log(`[AutoDJ] Loop activée: ${loopStart.toFixed(1)}s-${loopEnd.toFixed(1)}s`);
              setStatusMessage(`⏳ ${smartPlan.humanReason}`);
            } else if (smartPlan.alternativeAction === "build_tension") {
              setStatusMessage(`🔥 Préparation tension...`);
            } else {
              setStatusMessage(`⏳ ${smartPlan.humanReason}`);
            }

            // Le musical gate va refire automatiquement
            return;
          }

          console.log(
            `[SmartMix] Plan computed: ${smartPlan.candidate.type} | ` +
            `out=${outPoint.toFixed(2)}s in=${seekPos.toFixed(2)}s | ` +
            `score=${(smartPlan.candidate.score * 100).toFixed(0)}% | ` +
            `reason=${smartPlan.candidate.reason} | ` +
            `phrase=${smartPlan.candidate.phraseAligned} downbeat=${smartPlan.candidate.downbeatAligned}`
          );
          if (smartPlan.bassSwap.active) {
            console.log(`[SmartMix] Bass swap planned: ${smartPlan.bassSwap.startTime.toFixed(2)}s-${smartPlan.bassSwap.endTime.toFixed(2)}s`);
          }
          if (smartPlan.vocalBlend.active) {
            console.log(`[SmartMix] Vocal blend: ${smartPlan.vocalBlend.reason}`);
          }
          if (smartPlan.dropPrep.dropIncoming) {
            console.log(`[SmartMix] Drop prep: ${smartPlan.dropPrep.fxSequence.join(", ")} | tension=${(smartPlan.dropPrep.tensionLevel * 100).toFixed(0)}%`);
          }
        }
      }

      // --- SMART TRANSITION TIMING ---
      // Calcule le moment musical optimal pour déclencher le mix
      const timing = fromAnalysis.beatGrid && toAnalysis.beatGrid
        ? computeTransitionTiming(fromAnalysis.beatGrid, toAnalysis.beatGrid, outPoint, outPoint)
        : null;

      // --- BEAT ALIGNMENT ENGINE ---
      // Aligne B sur A avec drift correction
      const alignment = fromAnalysis.beatGrid && toAnalysis.beatGrid
        ? alignTracks({
            gridA: fromAnalysis.beatGrid,
            gridB: toAnalysis.beatGrid,
            outPointA: timing?.outPoint ?? outPoint,
            desiredOverlapBars: timing?.overlapBars ?? 8,
          })
        : null;

      // Démarrer deck B en silence d'abord (seek plus fiable sur player actif)
      const rawSeek = alignment?.seekPosition ?? seekPos;
      seekPos = Math.max(30, rawSeek); // jamais avant 30s
      audioEngine.setVolume(toDeck, 0);
      await audioEngine.play(toDeck);
      await new Promise((r) => setTimeout(r, 100));

      if (seekPos > 0) {
        await audioEngine.seekTo(toDeck, seekPos);
        console.log(`[AutoDJ] Seeked deck ${toDeck} to ${seekPos.toFixed(1)}s`);
      }

      console.log(
        `[AutoDJ] Alignment: method=${alignment?.method ?? "fallback"}` +
        ` | seek=${seekPos.toFixed(1)}s` +
        ` | phrase=${alignment?.phraseAligned ?? false}` +
        ` | downbeat=${alignment?.downbeatAligned ?? false}` +
        ` | confidence=${(alignment?.confidence ?? 0.3).toFixed(2)}`
      );

      if (timing) {
        console.log(
          `[AutoDJ] Timing: method=${timing.method}` +
          ` | trigger=${timing.triggerTime.toFixed(1)}s` +
          ` | out=${timing.outPoint.toFixed(1)}s` +
          ` | overlap=${timing.overlapBars} bars`
        );
      }

      // --- TRANSITION STYLE ---
      const fromPT = toPlaylistTrack(fromAnalysis, pl.currentTrack);
      const toPT = toPlaylistTrack(toAnalysis, nextTrk);
      const selection = transitionSelector.selectPreset(
        fromPT, toPT, timing?.outPoint ?? outPoint, seekPos
      );

      const preset = selection.presetName;
      const seed = selection.seed;

      // --- GENRE ADAPTIVE MIXING ---
      const fromProfile = getMixProfile(fromAnalysis.genre);
      const toProfile = getMixProfile(toAnalysis.genre);
      const mergedProfile = mergeProfiles(fromAnalysis.genre, toAnalysis.genre);

      console.log(
        `[AutoDJ] Genre: ${fromAnalysis.genre} (${(fromAnalysis.genreConfidence * 100).toFixed(0)}%) → ${toAnalysis.genre} (${(toAnalysis.genreConfidence * 100).toFixed(0)}%) | Style: ${fromProfile.label}→${toProfile.label}`
      );

      // Mettre à jour les infos de compatibilité et preset
      const presetInfo = PRESETS[preset];
      setSelectedPreset({
        name: preset,
        label: presetInfo?.label ?? preset,
        confidence: selection.confidence,
      });
      setCompatibilityScores(selection.scores ?? {});

      console.log(
        `[AutoDJ] Preset: ${preset} | Confidence: ${(selection.confidence * 100).toFixed(0)}%`
      );
      setStatusMessage(
        `${presetInfo?.label ?? preset} | ${fromProfile.label}→${toProfile.label} | ${fromAnalysis.bpm}→${toAnalysis.bpm} BPM`
      );

      // --- BPM MATCHING ---
      const bpmA = fromAnalysis.bpm;
      const bpmB = toAnalysis.bpm;
      matchedRateB = bpmA / bpmB; // rate pour que B joue au BPM de A
      const rateA = bpmB / bpmA; // rate pour que A joue au BPM de B

      // Deck B démarre au rate qui match A (inaudible car volume=0)
      audioEngine.setRate(toDeck, matchedRateB);
      console.log(`[AutoDJ] Rate matching: deck ${toDeck} rate=${matchedRateB.toFixed(3)} (${bpmB}→${bpmA} BPM)`);

      // Stocker pour le ramp post-transition
      const postRampDuration = Math.min(8000, Math.max(3000, Math.abs(matchedRateB - 1.0) * 15000));
      console.log(`[AutoDJ] Post-transition ramp duration: ${postRampDuration}ms`);

      // --- BUFFER POUR DECK B ---
      // Petit délai pour laisser le deck B bien démarrer avant le mix
      await new Promise((r) => setTimeout(r, 300));

      // --- RATE MORPH CONFIG ---
      // Sur les presets smooth/ethereal, commencer le retour au BPM natif
      // DÉJÀ pendant la transition pour un morphing continu
      const presetFeel = PRESETS[preset]?.feel ?? "smooth";
      const shouldMorphDuringTransition = presetFeel === "smooth" || presetFeel === "ethereal";
      const rateMorph: RateMorphConfig | undefined = shouldMorphDuringTransition
        ? { deckB: { from: matchedRateB, to: 1.0, startAt: 0.55 } }
        : undefined;

      // --- EXECUTE PRESET ---
      await transitionEngine.executePreset(preset, fromDeck, toDeck, seed, rateMorph);
    } else {
      // Fallback : crossfade simple 8s
      console.log(`[AutoDJ] Fallback crossfade (no analysis)`);
      setStatusMessage("Crossfade auto");

      // Seek basique
      if (toAnalysis) {
        const entryPoint = Math.max(30, computeEntryPoint(toAnalysis));
        if (entryPoint > 0) await audioEngine.seekTo(toDeck, entryPoint);
      }

      await transitionEngine.executeCrossfade(fromDeck, toDeck, 8000);
    }

    // Transition terminée
    isTransitioningRef.current = false;

    // Record in anti-repetition history
    if (smartPlan) {
      smartMixEngine.recordTransition(
        smartPlan.candidate.type,
        smartPlan.candidate.outPoint,
        smartPlan.candidate.inPoint
      );
    }

    // --- SMOOTH BPM RAMP (post-transition) ---
    // Si le morph n'a pas déjà ramené B à 1.0 pendant la transition,
    // on finit le travail avec un ramp progressif
    const currentRateB = audioEngine.getRate(toDeck);
    const rateDiff = Math.abs(currentRateB - 1.0);
    if (rateDiff > 0.02) {
      cancelRateRampRef.current?.();
      const rampDuration = Math.min(8000, Math.max(2000, rateDiff * 15000));
      cancelRateRampRef.current = audioEngine.rampRate(toDeck, currentRateB, 1.0, rampDuration);
      console.log(`[AutoDJ] Post-ramp: deck ${toDeck} ${currentRateB.toFixed(3)}→1.0 over ${rampDuration}ms`);
    } else {
      console.log(`[AutoDJ] Deck ${toDeck} already at native rate, skipping post-ramp`);
    }

    // Reset A immédiatement (il est déjà stoppé)
    audioEngine.setRate(fromDeck, 1.0);

    // Swap active deck ref immediately
    activeDeckRef.current = toDeck;
    setActiveDeck(toDeck);

    // Avancer dans la playlist
    const newTrack = pl.goToNext();
    if (newTrack) {
      const newAnalysis = analysisCache.current.get(newTrack.uri) ?? null;
      if (newAnalysis) {
        setCurrentAnalysis(newAnalysis);
        currentAnalysisRef.current = newAnalysis;
      }

      setStatusMessage(`Now playing: ${newTrack.name}`);

      // Trouver le morceau qui suit newTrack dans la playlist
      // Comme setCurrentIndex est async, on calcule manuellement
      const newTrackIdx = pl.tracks.findIndex(t => t.uri === newTrack.uri);
      const afterNextIdx = newTrackIdx >= 0 ? (newTrackIdx + 1) % pl.tracks.length : -1;
      const afterNextTrack = afterNextIdx >= 0 && afterNextIdx !== newTrackIdx
        ? pl.tracks[afterNextIdx]
        : null;

      await setupNextTransitionFor(afterNextTrack, newAnalysis);
    } else {
      setIsPlaying(false);
      setStatusMessage("Fin de la playlist");
    }
    } catch (err: any) {
      console.error('[AutoDJ] Transition error:', err);
      isTransitioningRef.current = false;
      autoTransitionTriggeredRef.current = false;
      setStatusMessage('Transition error');
    }
  };

  // Keep ref updated every render
  triggerSmartTransitionRef.current = triggerSmartTransition;

  /**
   * Prépare la prochaine transition.
   * @param upcomingTrack - le morceau qui va jouer après le courant (calculé par l'appelant)
   * @param currentAnalysisOverride - analyse du morceau actuellement en lecture
   */
  const setupNextTransitionFor = async (
    upcomingTrack?: SelectedTrack | null,
    currentAnalysisOverride?: TrackAnalysis | null,
  ) => {
    try {
      autoTransitionTriggeredRef.current = false;
      autoTransitionPointRef.current = null;
      setTransitionPoint(null);

      // Trouver le prochain morceau : soit fourni, soit depuis le state playlist
      const pl = playlistRef.current;
      const nextTrk = upcomingTrack ?? pl.nextTrack;
      if (!nextTrk) {
        setNextAnalysis(null);
        console.log(`[AutoDJ] No next track — end of playlist`);
        return;
      }

      const toDeck = activeDeckRef.current === DECK_A ? DECK_B : DECK_A;

      // Analyser le prochain morceau
      console.log(`[AutoDJ] Analyzing next: ${nextTrk.name}`);
      const analysis = await analyzeTrack(nextTrk);
      setNextAnalysis(analysis);
      nextAnalysisRef.current = analysis;

      // Preload dans l'autre deck
      await audioEngine.loadTrack(toDeck, nextTrk.uri);

      // Start lazy analysis for upcoming tracks
      scheduleLazyAnalysis();

      // Calculer le point de transition pour le morceau qui joue MAINTENANT
      const curAnalysis = currentAnalysisOverride ?? currentAnalysisRef.current;
      if (curAnalysis && curAnalysis.duration > 0) {
        const point = computeTransitionPoint(curAnalysis);
        autoTransitionPointRef.current = point;
        setTransitionPoint(point);
        console.log(`[AutoDJ] Transition point set at ${point.toFixed(1)}s / ${curAnalysis.duration.toFixed(1)}s`);
      } else {
        // Fallback : utiliser la durée du deck actuel - 40s, mais jamais avant 30s
        const dur = audioEngine.getDuration(activeDeckRef.current);
        if (dur > 0) {
          const minAfterStart = 30;
          const minBeforeEnd = 40;
          let point: number;
          if (dur < minAfterStart + minBeforeEnd) {
            point = Math.min(minAfterStart, dur * 0.5);
          } else {
            point = Math.max(minAfterStart, dur - minBeforeEnd);
          }
          autoTransitionPointRef.current = point;
          setTransitionPoint(point);
          console.log(`[AutoDJ] Fallback transition point: ${point.toFixed(1)}s`);
        } else {
          // Attendre que la durée soit disponible, reessayer dans 2s
          setTimeout(() => {
            const d = audioEngine.getDuration(activeDeckRef.current);
            if (d > 0 && autoTransitionPointRef.current === null) {
              const minAfterStart = 30;
              const minBeforeEnd = 40;
              let pt: number;
              if (d < minAfterStart + minBeforeEnd) {
                pt = Math.min(minAfterStart, d * 0.5);
              } else {
                pt = Math.max(minAfterStart, d - minBeforeEnd);
              }
              autoTransitionPointRef.current = pt;
              setTransitionPoint(pt);
              console.log(`[AutoDJ] Deferred transition point: ${pt.toFixed(1)}s`);
            }
          }, 2000);
        }
      }
    } catch (err: any) {
      console.error('[AutoDJ] setupNextTransitionFor error:', err);
      setStatusMessage(`Erreur préparation: ${err.message || String(err)}`);
    }
  };

  // Alias sans arguments pour les appels depuis startPlayback/skip
  const setupNextTransition = () => setupNextTransitionFor();

  const startTransition = useCallback(async () => {
    try {
      await triggerSmartTransitionRef.current();
    } catch (err: any) {
      console.error('[AutoDJ] Manual transition error:', err);
    }
  }, []);

  const preloadNext = useCallback(async () => {
    try {
      if (!playlist.nextTrack) return;

      const toDeck = activeDeck === DECK_A ? DECK_B : DECK_A;
      await audioEngine.loadTrack(toDeck, playlist.nextTrack.uri);

      const analysis = await analyzeTrack(playlist.nextTrack);
      setNextAnalysis(analysis);
    } catch (err: any) {
      console.error('[AutoDJ] preloadNext error:', err);
    }
  }, [activeDeck, playlist.nextTrack, analyzeTrack]);

  // --- Skip ---

  const skipToNext = useCallback(async () => {
    try {
      if (!playlist.canGoNext) return;

      cancelRateRampRef.current?.();
      transitionEngine.abort();
      isTransitioningRef.current = false;
      autoTransitionTriggeredRef.current = false;
      waitingForMusicalGateRef.current = false;
      nextMusicalMomentRef.current = null;

      const fromDeck = activeDeckRef.current;
      const toDeck = fromDeck === DECK_A ? DECK_B : DECK_A;

      const nextTrack = playlist.goToNext();
      if (!nextTrack) return;

      await audioEngine.stop(fromDeck);
      await audioEngine.loadTrack(toDeck, nextTrack.uri);

      audioEngine.setVolume(toDeck, 1.0);
      await audioEngine.play(toDeck);

      activeDeckRef.current = toDeck;
      setActiveDeck(toDeck);
      setIsPlaying(true);
      setCurrentPosition(0);

      // Update analysis
      const nextAnalysis = analysisCache.current.get(nextTrack.uri);
      if (nextAnalysis) setCurrentAnalysis(nextAnalysis);
      else {
        (async () => {
          try {
            const a = await analyzeTrack(nextTrack);
            setCurrentAnalysis(a);
          } catch (err: any) {
            console.error('[AutoDJ] Failed to analyze next track:', err);
          }
        })();
      }

      // Setup auto-transition pour le nouveau morceau
      await setupNextTransition();

      setStatusMessage(`Now playing: ${nextTrack.name}`);
    } catch (err: any) {
      console.error('[AutoDJ] skipToNext error:', err);
      setStatusMessage(`Erreur skip: ${err.message || String(err)}`);
    }
  }, [playlist, analyzeTrack]);

  const skipToPrevious = useCallback(async () => {
    try {
      if (!playlist.canGoPrevious) return;

      cancelRateRampRef.current?.();
      transitionEngine.abort();
      isTransitioningRef.current = false;
      autoTransitionTriggeredRef.current = false;
      waitingForMusicalGateRef.current = false;
      nextMusicalMomentRef.current = null;

      const fromDeck = activeDeckRef.current;
      const toDeck = fromDeck === DECK_A ? DECK_B : DECK_A;

      const prevTrack = playlist.goToPrevious();
      if (!prevTrack) return;

      await audioEngine.stop(fromDeck);
      await audioEngine.loadTrack(toDeck, prevTrack.uri);

      audioEngine.setVolume(toDeck, 1.0);
      await audioEngine.play(toDeck);

      activeDeckRef.current = toDeck;
      setActiveDeck(toDeck);
      setIsPlaying(true);
      setCurrentPosition(0);

      const prevAnalysis = analysisCache.current.get(prevTrack.uri);
      if (prevAnalysis) setCurrentAnalysis(prevAnalysis);

      await setupNextTransition();
      setStatusMessage(`Now playing: ${prevTrack.name}`);
    } catch (err: any) {
      console.error('[AutoDJ] skipToPrevious error:', err);
      setStatusMessage(`Erreur skip: ${err.message || String(err)}`);
    }
  }, [playlist, analyzeTrack]);

  const jumpToTrack = useCallback(async (index: number) => {
    try {
      if (index < 0 || index >= playlist.tracks.length) return;

      cancelRateRampRef.current?.();
      transitionEngine.abort();
      isTransitioningRef.current = false;
      autoTransitionTriggeredRef.current = false;
      waitingForMusicalGateRef.current = false;
      nextMusicalMomentRef.current = null;

      const fromDeck = activeDeckRef.current;
      const toDeck = fromDeck === DECK_A ? DECK_B : DECK_A;

      const track = playlist.goToIndex(index);
      if (!track) return;

      await audioEngine.stop(fromDeck);
      await audioEngine.loadTrack(toDeck, track.uri);

      audioEngine.setVolume(toDeck, 1.0);
      await audioEngine.play(toDeck);

      activeDeckRef.current = toDeck;
      setActiveDeck(toDeck);
      setIsPlaying(true);
      setCurrentPosition(0);

      const trackAnalysis = analysisCache.current.get(track.uri);
      if (trackAnalysis) setCurrentAnalysis(trackAnalysis);
      else {
        (async () => {
          try {
            const a = await analyzeTrack(track);
            setCurrentAnalysis(a);
          } catch (err: any) {
            console.error('[AutoDJ] Failed to analyze track:', err);
          }
        })();
      }

      await setupNextTransition();
      setStatusMessage(`Now playing: ${track.name}`);
    } catch (err: any) {
      console.error('[AutoDJ] jumpToTrack error:', err);
      setStatusMessage(`Erreur jump: ${err.message || String(err)}`);
    }
  }, [playlist, analyzeTrack]);

  // --- Start Playback (initial) ---

  const startPlayback = useCallback(async () => {
    try {
      if (!playlist.currentTrack) {
        setStatusMessage("Importe des morceaux d'abord");
        return;
      }

      setStatusMessage("Analyse des morceaux...");

      // Analyse le morceau courant
      const curAnalysis = await analyzeTrack(playlist.currentTrack);
      setCurrentAnalysis(curAnalysis);
      currentAnalysisRef.current = curAnalysis;

      audioEngine.setVolume(activeDeck, 1.0);
      await audioEngine.play(activeDeck);
      setIsPlaying(true);
      setStatusMessage(`Now playing: ${playlist.currentTrack.name} | BPM: ${curAnalysis.bpm}`);

      // Set un point de transition fallback immédiat basé sur l'analyse courante
      if (curAnalysis && curAnalysis.duration > 0) {
        const fallbackPoint = computeTransitionPoint(curAnalysis);
        autoTransitionPointRef.current = fallbackPoint;
        setTransitionPoint(fallbackPoint);
        console.log(`[AutoDJ] Initial transition point: ${fallbackPoint.toFixed(1)}s`);
      }

      // Prépare la prochaine transition (analyse next + recalcule le point si meilleur)
      await setupNextTransition();
    } catch (err: any) {
      console.error('[AutoDJ] startPlayback error:', err);
      setStatusMessage(`Erreur lecture: ${err.message || String(err)}`);
    }
  }, [activeDeck, playlist.currentTrack, playlist.nextTrack, analyzeTrack]);

  // --- Cleanup ---
  useEffect(() => {
    return () => {
      audioEngine.stopAll();
      transitionEngine.abort();
    };
  }, []);

  // --- Loop Actions ---
  const setLoop = useCallback((beats: number) => {
    const deckId = activeDeckRef.current;
    const analysis = currentAnalysisRef.current;
    if (!analysis || analysis.bpm <= 0) return;

    const bpm = analysis.bpm;
    const currentPos = audioEngine.getCurrentTime(deckId);
    const beatDuration = 60 / bpm;
    const loopDuration = beats * beatDuration;

    // Arrondir au beat le plus proche
    const currentBeat = Math.round(currentPos / beatDuration);
    const loopStart = currentBeat * beatDuration;
    const loopEnd = loopStart + loopDuration;

    audioEngine.setLoop(deckId, loopStart, loopEnd);
    setIsLooping(true);
    setLoopBeats(beats);
    console.log(`[AutoDJ] Loop ${beats} beats | ${loopStart.toFixed(2)}s - ${loopEnd.toFixed(2)}s`);
  }, []);

  const clearLoop = useCallback(() => {
    audioEngine.clearLoop(activeDeckRef.current);
    setIsLooping(false);
  }, []);

  const getTrackAnalysis = useCallback((uri: string): TrackAnalysis | null => {
    return analysisCache.current.get(uri) ?? null;
  }, []);

  return {
    // Playlist
    ...playlist,

    // Analysis
    currentAnalysis,
    nextAnalysis,
    analysisMessage,

    // Playback
    isPlaying,
    currentPosition,
    currentDuration,
    activeDeck,

    // Transition
    transitionState,
    isTransitioning: transitionState.state === "executing",
    transitionPoint,

    // Compatibility & Preset
    selectedPreset,
    compatibilityScores,

    // Smart Mix UI Feedback
    smartMixState,

    // Loop
    isLooping,
    loopBeats,

    // Messages
    statusMessage,

    // Actions
    importTracks,
    analyzeTrack,
    clearCache,
    analyzeCurrentAndNext,
    analyzeAllTracks,
    smartOrderPlaylist,
    startPlayback,
    play,
    pause,
    togglePlayPause,
    seekTo,
    seekForward,
    seekBackward,
    stop,
    startTransition,
    skipToNext,
    skipToPrevious,
    jumpToTrack,
    setLoop,
    clearLoop,
    getTrackAnalysis,
  };
};
