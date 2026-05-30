import { createAudioPlayer, type AudioPlayer } from "expo-audio";

let soundA: AudioPlayer | null = null;
let soundB: AudioPlayer | null = null;

export const loadTracks = async (uriA: string, uriB: string) => {
  // Décharge si déjà chargé
  if (soundA) {
    soundA.pause();
    soundA.remove();
  }
  if (soundB) {
    soundB.pause();
    soundB.remove();
  }

  soundA = createAudioPlayer();
  soundB = createAudioPlayer();

  soundA.replace({ uri: uriA });
  soundB.replace({ uri: uriB });
};

export const playTracks = async () => {
  if (!soundA || !soundB) return;

  soundA.play();
  soundB.play();
};

export const stopTracks = async () => {
  if (soundA) soundA.pause();
  if (soundB) soundB.pause();
};

export const setPlaybackRates = async (rateA: number, rateB: number) => {
  if (soundA) {
    soundA.setPlaybackRate?.(rateA);
  }

  if (soundB) {
    soundB.setPlaybackRate?.(rateB);
  }
};

export const setVolumeA = async (volume: number) => {
  if (soundA) {
    soundA.volume = volume;
  }
};

export const setVolumeB = async (volume: number) => {
  if (soundB) {
    soundB.volume = volume;
  }
};

export const playTrackA = async () => {
  if (!soundA) return;
  soundA.play();
};

export const playTrackB = async () => {
  if (!soundB) return;
  soundB.play();
};

export const stopTrackA = async () => {
  if (soundA) soundA.pause();
};

export const stopTrackB = async () => {
  if (soundB) soundB.pause();
};