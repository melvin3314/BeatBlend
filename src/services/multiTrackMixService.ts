/**
 * MultiTrackMixService
 * =====================
 * Frontend service for intelligent multi-track DJ mix generation.
 *
 * Uploads multiple tracks, AI reorders them, generates a continuous mix
 * with transitions, and provides timeline metadata.
 */

import * as FileSystem from "expo-file-system/legacy";

export type MixMode = "auto" | "vocal_carry" | "smooth" | "drop_switch";

export type DJPersonality =
  | "cinematic"
  | "festival"
  | "amv_editor"
  | "smooth_night"
  | "chaos_mashup"
  | "phonk_trap";

export type EnergyCurveShape =
  | "sigmoid"
  | "linear"
  | "exponential"
  | "waves"
  | "staircase"
  | "plateau";

export type FXMode = "minimal" | "normal" | "aggressive" | "cinematic";

export interface TimelineEvent {
  time_sec: number;
  type: string;
  track: string;
  description: string;
}

export interface EnergyPoint {
  time: number;
  energy: number;
}

export interface MixTimeline {
  events: TimelineEvent[];
  energy_curve: EnergyPoint[];
}

export interface MultiTrackMixState {
  status: MixStatus;
  progress: number;
  message: string;
  outputUri: string | null;
  totalDurationSec: number | null;
  trackOrder: string[];
  timeline: MixTimeline | null;
  targetBpm: number | null;
  numTracks: number;
  personality: DJPersonality | null;
  energyCurveShape: EnergyCurveShape | null;
  scenes: string[];
  emotions: Record<string, any>;
  error: string | null;
}

export type MixStatus =
  | "idle"
  | "analyzing"
  | "ordering"
  | "mixing"
  | "exporting"
  | "downloading"
  | "ready"
  | "error";

export type MixProgressCallback = (state: MultiTrackMixState) => void;

export interface TrackInput {
  uri: string;
  name: string;
  bpm?: number;
}

const PC_LAN_IP = "192.168.1.124";
const DEFAULT_BASE_URL = `http://${PC_LAN_IP}:5000`;

function getBaseUrl(): string {
  return process.env.EXPO_PUBLIC_BACKEND_URL ?? DEFAULT_BASE_URL;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createInitialState(): MultiTrackMixState {
  return {
    status: "idle",
    progress: 0,
    message: "",
    outputUri: null,
    totalDurationSec: null,
    trackOrder: [],
    timeline: null,
    targetBpm: null,
    numTracks: 0,
    personality: null,
    energyCurveShape: null,
    scenes: [],
    emotions: {},
    error: null,
  };
}

/**
 * Generate an intelligent multi-track DJ mix.
 *
 * @param tracks List of track inputs (uri + name)
 * @param mode Transition mode
 * @param autoOrder Let AI reorder tracks for best flow
 * @param targetBPM Target sync BPM (optional)
 * @param transitionCap Max transition duration
 * @param onProgress Callback for status updates
 * @param signal AbortController signal for cancellation
 */
export async function generateMultiTrackMix(
  tracks: TrackInput[],
  mode: MixMode = "auto",
  autoOrder: boolean = true,
  targetBPM?: number,
  transitionCap: number = 45,
  personality: DJPersonality = "cinematic",
  energyCurveShape?: EnergyCurveShape,
  aggressiveness?: number,
  fxIntensity: number = 0.5,
  fxMode: FXMode = "normal",
  onProgress?: MixProgressCallback,
  signal?: AbortSignal,
): Promise<MultiTrackMixState> {
  const baseUrl = getBaseUrl();
  let state = createInitialState();

  function report(msg: string, pct: number, status: MixStatus = "mixing") {
    state = { ...state, message: msg, progress: pct, status };
    onProgress?.(state);
    return state;
  }

  function reportError(msg: string): MultiTrackMixState {
    state = { ...state, status: "error", error: msg, message: msg };
    onProgress?.(state);
    return state;
  }

  if (tracks.length < 2) {
    return reportError("Need at least 2 tracks for a mix");
  }

  try {
    report("Reading tracks...", 5, "analyzing");
    await sleep(200);

    // Read all tracks as base64 (React Native compatible)
    const trackData = [];
    for (const track of tracks) {
      const b64 = await FileSystem.readAsStringAsync(track.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      trackData.push({
        name: track.name,
        base64: b64,
        bpm: track.bpm,
      });
    }

    report("Uploading & ordering tracks...", 15, "ordering");

    const res = await fetch(`${baseUrl}/generate_mix_multiple`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        tracks: trackData,
        mode,
        auto_order: autoOrder,
        transition_duration: transitionCap,
        personality,
        ...(targetBPM ? { target_bpm: targetBPM } : {}),
        ...(energyCurveShape ? { energy_curve_shape: energyCurveShape } : {}),
        ...(aggressiveness !== undefined ? { aggressiveness } : {}),
        fx_intensity: fxIntensity,
        fx_mode: fxMode,
        format: "wav",
      }),
      signal,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return reportError(errData.error || `Server error: ${res.status}`);
    }

    report("Mixing tracks with AI transitions...", 40, "mixing");
    await sleep(500);

    const data = await res.json();
    if (!data.success) {
      return reportError(data.error || "Mix generation failed");
    }

    report("Exporting mix...", 70, "exporting");
    await sleep(200);

    // Download result
    const outputDir = FileSystem.documentDirectory + "mixes/";
    try {
      const dirInfo = await FileSystem.getInfoAsync(outputDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
      }
    } catch {
      // ignore
    }

    const filename = data.output_path.split("/").pop() || "multi_mix.wav";
    const localUri = outputDir + filename;

    const downloadRes = await FileSystem.downloadAsync(
      `${baseUrl}/download_mix/${filename}`,
      localUri,
      { sessionType: FileSystem.FileSystemSessionType.BACKGROUND }
    );

    if (downloadRes.status !== 200) {
      return reportError(`Download failed: HTTP ${downloadRes.status}`);
    }

    report("Mix ready!", 100, "ready");
    await sleep(100);

    const finalState: MultiTrackMixState = {
      status: "ready",
      progress: 100,
      message: `Mix ready! ${data.num_tracks} tracks, ${data.total_duration_sec?.toFixed(1)}s`,
      outputUri: downloadRes.uri,
      totalDurationSec: data.total_duration_sec ?? null,
      trackOrder: data.track_order ?? [],
      timeline: data.timeline ?? null,
      targetBpm: data.target_bpm ?? null,
      numTracks: data.num_tracks ?? tracks.length,
      personality: data.personality ?? null,
      energyCurveShape: data.energy_curve_shape ?? null,
      scenes: data.scenes ?? [],
      emotions: data.emotions ?? {},
      error: null,
    };

    onProgress?.(finalState);
    return finalState;
  } catch (err: any) {
    if (err.name === "AbortError") {
      return reportError("Cancelled by user");
    }
    console.error("[MultiTrackMix] error:", err);
    return reportError(err.message || "Unknown error");
  }
}
