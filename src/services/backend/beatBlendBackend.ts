/**
 * BeatBlend Backend API Service
 * =============================
 * Client pour communiquer avec le serveur Python Flask.
 *
 * Utilise expo-file-system/legacy pour lire les fichiers audio en base64
 * et les envoyer au serveur via JSON (compatibilité React Native ↔ Flask).
 *
 * Endpoints :
 *   POST /analyze   — analyse complète
 *   POST /energy    — courbe d'énergie
 *   POST /harmonic  — tonalité + BPM
 *   POST /structure — segmentation structurelle
 *   POST /genre     — détection de genre
 *   POST /bpm       — BPM + beats + downbeats
 *   GET  /health    — état du serveur
 */

import * as FileSystem from "expo-file-system/legacy";
import type { BackendTrackAnalysis } from "../../types/transitions";

export type RetryOpts = {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit & RetryOpts = {}
): Promise<Response> {
  const {
    signal: externalSignal,
    timeoutMs = 15000,
    retries = 1,
    retryDelayMs = 800,
    ...rest
  } = init as RequestInit & Required<RetryOpts>;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, { ...rest, signal: controller.signal });
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort as any);
      if (res.ok) return res;
      // Retry on transient server errors
      if (attempt < retries && (res.status >= 500 || res.status === 429)) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      return res; // non-retryable response
    } catch (err: any) {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort as any);
      if (attempt < retries) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  // should never reach
  throw new Error("fetchWithRetry exhausted");
}

/**
 * IP de la machine où tourne le serveur Python Flask.
 * CHANGE CETTE IP si ton réseau change.
 * Trouve-la avec `ipconfig` (Windows) ou `ifconfig` (Mac/Linux).
 */
const PC_LAN_IP = "192.168.1.124"; // ← METS TON IP ICI
const DEFAULT_BASE_URL = `http://${PC_LAN_IP}:5000`;

function getBaseUrl(): string {
  return process.env.EXPO_PUBLIC_BACKEND_URL ?? DEFAULT_BASE_URL;
}

/**
 * Lit un fichier audio local et l'envoie au serveur en base64 via JSON.
 * Compatible React Native ↔ Flask/Werkzeug.
 */
async function uploadAudio(
  endpoint: string,
  uri: string,
  name: string,
  opts: RetryOpts = {}
): Promise<Response> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  try {
    // Lire le fichier en base64
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ audio_base64: base64, filename: name }),
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? 30000,
      retries: opts.retries ?? 1,
      retryDelayMs: opts.retryDelayMs ?? 1000,
    });

    return response;
  } catch (e) {
    console.error("[Backend] uploadAudio failed:", e);
    throw e;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export interface BackendHealth {
  status: string;
  madmom: boolean;
  timestamp: string;
}

/**
 * Vérifie que le backend est accessible.
 */
export async function checkBackendHealth(opts: RetryOpts = {}): Promise<BackendHealth | null> {
  try {
    const baseUrl = getBaseUrl();
    const res = await fetchWithRetry(`${baseUrl}/health`, {
      method: "GET",
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? 4000,
      retries: opts.retries ?? 0,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Analyse complète d'un morceau via le backend Python.
 * Retourne toutes les données : BPM, beatgrid, downbeats, sections,
 * drops, builds, énergie, tonalité, genre, vocals, etc.
 */
export async function analyzeTrackBackend(
  uri: string,
  name: string,
  opts: RetryOpts = {}
): Promise<BackendTrackAnalysis | null> {
  try {
    const response = await uploadAudio("/analyze", uri, name, opts);
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Backend] /analyze error ${response.status}: ${text}`);
      return null;
    }
    const data = (await response.json()) as BackendTrackAnalysis;
    if (!data.success) {
      console.error("[Backend] Analysis failed:", data);
      return null;
    }
    console.log(
      `[Backend] Analyzed "${name}": ${data.bpm} BPM | key=${data.key} camelot=${data.camelot} | ` +
      `genre=${data.genre} | beats=${data.beats.length} downbeats=${data.downbeats.length} | ` +
      `phrases=${data.phrases.length} drops=${data.drops.length} builds=${data.builds.length} | ` +
      `vocals=${data.vocalSections.length} sections=${data.sections.length}`
    );
    return data;
  } catch (error) {
    console.error("[Backend] analyzeTrackBackend error:", error);
    return null;
  }
}

/**
 * Récupère uniquement la courbe d'énergie.
 */
export async function getEnergyCurveBackend(
  uri: string,
  name: string,
  opts: RetryOpts = {}
): Promise<BackendTrackAnalysis["energyCurve"] | null> {
  try {
    const response = await uploadAudio("/energy", uri, name, opts);
    if (!response.ok) return null;
    const data = await response.json();
    return data.energyCurve ?? null;
  } catch {
    return null;
  }
}

/**
 * Récupère tonalité et BPM.
 */
export async function getHarmonicBackend(
  uri: string,
  name: string,
  opts: RetryOpts = {}
): Promise<Pick<BackendTrackAnalysis, "bpm" | "key" | "camelot" | "beats" | "downbeats"> | null> {
  try {
    const response = await uploadAudio("/harmonic", uri, name, opts);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      bpm: data.bpm,
      key: data.key,
      camelot: data.camelot,
      beats: data.beats,
      downbeats: data.downbeats,
    };
  } catch {
    return null;
  }
}

/**
 * Récupère la structure musicale (sections, phrases, breakdowns).
 */
export async function getStructureBackend(
  uri: string,
  name: string,
  opts: RetryOpts = {}
): Promise<Pick<BackendTrackAnalysis, "sections" | "phrases" | "breakdowns"> | null> {
  try {
    const response = await uploadAudio("/structure", uri, name, opts);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      sections: data.sections,
      phrases: data.phrases,
      breakdowns: data.breakdowns,
    };
  } catch {
    return null;
  }
}

/**
 * Détecte le genre musical.
 */
export async function getGenreBackend(
  uri: string,
  name: string,
  opts: RetryOpts = {}
): Promise<Pick<BackendTrackAnalysis, "genre" | "bpm"> | null> {
  try {
    const response = await uploadAudio("/genre", uri, name, opts);
    if (!response.ok) return null;
    const data = await response.json();
    return { genre: data.genre, bpm: data.bpm };
  } catch {
    return null;
  }
}

/**
 * Récupère BPM, beats et downbeats.
 */
export async function getBpmBackend(
  uri: string,
  name: string,
  opts: RetryOpts = {}
): Promise<Pick<BackendTrackAnalysis, "bpm" | "beats" | "downbeats" | "bars"> | null> {
  try {
    const response = await uploadAudio("/bpm", uri, name, opts);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      bpm: data.bpm,
      beats: data.beats,
      downbeats: data.downbeats,
      bars: data.bars,
    };
  } catch {
    return null;
  }
}
