/**
 * TransitionEngine
 * Moteur d'exécution de transitions basé sur des presets riches.
 *
 * Exécute un TransitionPreset en interpolant les courbes de volume/rate
 * avec un timing configurable (steps, easing).
 *
 * Architecture modulaire : chaque preset est une définition déclarative,
 * le moteur l'exécute de manière uniforme.
 */

import { audioEngine } from "./AudioEngine";
import {
    type PresetName,
    PRESETS,
    sampleRate,
    sampleVolume,
    type TransitionPreset
} from "./TransitionPresets";

// --- FX HELPERS ---
const stutter = async (deckId: string, duration: number = 1000, cuts: number = 8): Promise<void> => {
  const deck = audioEngine.getDeck(deckId);
  if (!deck?.sound) return;
  const cutDuration = duration / cuts;
  const timeouts: ReturnType<typeof setTimeout>[] = [];
  for (let i = 0; i < cuts; i++) {
    timeouts.push(setTimeout(() => {
      deck.sound?.pause();
      setTimeout(() => deck.sound?.play(), cutDuration * 0.5);
    }, i * cutDuration));
  }
  timeouts.push(setTimeout(() => timeouts.forEach(clearTimeout), duration + 50));
};

const tremolo = async (deckId: string, duration: number = 2000, rate: number = 8): Promise<void> => {
  const deck = audioEngine.getDeck(deckId);
  if (!deck?.sound) return;
  const baseVolume = deck.volume;
  const intervalMs = 1000 / rate;
  const timer = setInterval(() => {
    const phase = (Date.now() % 1000) / 1000;
    const vol = baseVolume * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2 * rate));
    deck.sound?.setVolume(Math.max(0, Math.min(1, vol)));
  }, intervalMs);
  setTimeout(() => {
    clearInterval(timer);
    deck.sound?.setVolume(baseVolume);
  }, duration);
};

/** Simule un tape stop : rate qui chute brutalement vers 0.1 */
const tapeStop = async (deckId: string, duration: number = 800): Promise<void> => {
  const deck = audioEngine.getDeck(deckId);
  if (!deck?.sound) return;
  const startRate = deck.rate;
  const start = Date.now();
  const timer = setInterval(() => {
    const elapsed = Date.now() - start;
    const progress = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(progress, 3); // easeInCubic inverse
    const current = startRate * (0.1 + 0.9 * eased);
    deck.sound?.setSpeed(Math.max(0.25, current));
    deck.rate = current;
    if (progress >= 1) clearInterval(timer);
  }, 50);
  setTimeout(() => clearInterval(timer), duration + 100);
};

/** Simule un echo out avec decay de volume */
const echoOutDecay = async (deckId: string, duration: number = 2000, repeats: number = 4): Promise<void> => {
  const deck = audioEngine.getDeck(deckId);
  if (!deck?.sound) return;
  const baseVol = deck.volume;
  const interval = duration / repeats;
  let count = 0;
  const timer = setInterval(() => {
    count++;
    const decay = Math.pow(0.6, count);
    deck.sound?.setVolume(baseVol * decay);
    if (count >= repeats) {
      clearInterval(timer);
      deck.sound?.setVolume(baseVol);
    }
  }, interval);
};

export interface RateMorphConfig {
  deckA?: { from: number; to: number; startAt?: number };
  deckB?: { from: number; to: number; startAt?: number };
}

export type TransitionState = "idle" | "preparing" | "executing" | "complete";

export interface TransitionProgress {
  state: TransitionState;
  presetName: PresetName | null;
  progress: number; // 0-1
  elapsed: number; // ms
  total: number; // ms
  deckA_volume: number;
  deckB_volume: number;
}

type TransitionListener = (progress: TransitionProgress) => void;

