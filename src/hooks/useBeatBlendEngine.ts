import * as DocumentPicker from "expo-document-picker";
import { useEffect, useRef, useState } from "react";

import { detectBars } from "../services/analysis/barDetectionService";
import { analyzeBpm } from "../services/analysis/bpmDetectionService";
import { detectDrops } from "../services/analysis/dropDetectionService";
import { analyzeEnergy, analyzeEnergyFallback } from "../services/analysis/energyAnalysisService";
import { computeTempoSync } from "../services/analysis/tempoSyncService";
import { playlistManager } from "../services/playlist/playlistManager";
import { transitionEngine } from "../services/transition/transitionEngine";

import type { SelectedTrack } from "../types/audio";
import type {
    DropPoint,
    EnergySection,
    TransitionPlan,
} from "../types/audioAnalysis";

import {
    loadTracks,
    playTrackA,
    playTrackB,
    setVolumeA,
    setVolumeB,
    stopTrackA,
    stopTracks
} from "../services/audio/playbackService";

export const useBeatBlendEngine = () => {
  const [trackA, setTrackA] =
    useState<SelectedTrack | null>(null);

  const [trackB, setTrackB] =
    useState<SelectedTrack | null>(null);

  const [playlist, setPlaylist] = useState<SelectedTrack[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
  const [nextTrackIndex, setNextTrackIndex] = useState<number>(1);
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [repeat, setRepeat] = useState<boolean>(false);
  const [shuffle, setShuffle] = useState<boolean>(false);
  const [shuffledPlaylist, setShuffledPlaylist] = useState<SelectedTrack[]>([]);

  // State pour le morceau actuel affiché dans l'UI (synchronisé avec l'audio)
  const [displayedTrack, setDisplayedTrack] = useState<SelectedTrack | null>(null);
  const [displayedNextTrack, setDisplayedNextTrack] = useState<SelectedTrack | null>(null);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [transitionProgress, setTransitionProgress] = useState<number>(0);

  const [importMessage, setImportMessage] = useState(
    "Choisis 2 fichiers MP3"
  );

  const [bpmA, setBpmA] =
    useState<number | null>(null);

  const [bpmB, setBpmB] =
    useState<number | null>(null);

  const [durationA, setDurationA] =
    useState<number | null>(null);

  const [durationB, setDurationB] =
    useState<number | null>(null);

  // États pour l'analyse avancée
  const [beatsA, setBeatsA] = useState<number[]>([]);
  const [beatsB, setBeatsB] = useState<number[]>([]);
  const [barsA, setBarsA] = useState<number[]>([]);
  const [barsB, setBarsB] = useState<number[]>([]);
  const [energySectionsA, setEnergySectionsA] = useState<EnergySection[]>([]);
  const [energySectionsB, setEnergySectionsB] = useState<EnergySection[]>([]);
  const [dropsA, setDropsA] = useState<DropPoint[]>([]);
  const [dropsB, setDropsB] = useState<DropPoint[]>([]);
  const [transitionPlan, setTransitionPlan] = useState<TransitionPlan | null>(null);

  const [bpmMessage, setBpmMessage] = useState(
    "Clique sur analyser pour detecter les BPM"
  );

  const [targetBpm, setTargetBpm] =
    useState<number | null>(null);

  const [playbackRateA, setPlaybackRateA] =
    useState<number | null>(null);

  const [playbackRateB, setPlaybackRateB] =
    useState<number | null>(null);

  const [syncMessage, setSyncMessage] = useState(
    "Analyse les BPM avant de synchroniser"
  );

  const [crossfadeMs] = useState(8000);
  const [tempoTransitionMs] = useState(4000); // Durée de la transition de tempo
  const [transitionWindowMs] = useState(30000); // Fenêtre de transition totale (30s avant la fin)

  const [playbackMessage, setPlaybackMessage] =
    useState("Pret pour la lecture");

  const [isPlaying, setIsPlaying] =
    useState(false);

  const [currentPosition, setCurrentPosition] =
    useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer pour mettre à jour la position de lecture
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setCurrentPosition((prev) => {
          const newPos = prev + 0.1;

          // Transition automatique quand on approche de la fin
          if (autoplay && durationA && newPos >= durationA - transitionWindowMs / 1000) {
            skipToNext();
          }

          // Arrêter le timer si on dépasse la durée de A
          if (durationA && newPos >= durationA) {
            return durationA;
          }
          return newPos;
        });
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isPlaying, durationA, autoplay, transitionWindowMs]);

  // Fonction d'interpolation ease-in-out pour le tempo
  const easeInOutCubic = (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  const pickMp3Files = async () => {
    const result =
      await DocumentPicker.getDocumentAsync({
        type: "audio/mpeg",
        multiple: true,
        copyToCacheDirectory: true,
      });

    if (result.canceled) {
      setImportMessage("Selection annulee");
      return;
    }

    if (result.assets.length < 2) {
      setImportMessage(
        "Selectionne au moins 2 fichiers MP3"
      );

      return;
    }

    // Créer la playlist
    const tracks: SelectedTrack[] = result.assets.map((asset) => ({
      name: asset.name,
      uri: asset.uri,
    }));

    setPlaylist(tracks);
    setShuffledPlaylist([...tracks]);

    // Réinitialiser les indices
    setCurrentTrackIndex(0);
    setNextTrackIndex(1);

    // Définir trackA et trackB comme les deux premiers morceaux
    setTrackA(tracks[0]);
    setTrackB(tracks[1]);

    // Mettre à jour les morceaux affichés dans l'UI
    setDisplayedTrack(tracks[0]);
    setDisplayedNextTrack(tracks[1]);

    setBpmA(null);
    setBpmB(null);
    setDurationA(null);
    setDurationB(null);

    setTargetBpm(null);

    setPlaybackRateA(null);
    setPlaybackRateB(null);

    setImportMessage(
      `${tracks.length} fichiers importes avec succes`
    );

    setBpmMessage(
      "Clique sur analyser pour detecter les BPM"
    );

    setSyncMessage(
      "Analyse les BPM avant de synchroniser"
    );

    setPlaybackMessage(
      "Pret pour la lecture"
    );

    setIsPlaying(false);

    await stopTracks();

    // Charger les deux premiers morceaux
    await loadTracks(
      tracks[0].uri,
      tracks[1].uri
    );
  };

  const analyzeBpms = async () => {
    if (!trackA || !trackB) {
      setBpmMessage(
        "Importe d'abord deux fichiers MP3"
      );

      return;
    }

    setBpmMessage(
      "Analyse BPM et structure en cours..."
    );

    const [bpmAResult, bpmBResult] =
      await Promise.all([
        analyzeBpm(trackA.uri),
        analyzeBpm(trackB.uri),
      ]);

    setBpmA(bpmAResult?.bpm || null);
    setBpmB(bpmBResult?.bpm || null);
    setDurationA(bpmAResult?.duration || null);
    setDurationB(bpmBResult?.duration || null);

    // Récupérer les beats (si disponibles depuis le backend)
    const beatsA = (bpmAResult as any)?.beats || [];
    const beatsB = (bpmBResult as any)?.beats || [];
    setBeatsA(beatsA);
    setBeatsB(beatsB);

    // Détecter les mesures
    const barsA = detectBars(beatsA).bars;
    const barsB = detectBars(beatsB).bars;
    setBarsA(barsA);
    setBarsB(barsB);

    // Analyse d'énergie
    const energyA = await analyzeEnergy(trackA.uri);
    const energyB = await analyzeEnergy(trackB.uri);

    // Fallback si l'analyse d'énergie échoue
    const energyAFinal = energyA || analyzeEnergyFallback(beatsA, bpmAResult?.duration || 0);
    const energyBFinal = energyB || analyzeEnergyFallback(beatsB, bpmBResult?.duration || 0);

    setEnergySectionsA(energyAFinal.sections);
    setEnergySectionsB(energyBFinal.sections);

    // Détecter les drops
    const dropsA = detectDrops(energyAFinal.sections, energyAFinal.rms, energyAFinal.timestamps);
    const dropsB = detectDrops(energyBFinal.sections, energyBFinal.rms, energyBFinal.timestamps);
    setDropsA(dropsA.drops);
    setDropsB(dropsB.drops);

    // Calculer le plan de transition optimal
    if (bpmAResult && bpmBResult && bpmAResult.duration && bpmBResult.duration) {
      const plan = transitionEngine.calculateTransitionPlan(
        bpmAResult.duration,
        bpmBResult.duration,
        energyAFinal.sections,
        energyBFinal.sections,
        barsA,
        barsB,
        dropsA.drops,
        dropsB.drops,
        dropsA.buildups,
        dropsB.buildups
      );
      setTransitionPlan(plan);
    }

    if (bpmAResult && bpmBResult) {
      setBpmMessage(
        `BPM: ${bpmAResult.bpm} / ${bpmBResult.bpm} | Beats: ${beatsA.length} / ${beatsB.length} | Sections: ${energyAFinal.sections.length} / ${energyBFinal.sections.length}`
      );
    } else {
      setBpmMessage("Erreur lors de l'analyse BPM");
    }
  };

  const analyzePlaylist = async () => {
    if (playlist.length < 2) {
      setBpmMessage("Importe au moins 2 fichiers MP3");
      return;
    }

    setBpmMessage("Analyse de la playlist en cours...");

    try {
      const analyzedPlaylist = await playlistManager.analyzePlaylist(playlist);
      setBpmMessage(`Playlist analysée: ${analyzedPlaylist.tracks.length} morceaux, ${analyzedPlaylist.transitions.length} transitions`);
    } catch (error) {
      setBpmMessage("Erreur lors de l'analyse de la playlist");
      console.error("Playlist analysis error:", error);
    }
  };

  const skipToNext = async () => {
    if (playlist.length === 0) return;

    const activePlaylist = shuffle ? shuffledPlaylist : playlist;
    const nextIndex = (currentTrackIndex + 1) % activePlaylist.length;

    // Si repeat est désactivé et on est à la fin, arrêter
    if (!repeat && nextIndex === 0) {
      await stopPlayback();
      return;
    }

    setCurrentTrackIndex(nextIndex);
    setNextTrackIndex((nextIndex + 1) % activePlaylist.length);

    // Mettre à jour trackA et trackB
    setTrackA(activePlaylist[nextIndex]);
    setTrackB(activePlaylist[(nextIndex + 1) % activePlaylist.length]);

    // Mettre à jour les morceaux affichés dans l'UI
    setDisplayedTrack(activePlaylist[nextIndex]);
    setDisplayedNextTrack(activePlaylist[(nextIndex + 1) % activePlaylist.length]);

    // Réinitialiser les BPM
    setBpmA(null);
    setBpmB(null);
    setDurationA(null);
    setDurationB(null);
    setTargetBpm(null);
    setPlaybackRateA(null);
    setPlaybackRateB(null);

    // Charger les nouveaux morceaux
    await stopTracks();
    await loadTracks(
      activePlaylist[nextIndex].uri,
      activePlaylist[(nextIndex + 1) % activePlaylist.length].uri
    );

    // Précharger le morceau suivant
    preloadNextTrack();

    // Si autoplay est activé, démarrer la lecture
    if (autoplay) {
      await startCrossfade();
    }
  };

  const skipToPrevious = async () => {
    if (playlist.length === 0) return;

    const activePlaylist = shuffle ? shuffledPlaylist : playlist;
    const prevIndex = currentTrackIndex === 0 ? activePlaylist.length - 1 : currentTrackIndex - 1;

    setCurrentTrackIndex(prevIndex);
    setNextTrackIndex((prevIndex + 1) % activePlaylist.length);

    // Mettre à jour trackA et trackB
    setTrackA(activePlaylist[prevIndex]);
    setTrackB(activePlaylist[(prevIndex + 1) % activePlaylist.length]);

    // Mettre à jour les morceaux affichés dans l'UI
    setDisplayedTrack(activePlaylist[prevIndex]);
    setDisplayedNextTrack(activePlaylist[(prevIndex + 1) % activePlaylist.length]);

    // Réinitialiser les BPM
    setBpmA(null);
    setBpmB(null);
    setDurationA(null);
    setDurationB(null);
    setTargetBpm(null);
    setPlaybackRateA(null);
    setPlaybackRateB(null);

    // Charger les nouveaux morceaux
    await stopTracks();
    await loadTracks(
      activePlaylist[prevIndex].uri,
      activePlaylist[(prevIndex + 1) % activePlaylist.length].uri
    );

    // Si autoplay est activé, démarrer la lecture
    if (autoplay) {
      await startCrossfade();
    }
  };

  const toggleAutoplay = () => {
    setAutoplay(!autoplay);
  };

  const toggleRepeat = () => {
    setRepeat(!repeat);
  };

  const toggleShuffle = () => {
    if (shuffle) {
      // Désactiver shuffle
      setShuffle(false);
      setCurrentTrackIndex(0);
      setNextTrackIndex(1);
      setTrackA(playlist[0]);
      setTrackB(playlist[1]);
      setDisplayedTrack(playlist[0]);
      setDisplayedNextTrack(playlist[1]);
    } else {
      // Activer shuffle
      const shuffled = [...playlist].sort(() => Math.random() - 0.5);
      setShuffledPlaylist(shuffled);
      setShuffle(true);
      setCurrentTrackIndex(0);
      setNextTrackIndex(1);
      setTrackA(shuffled[0]);
      setTrackB(shuffled[1]);
      setDisplayedTrack(shuffled[0]);
      setDisplayedNextTrack(shuffled[1]);
    }
  };

  const preloadNextTrack = async () => {
    if (playlist.length === 0) return;

    const activePlaylist = shuffle ? shuffledPlaylist : playlist;
    const nextIndex = (currentTrackIndex + 1) % activePlaylist.length;

    // Précharger et analyser le prochain morceau
    const nextTrack = activePlaylist[nextIndex];
    if (!nextTrack) return;

    try {
      const bpmResult = await analyzeBpm(nextTrack.uri);
      const energyResult = await analyzeEnergy(nextTrack.uri);

      const beats = (bpmResult as any)?.beats || [];
      const energyFinal = energyResult || analyzeEnergyFallback(beats, bpmResult?.duration || 0);

      // Stocker les résultats pour le prochain morceau
      setBpmB(bpmResult?.bpm || null);
      setDurationB(bpmResult?.duration || null);
      setBeatsB(beats);
      setEnergySectionsB(energyFinal.sections);

      console.log(`Préchargement du morceau ${nextIndex}: ${nextTrack.name}`);
    } catch (error) {
      console.error("Erreur lors du préchargement:", error);
    }
  };

  const togglePlayPause = async () => {
    if (isPlaying) {
      await stopPlayback();
    } else {
      await startCrossfade();
    }
  };

  const seekToPosition = async (position: number) => {
    // Implémentation du seek - nécessite une fonction dans playbackService
    setCurrentPosition(position);
    // TODO: Appeler la fonction de seek dans playbackService
  };

  const synchronizeTempo = () => {
    if (!bpmA || !bpmB) {
      setSyncMessage(
        "Tu as besoin des 2 BPM pour synchroniser"
      );

      return;
    }

    const result = computeTempoSync(
      bpmA,
      bpmB
    );

    setTargetBpm(result.targetBpm);

    setPlaybackRateA(
      result.playbackRateA
    );

    setPlaybackRateB(
      result.playbackRateB
    );

    // Ne plus appliquer les playback rates immédiatement
    // Ils seront appliqués progressivement pendant le crossfade

    setSyncMessage(
      "Tempo calcule. Le crossfade appliquera la transition progressive."
    );
  };

  const startCrossfade = async () => {
    if (!trackA || !trackB || !durationA || !bpmA || !bpmB || !playbackRateA || !playbackRateB) {
      setPlaybackMessage("Importe d'abord deux fichiers MP3 et analyse les BPM");
      return;
    }

    // Démarrer Track A avec son BPM normal (playbackRate = 1.0)
    await setVolumeA(1.0);
    await setVolumeB(0.0);
    await setPlaybackRateA(1.0);
    await setPlaybackRateB(1.0);
    await playTrackA();

    setIsPlaying(true);
    setPlaybackMessage(`Track A en lecture (${durationA.toFixed(1)}s) - BPM: ${bpmA}`);

    // Calculer quand démarrer la transition (30s avant la fin)
    const transitionWindowSec = transitionWindowMs / 1000;
    const crossfadeSec = crossfadeMs / 1000;
    const tempoTransitionSec = tempoTransitionMs / 1000;

    // La transition commence 30s avant la fin
    const startTransitionTime = durationA - transitionWindowSec;
    // La transition de tempo commence au début de la fenêtre
    const startTempoTransitionTime = startTransitionTime;
    // Track B démarre après la transition de tempo
    const startBTime = startTransitionTime + tempoTransitionSec;
    // Le crossfade commence quand B démarre
    const startCrossfadeTime = startBTime;

    // Variables pour l'interpolation du tempo
    const tempoSteps = 40;
    const tempoStepDuration = tempoTransitionMs / tempoSteps;

    // Attendre le bon moment pour commencer la transition de tempo de A
    setTimeout(async () => {
      try {
        setPlaybackMessage("Transition tempo en cours...");

        // Interpolation progressive du tempo de A vers le target
        for (let i = 0; i <= tempoSteps; i++) {
          const progress = i / tempoSteps;
          const easedProgress = easeInOutCubic(progress);
          const currentRateA = 1.0 + (playbackRateA - 1.0) * easedProgress;

          await setPlaybackRateA(currentRateA);
          await setPlaybackRateB(1.0);
          await new Promise((resolve) => setTimeout(resolve, tempoStepDuration));
        }
      } catch (err: any) {
        console.error('[BeatBlendEngine] Tempo transition error:', err);
      }
    }, startTempoTransitionTime * 1000);

    // Attendre le bon moment pour démarrer Track B
    setTimeout(async () => {
      try {
        setPlaybackMessage("Démarrage de Track B...");

        // Démarrer Track B avec le même tempo que A à ce moment (le target)
        await setPlaybackRateA(playbackRateA);
        await setPlaybackRateB(playbackRateA);
        await playTrackB();

        // Attendre un peu que B démarre avant de commencer le crossfade
        await new Promise((resolve) => setTimeout(resolve, 500));

        setPlaybackMessage("Crossfade en cours...");

        // Interpolation des volumes pendant le crossfade
        const steps = 40;
        const stepDuration = crossfadeMs / steps;

        for (let i = 0; i <= steps; i++) {
          const progress = i / steps;
          const volumeA = 1.0 - progress;
          const volumeB = progress;

          await setVolumeA(volumeA);
          await setVolumeB(volumeB);

          await new Promise((resolve) => setTimeout(resolve, stepDuration));
        }

        // Arrêter Track A après le crossfade
        await stopTrackA();
        setPlaybackMessage(`Track B en lecture seule - BPM: ${bpmB}`);

        // Transition progressive du tempo de B vers son BPM original (après la fin de A)
        const remainingTime = transitionWindowMs - tempoTransitionMs - crossfadeMs;
        if (remainingTime > 0) {
          const bTempoSteps = 20;
          const bTempoStepDuration = remainingTime / bTempoSteps;

          for (let i = 0; i <= bTempoSteps; i++) {
            const progress = i / bTempoSteps;
            const easedProgress = easeInOutCubic(progress);
            const currentRateB = playbackRateA + (1.0 - playbackRateA) * easedProgress;

            await setPlaybackRateB(currentRateB);
            await new Promise((resolve) => setTimeout(resolve, bTempoStepDuration));
          }

          await setPlaybackRateB(1.0);
        }
      } catch (err: any) {
        console.error('[BeatBlendEngine] Track B start error:', err);
      }
    }, startBTime * 1000);
  };

  const stopPlayback = async () => {
    await stopTracks();

    setIsPlaying(false);
    setCurrentPosition(0);

    setPlaybackMessage(
      "Lecture arretee"
    );
  };

  return {
    trackA,
    trackB,
    playlist,
    currentTrackIndex,
    nextTrackIndex,
    autoplay,
    repeat,
    shuffle,
    displayedTrack,
    displayedNextTrack,
    isTransitioning,
    transitionProgress,

    importMessage,

    bpmA,
    bpmB,
    bpmMessage,

    targetBpm,

    playbackRateA,
    playbackRateB,

    syncMessage,

    crossfadeMs,
    transitionWindowMs,

    playbackMessage,

    isPlaying,

    currentPosition,
    durationA,

    beatsA,
    beatsB,
    energySectionsA,
    energySectionsB,

    pickMp3Files,
    analyzeBpms,
    analyzePlaylist,
    skipToNext,
    skipToPrevious,
    toggleAutoplay,
    toggleRepeat,
    toggleShuffle,
    preloadNextTrack,
    togglePlayPause,
    seekToPosition,
    synchronizeTempo,
    startCrossfade,
    stopPlayback,
  };
};