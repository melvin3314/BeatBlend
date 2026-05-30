import { getBpmBackend } from "../backend/beatBlendBackend";

export interface BpmAnalysisResult {
  bpm: number;
  duration: number; // en secondes
}

export const analyzeBpm = async (
  trackUri: string
): Promise<BpmAnalysisResult | null> => {
  try {
    const result = await getBpmBackend(trackUri, "track.mp3");
    if (!result) return null;

    console.log("[BPM Backend]", result.bpm, "BPM");

    // Estimer la durée à partir du dernier beat + 1 beat
    const duration = result.beats.length > 0
      ? result.beats[result.beats.length - 1] + (60 / result.bpm)
      : 0;

    return {
      bpm: result.bpm,
      duration,
    };
  } catch (error) {
    console.log("[BPM] Backend unavailable, using fallback");
    return null;
  }
};