export class TransitionEngine {
  private listeners: Set<TransitionListener> = new Set();
  private currentState: TransitionProgress = {
    state: "idle",
    presetName: null,
    progress: 0,
    elapsed: 0,
    total: 0,
    deckA_volume: 1,
    deckB_volume: 0,
  };
  private abortController: AbortController | null = null;

  // --- Easing ---
  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // --- Core Execution ---

  /**
   * Exécute un preset de transition entre deux decks.
   *
   * @param presetName — nom du preset à exécuter
   * @param deckA — deck sortant
   * @param deckB — deck entrant
   * @param seed — seed pour la randomisation déterministe de la durée
   */
  async executePreset(
    presetName: PresetName,
    deckA: string,
    deckB: string,
    seed: number = Math.random(),
    rateMorph?: RateMorphConfig
  ): Promise<void> {
    const preset = PRESETS[presetName];
    if (!preset) {
      console.error(`[TransitionEngine] Unknown preset: ${presetName}`);
      return;
    }

    this.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const duration = this.computeDuration(preset, seed);
    const steps = this.computeStepCount(duration, preset.feel);
    const stepDuration = duration / steps;

    console.log(
      `[TransitionEngine] Executing "${preset.label}" | Duration: ${duration}ms | Steps: ${steps} | Feel: ${preset.feel}`
    );

    this.updateState({
      state: "preparing",
      presetName,
      progress: 0,
      elapsed: 0,
      total: duration,
      deckA_volume: 1,
      deckB_volume: 0,
    });

    // Préparer deck B (ne pas rejouer s'il est déjà actif)
    const deckBState = audioEngine.getDeckState(deckB);
    audioEngine.setVolume(deckB, 0);
    if (!deckBState?.isPlaying) {
      await audioEngine.play(deckB);
    }

    // Attendre le delay de démarrage si défini
    if (preset.deckB_startDelay > 0) {
      await this.sleep(preset.deckB_startDelay, signal);
      if (signal.aborted) return;
    }

    this.updateState({ state: "executing" });

    // FX sur certains presets
    let fxTriggered = false;

    // Exécution de la transition
    for (let i = 0; i <= steps; i++) {
      if (signal.aborted) return;

      const t = i / steps;
      const easedT = this.easeInOutCubic(t); // easing global sur le temps

      // Sample les courbes au point t
      let volA = sampleVolume(preset.deckA_volume, t);
      let volB = sampleVolume(preset.deckB_volume, t);

      // --- DUCKING AUTO (sidechain musical) ---
      // A baise quand B monte, avec un curve doux pour éviter les pumps agressifs
      if (preset.duckingAmount > 0 && volB > 0.1) {
        const duckIntensity = Math.max(0, (volB - 0.1) / 0.9); // normalisé 0-1
        const duckCurve = Math.pow(duckIntensity, 1.5); // curve douce
        const duckFactor = Math.min(1, duckCurve * preset.duckingAmount * 2.5);
        volA = volA * (1 - duckFactor);
      }

      audioEngine.setVolume(deckA, Math.max(0, volA));
      audioEngine.setVolume(deckB, Math.max(0, volB));

      // Rate curves : preset statique ou morph dynamique
      if (preset.deckA_rate) {
        const rateA = sampleRate(preset.deckA_rate, t);
        audioEngine.setRate(deckA, rateA);
      } else if (rateMorph?.deckA) {
        const m = rateMorph.deckA;
        const startAt = m.startAt ?? 0;
        let morphT = 0;
        if (t > startAt) {
          morphT = this.easeInOutCubic((t - startAt) / (1 - startAt));
        }
        const rateA = m.from + (m.to - m.from) * morphT;
        audioEngine.setRate(deckA, rateA);
      }
      if (preset.deckB_rate) {
        const rateB = sampleRate(preset.deckB_rate, t);
        audioEngine.setRate(deckB, rateB);
      } else if (rateMorph?.deckB) {
        const m = rateMorph.deckB;
        const startAt = m.startAt ?? 0;
        let morphT = 0;
        if (t > startAt) {
          morphT = this.easeInOutCubic((t - startAt) / (1 - startAt));
        }
        const rateB = m.from + (m.to - m.from) * morphT;
        audioEngine.setRate(deckB, rateB);
      }

      // --- FX DURANT LA TRANSITION ---
      if (!fxTriggered && t > 0.3 && t < 0.85) {
        if (preset.name === "kick_sync_cut" || preset.name === "power_cut") {
          stutter(deckA, 300, 4);
          fxTriggered = true;
        } else if (preset.name === "energy_boost") {
          tremolo(deckA, 400, 8);
          fxTriggered = true;
        } else if (preset.name === "tension_release" && t > 0.5) {
          tremolo(deckA, 600, 6);
          fxTriggered = true;
        } else if (preset.name === "drop_in" && t > 0.4) {
          stutter(deckB, 200, 2);
          fxTriggered = true;
        } else if (preset.name === "echo_out" && t > 0.6) {
          echoOutDecay(deckA, 1500, 3);
          fxTriggered = true;
        } else if (preset.name === "ambient_fade" && t > 0.5) {
          tapeStop(deckA, 1200);
          fxTriggered = true;
        }
      }

      const elapsed = Math.round(t * duration);
      this.updateState({
        progress: t,
        elapsed,
        deckA_volume: volA,
        deckB_volume: volB,
      });

      if (i < steps) {
        await this.sleep(stepDuration, signal);
      }
    }

    if (!signal.aborted) {
      // Cleanup
      await audioEngine.stop(deckA);
      audioEngine.setVolume(deckB, 1.0);
      // Note: rates are managed by caller (useAutoDJ) to maintain native BPMs

      this.updateState({
        state: "complete",
        progress: 1,
        elapsed: duration,
        deckA_volume: 0,
        deckB_volume: 1,
      });
    }
  }

