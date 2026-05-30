/**
 * StemMixService
 * ============
 * Frontend service for offline stem mixing.
 *
 * Uploads two tracks to the backend, generates a mix,
 * downloads the result, and provides playback.
 */

import * as FileSystem from "expo-file-system/legacy";

export type MixMode = "vocal_carry" | "smooth" | "drop_switch";

export type MixStatus =
  | "idle"
  | "uploading"
  | "separating"
  | "syncing"
  | "mixing"
  | "exporting"
  | "downloading"
  | "ready"
  | "error";

export interface TransitionPhase {
  name: string;
  start: number;
  end: number;
}

export interface TransitionMeta {
  start_sec: number;
  blend_sec: number;
  mashup_sec: number;
  drop_sec: number;
  end_sec: number;
  phases: TransitionPhase[];
  bpm_a: number;
  bpm_b: number;
}

export interface MixState {
  status: MixStatus;
  progress: number; // 0-100
  message: string;
  outputUri: string | null;
  durationSec: number | null;
  error: string | null;
  transitionMeta: TransitionMeta | null;
}

export type MixProgressCallback = (state: MixState) => void;

const PC_LAN_IP = "192.168.1.124";
const DEFAULT_BASE_URL = `http://${PC_LAN_IP}:5000`;

function getBaseUrl(): string {
  return process.env.EXPO_PUBLIC_BACKEND_URL ?? DEFAULT_BASE_URL;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate an offline stem mix between two tracks.
 *
 * @param trackAUri Local URI of Track A
 * @param trackAName Display name of Track A
 * @param trackBUri Local URI of Track B
 * @param trackBName Display name of Track B
 * @param mode Mix transition mode
 * @param bpmA Track A BPM (optional)
 * @param bpmB Track B BPM (optional)
 * @param targetBPM Target sync BPM (optional)
 * @param onProgress Callback for status updates
 * @param signal AbortController signal for cancellation
 */
export async function generateMix(
  trackAUri: string,
  trackAName: string,
  trackBUri: string,
  trackBName: string,
  mode: MixMode = "vocal_carry",
  bpmA?: number,
  bpmB?: number,
  targetBPM?: number,
  onProgress?: MixProgressCallback,
  signal?: AbortSignal
): Promise<MixState> {
  const baseUrl = getBaseUrl();
  const outputDir = FileSystem.documentDirectory + "mixes/";

  // Ensure output directory exists
  try {
    const dirInfo = await FileSystem.getInfoAsync(outputDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
    }
  } catch {
    // ignore
  }

  const update = (status: MixStatus, progress: number, message: string) => {
    const state: MixState = {
      status,
      progress,
      message,
      outputUri: null,
      durationSec: null,
      error: null,
      transitionMeta: null,
    };
    onProgress?.(state);
    return state;
  };

  const reportError = (msg: string): MixState => {
    const state: MixState = {
      status: "error",
      progress: 0,
      message: msg,
      outputUri: null,
      durationSec: null,
      error: msg,
      transitionMeta: null,
    };
    onProgress?.(state);
    return state;
  };

  try {
    update("uploading", 5, "Uploading tracks...");

    // Read both tracks as base64
    const [base64A, base64B] = await Promise.all([
      FileSystem.readAsStringAsync(trackAUri, { encoding: FileSystem.EncodingType.Base64 }),
      FileSystem.readAsStringAsync(trackBUri, { encoding: FileSystem.EncodingType.Base64 }),
    ]);

    update("separating", 15, "Separating stems...");

    const response = await fetch(`${baseUrl}/generate_mix`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        track_a_base64: base64A,
        track_a_name: trackAName,
        track_b_base64: base64B,
        track_b_name: trackBName,
        mode,
        format: "wav",
        ...(bpmA ? { bpm_a: bpmA } : {}),
        ...(bpmB ? { bpm_b: bpmB } : {}),
        ...(targetBPM ? { target_bpm: targetBPM } : {}),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return reportError(`Server error ${response.status}: ${text}`);
    }

    update("exporting", 80, "Exporting final mix...");

    const data = await response.json();
    if (!data.success) {
      return reportError(data.error || "Mix generation failed");
    }

    update("downloading", 90, "Downloading result...");

    // Download the generated file
    const filename = data.output_path.split("/").pop() || "final_mix.wav";
    const downloadUrl = `${baseUrl}/download_mix/${filename}`;
    const localUri = outputDir + filename;

    const downloadRes = await FileSystem.downloadAsync(downloadUrl, localUri, {
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    });

    if (downloadRes.status !== 200) {
      return reportError(`Download failed: HTTP ${downloadRes.status}`);
    }

    const finalState: MixState = {
      status: "ready",
      progress: 100,
      message: "Mix ready!",
      outputUri: localUri,
      durationSec: data.duration_sec ?? null,
      error: null,
      transitionMeta: data.transition ?? null,
    };

    onProgress?.(finalState);
    return finalState;
  } catch (err: any) {
    if (err.name === "AbortError") {
      return reportError("Cancelled by user");
    }
    console.error("[StemMix] generateMix error:", err);
    return reportError(err.message || "Unknown error");
  }
}

/**
 * Check backend availability.
 */
export async function checkMixBackend(): Promise<boolean> {
  try {
    const baseUrl = getBaseUrl();
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
