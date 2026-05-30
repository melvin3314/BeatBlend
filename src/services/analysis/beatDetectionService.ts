import axios from "axios";

const BPM_SERVER_URL = "http://192.168.1.124:5000/bpm";

export interface BpmAnalysisResult {
  bpm: number;
  duration: number;
  beats?: number[]; // Timestamps des beats
  confidence?: number;
}

export const analyzeBpm = async (
  trackUri: string
): Promise<BpmAnalysisResult | null> => {
  try {
    const formData = new FormData();

    formData.append("file", {
      uri: trackUri,
      type: "audio/mpeg",
      name: "track.mp3",
    } as any);

    const response = await axios.post(
      BPM_SERVER_URL,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 10000,
      }
    );

    console.log("SERVER RESPONSE:", response.data);

    if (!response.data.success) {
      return null;
    }

    console.log("BPM:", response.data.bpm);
    console.log("Duration:", response.data.duration);
    console.log("Beats:", response.data.beats);
    console.log("Confidence:", response.data.confidence);

    return {
      bpm: response.data.bpm,
      duration: response.data.duration || 0,
      beats: response.data.beats,
      confidence: response.data.confidence,
    };
  } catch (error) {
    console.log("BPM SERVER ERROR:", error);
    console.log("Make sure the BPM server is running at:", BPM_SERVER_URL);
    return null;
  }
};

export const analyzeBeats = async (
  trackUri: string
): Promise<number[] | null> => {
  const result = await analyzeBpm(trackUri);
  return result?.beats || null;
};