  /**
   * Fallback: crossfade simple si le preset échoue
   */
  async executeCrossfade(
    deckA: string,
    deckB: string,
    durationMs: number = 8000
  ): Promise<void> {
    await this.executePreset("smooth_blend", deckA, deckB, 0.5);
  }

  // --- Helpers ---

  private computeDuration(preset: TransitionPreset, seed: number): number {
    const variance = (seed - 0.5) * 2 * preset.durationVariance;
    return Math.max(500, Math.round(preset.baseDuration + variance));
  }

  /**
   * Détermine le nombre de steps selon la durée et le feel.
   * Plus la transition est longue, plus on a besoin de steps.
   * Feel abrupt = moins de steps (plus snap).
   */
  private computeStepCount(durationMs: number, feel: TransitionPreset["feel"]): number {
    const baseSteps = Math.max(30, Math.min(120, Math.round(durationMs / 80)));
    switch (feel) {
      case "abrupt":
        return Math.max(10, Math.round(baseSteps * 0.5));
      case "aggressive":
        return Math.max(15, Math.round(baseSteps * 0.7));
      case "punchy":
        return Math.max(18, Math.round(baseSteps * 0.8));
      case "smooth":
        return baseSteps;
      case "ethereal":
        return Math.max(30, Math.round(baseSteps * 1.2));
      default:
        return baseSteps;
    }
  }

  // --- Control ---

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.updateState({
      state: "idle",
      presetName: null,
      progress: 0,
      elapsed: 0,
      total: 0,
      deckA_volume: 1,
      deckB_volume: 0,
    });
  }

  getState(): TransitionProgress {
    return { ...this.currentState };
  }

  // --- Events ---

  onProgress(listener: TransitionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private updateState(partial: Partial<TransitionProgress>): void {
    this.currentState = { ...this.currentState, ...partial };
    const snapshot = { ...this.currentState };
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (e) {
        console.error("TransitionEngine listener error:", e);
      }
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );
    });
  }
}

// Singleton
export const transitionEngine = new TransitionEngine();
