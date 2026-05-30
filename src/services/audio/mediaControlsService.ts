/**
 * MediaControlsService
 * Gère les contrôles média natifs (background playback, écran verrouillé).
 *
 * NOTE: Les notifications natives avec boutons play/pause/next
 * nécessitent un module natif comme react-native-track-player.
 * Pour l'instant, on configure le background audio et on expose
 * une API prête pour l'intégration future.
 */

import { useEffect, useRef } from "react";

interface MediaControlsConfig {
  title: string;
  artist?: string;
  artwork?: string;
  duration?: number;
  position?: number;
  isPlaying?: boolean;
}

let currentConfig: MediaControlsConfig = { title: "BeatBlend" };

/**
 * Met à jour les métadonnées média affichées sur l'écran de verrouillage.
 * Sur Android, cela nécessite une configuration native (pending).
 */
export function updateMediaMetadata(config: Partial<MediaControlsConfig>): void {
  currentConfig = { ...currentConfig, ...config };

  // Web MediaSession API (fonctionne dans les navigateurs et WebViews)
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    const session = (navigator as any).mediaSession;
    session.metadata = new (window as any).MediaMetadata({
      title: currentConfig.title,
      artist: currentConfig.artist || "BeatBlend Auto-DJ",
      artwork: currentConfig.artwork
        ? [{ src: currentConfig.artwork, sizes: "512x512", type: "image/png" }]
        : [],
    });

    session.playbackState = currentConfig.isPlaying ? "playing" : "paused";

    if (currentConfig.duration && currentConfig.position !== undefined) {
      session.setPositionState({
        duration: currentConfig.duration,
        playbackRate: 1.0,
        position: currentConfig.position,
      });
    }
  }
}

/**
 * Configure les handlers pour les actions média (play, pause, next, previous).
 */
export function setupMediaSessionHandlers(handlers: {
  onPlay?: () => void;
  onPause?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSeek?: (position: number) => void;
}): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return () => {};
  }

  const session = (navigator as any).mediaSession;

  const actions: { action: string; handler: ((...args: any[]) => void) | undefined }[] = [
    { action: "play", handler: handlers.onPlay },
    { action: "pause", handler: handlers.onPause },
    { action: "previoustrack", handler: handlers.onPrevious },
    { action: "nexttrack", handler: handlers.onNext },
    { action: "seekto", handler: handlers.onSeek ? (details: any) => handlers.onSeek!(details.seekTime) : undefined },
  ];

  for (const { action, handler } of actions) {
    if (handler) {
      session.setActionHandler(action, handler);
    }
  }

  // Return cleanup
  return () => {
    for (const { action } of actions) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Hook React pour synchroniser les contrôles média avec l'état de lecture.
 */
export function useMediaControls(
  trackName: string | null,
  isPlaying: boolean,
  position: number,
  duration: number,
  handlers: {
    onPlay?: () => void;
    onPause?: () => void;
    onNext?: () => void;
    onPrevious?: () => void;
    onSeek?: (position: number) => void;
  }
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const cleanup = setupMediaSessionHandlers({
      onPlay: () => handlersRef.current.onPlay?.(),
      onPause: () => handlersRef.current.onPause?.(),
      onNext: () => handlersRef.current.onNext?.(),
      onPrevious: () => handlersRef.current.onPrevious?.(),
      onSeek: (pos) => handlersRef.current.onSeek?.(pos),
    });
    return cleanup;
  }, []);

  useEffect(() => {
    updateMediaMetadata({
      title: trackName || "BeatBlend",
      artist: "Auto-DJ",
      isPlaying,
      position,
      duration,
    });
  }, [trackName, isPlaying, position, duration]);
}
