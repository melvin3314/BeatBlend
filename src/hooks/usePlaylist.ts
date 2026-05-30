import { useCallback, useState } from "react";
import type { SelectedTrack } from "../types/audio";

export interface PlaylistState {
  tracks: SelectedTrack[];
  currentIndex: number;
  autoplay: boolean;
  repeat: boolean;
  shuffle: boolean;
}

export const usePlaylist = () => {
  const [tracks, setTracks] = useState<SelectedTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [repeat, setRepeat] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);

  const currentTrack = tracks.length > 0 ? tracks[resolveIndex(currentIndex)] : null;
  const nextTrack = tracks.length > 1 ? tracks[resolveIndex(currentIndex + 1)] : null;
  const previousTrack = tracks.length > 1 ? tracks[resolveIndex(currentIndex - 1)] : null;

  function resolveIndex(idx: number): number {
    if (tracks.length === 0) return 0;
    if (shuffle && shuffleOrder.length > 0) {
      const wrapped = ((idx % shuffleOrder.length) + shuffleOrder.length) % shuffleOrder.length;
      return shuffleOrder[wrapped];
    }
    return ((idx % tracks.length) + tracks.length) % tracks.length;
  }

  const setPlaylist = useCallback((newTracks: SelectedTrack[]) => {
    setTracks(newTracks);
    setCurrentIndex(0);
    setShuffleOrder(generateShuffleOrder(newTracks.length));
  }, []);

  const goToNext = useCallback((): SelectedTrack | null => {
    if (tracks.length === 0) return null;

    const nextIdx = currentIndex + 1;
    const isEnd = !shuffle
      ? nextIdx >= tracks.length
      : nextIdx >= shuffleOrder.length;

    if (isEnd && !repeat) {
      return null; // End of playlist
    }

    const newIndex = isEnd ? 0 : nextIdx;
    setCurrentIndex(newIndex);
    return tracks[resolveIndex(newIndex)] ?? null;
  }, [tracks, currentIndex, shuffle, shuffleOrder, repeat]);

  const goToPrevious = useCallback((): SelectedTrack | null => {
    if (tracks.length === 0) return null;

    const prevIdx = currentIndex - 1;
    const newIndex = prevIdx < 0 ? (repeat ? tracks.length - 1 : 0) : prevIdx;
    setCurrentIndex(newIndex);
    return tracks[resolveIndex(newIndex)] ?? null;
  }, [tracks, currentIndex, repeat]);

  const goToIndex = useCallback((idx: number): SelectedTrack | null => {
    if (idx < 0 || idx >= tracks.length) return null;
    setCurrentIndex(idx);
    return tracks[idx] ?? null;
  }, [tracks]);

  const toggleAutoplay = useCallback(() => setAutoplay((p) => !p), []);
  const toggleRepeat = useCallback(() => setRepeat((p) => !p), []);

  const toggleShuffle = useCallback(() => {
    setShuffle((prev) => {
      if (!prev) {
        setShuffleOrder(generateShuffleOrder(tracks.length));
      }
      return !prev;
    });
  }, [tracks.length]);

  const reorderTracks = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setTracks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    // Adjust currentIndex if it was affected by the reorder
    setCurrentIndex((prev) => {
      if (prev === fromIndex) return toIndex;
      if (fromIndex < toIndex) {
        if (prev > fromIndex && prev <= toIndex) return prev - 1;
      } else {
        if (prev >= toIndex && prev < fromIndex) return prev + 1;
      }
      return prev;
    });
  }, []);

  const canGoNext = repeat || currentIndex < tracks.length - 1;
  const canGoPrevious = repeat || currentIndex > 0;

  return {
    tracks,
    currentIndex,
    currentTrack,
    nextTrack,
    previousTrack,
    autoplay,
    repeat,
    shuffle,
    canGoNext,
    canGoPrevious,

    setPlaylist,
    goToNext,
    goToPrevious,
    goToIndex,
    toggleAutoplay,
    toggleRepeat,
    toggleShuffle,
    reorderTracks,
  };
};

function generateShuffleOrder(length: number): number[] {
  const arr = Array.from({ length }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
