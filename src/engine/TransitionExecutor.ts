import type { TransitionEffect, TransitionPlan, TransitionStyle } from "../types/transitions";
import { audioEngine } from "./AudioEngine";

export type TransitionState = "idle" | "preparing" | "executing" | "complete";

export interface TransitionProgress {
  state: TransitionState;
  style: TransitionStyle | null;
  progress: number; // 0-1
  elapsed: number; // ms
  total: number; // ms
}

type TransitionListener = (progress: TransitionProgress) => void;

/**
 * Executes transition plans on the AudioEngine.
 * Handles volume interpolation, tempo transitions, and effect scheduling.
 */
export class TransitionExecutor {
  private listeners: Set<TransitionListener> = new Set();
  private currentState: TransitionProgress = {
    state: "idle",
    style: null,
    progress: 0,
    elapsed: 0,
    total: 0,
  };
  private abortController: AbortController | null = null;

  // --- Easing Functions ---

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  private easeOutQuad(t: number): number {
    return 1 - (1 - t) * (1 - t);
  }

  private linear(t: number): number {
    return t;
  }

  // --- Core Execution ---

  /**
   * Execute a full transition plan between deck A and deck B
   */
  async executeTransition(
    plan: TransitionPlan,
    deckAId: string,
    deckBId: string
  ): Promise<void> {
    // Abort previous transition
    this.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.updateState({
      state: "preparing",
      style: plan.style,
      progress: 0,
      elapsed: 0,
      total: plan.totalDuration,
    });

    // Start deck B
    audioEngine.setVolume(deckBId, 0);
    await audioEngine.play(deckBId);

    this.updateState({ state: "executing" });

    // Execute all effects in parallel
    try {
      await Promise.all(
        plan.effects.map((effect) =>
          this.executeEffect(effect, deckAId, deckBId, plan.totalDuration, signal)
        )
      );

      if (!signal.aborted) {
        // Cleanup: stop deck A
        await audioEngine.stop(deckAId);
        audioEngine.setVolume(deckBId, 1.0);

        this.updateState({
          state: "complete",
          progress: 1,
          elapsed: plan.totalDuration,
        });
      }
    } catch (error) {
      if (!signal.aborted) {
        console.error("Transition execution error:", error);
      }
    }
  }

  /**
   * Execute a simple crossfade (no plan needed)
   */
  async executeCrossfade(
    deckAId: string,
    deckBId: string,
    durationMs: number = 8000,
    tempoTransitionMs: number = 4000,
    targetRateA: number = 1.0,
    targetRateB: number = 1.0
  ): Promise<void> {
    this.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const totalDuration = tempoTransitionMs + durationMs;

    this.updateState({
      state: "executing",
      style: "crossfade",
      progress: 0,
      elapsed: 0,
      total: totalDuration,
    });

    // Phase 1: Tempo transition on deck A
    if (tempoTransitionMs > 0 && targetRateA !== 1.0) {
      await this.interpolateRate(
        deckAId,
        1.0,
        targetRateA,
        tempoTransitionMs,
        signal,
        0,
        totalDuration
      );
    }

    if (signal.aborted) return;

    // Phase 2: Start deck B and crossfade
    audioEngine.setVolume(deckBId, 0);
    audioEngine.setRate(deckBId, targetRateA); // Start B at same rate as A
    await audioEngine.play(deckBId);

    // Wait a bit for B to start
    await this.sleep(200, signal);
    if (signal.aborted) return;

    // Crossfade volumes
    await this.interpolateVolumes(
      deckAId,
      deckBId,
      durationMs,
      signal,
      tempoTransitionMs,
      totalDuration
    );

    if (signal.aborted) return;

    // Stop deck A
    await audioEngine.stop(deckAId);

    // Phase 3: Transition B back to its natural rate
    if (targetRateB !== targetRateA) {
      await this.interpolateRate(
        deckBId,
        targetRateA,
        1.0,
        3000,
        signal,
        totalDuration,
        totalDuration + 3000
      );
    } else {
      audioEngine.setRate(deckBId, 1.0);
    }

    this.updateState({
      state: "complete",
      progress: 1,
      elapsed: totalDuration,
    });
  }

  /**
   * Execute a quick cut transition
   */
  async executeCut(
    deckAId: string,
    deckBId: string,
    durationMs: number = 200
  ): Promise<void> {
    this.abort();
    this.abortController = new AbortController();

    this.updateState({
      state: "executing",
      style: "cut_drop",
      progress: 0,
      elapsed: 0,
      total: durationMs,
    });

    // Instant volume swap
    audioEngine.setVolume(deckAId, 0);
    audioEngine.setVolume(deckBId, 1.0);
    await audioEngine.play(deckBId);

    await this.sleep(durationMs, this.abortController.signal);

    await audioEngine.stop(deckAId);

    this.updateState({
      state: "complete",
      progress: 1,
      elapsed: durationMs,
    });
  }

  // --- Interpolation Helpers ---

  private async interpolateVolumes(
    deckAId: string,
    deckBId: string,
    durationMs: number,
    signal: AbortSignal,
    offsetMs: number = 0,
    totalMs: number = 0
  ): Promise<void> {
    const steps = 40;
    const stepDuration = durationMs / steps;

    for (let i = 0; i <= steps; i++) {
      if (signal.aborted) return;

      const t = i / steps;
      const eased = this.easeInOutCubic(t);

      audioEngine.setVolume(deckAId, 1.0 - eased);
      audioEngine.setVolume(deckBId, eased);

      // Update progress
      const elapsed = offsetMs + t * durationMs;
      const total = totalMs || durationMs;
      this.updateState({
        progress: Math.min(1, elapsed / total),
        elapsed,
      });

      await this.sleep(stepDuration, signal);
    }
  }

  private async interpolateRate(
    deckId: string,
    fromRate: number,
    toRate: number,
    durationMs: number,
    signal: AbortSignal,
    offsetMs: number = 0,
    totalMs: number = 0
  ): Promise<void> {
    const steps = 30;
    const stepDuration = durationMs / steps;

    for (let i = 0; i <= steps; i++) {
      if (signal.aborted) return;

      const t = i / steps;
      const eased = this.easeInOutCubic(t);
      const currentRate = fromRate + (toRate - fromRate) * eased;

      audioEngine.setRate(deckId, currentRate);

      const elapsed = offsetMs + t * durationMs;
      const total = totalMs || durationMs;
      this.updateState({
        progress: Math.min(1, elapsed / total),
        elapsed,
      });

      await this.sleep(stepDuration, signal);
    }
  }

  // --- Effect Executor ---

  private async executeEffect(
    effect: TransitionEffect,
    deckAId: string,
    deckBId: string,
    totalDuration: number,
    signal: AbortSignal
  ): Promise<void> {
    // Wait for start time
    if (effect.startTime > 0) {
      await this.sleep(effect.startTime, signal);
      if (signal.aborted) return;
    }

    const targetDeckId =
      effect.target === "trackA" ? deckAId :
      effect.target === "trackB" ? deckBId :
      deckAId; // "both" defaults to A

    switch (effect.type) {
      case "volume": {
        const from = effect.parameters.from ?? 1.0;
        const to = effect.parameters.to ?? 0.0;
        const steps = 30;
        const stepDuration = effect.duration / steps;

        for (let i = 0; i <= steps; i++) {
          if (signal.aborted) return;
          const t = i / steps;
          const eased = this.easeInOutCubic(t);
          const vol = from + (to - from) * eased;

          if (effect.target === "both") {
            audioEngine.setVolume(deckAId, vol);
            audioEngine.setVolume(deckBId, vol);
          } else {
            audioEngine.setVolume(targetDeckId, vol);
          }

          this.updateState({
            progress: Math.min(1, (effect.startTime + t * effect.duration) / totalDuration),
            elapsed: effect.startTime + t * effect.duration,
          });

          await this.sleep(stepDuration, signal);
        }
        break;
      }

      case "pitch": {
        const fromBpm = effect.parameters.from ?? 120;
        const toBpm = effect.parameters.to ?? 120;
        const fromRate = 1.0;
        const toRate = toBpm / fromBpm;

        await this.interpolateRate(
          targetDeckId,
          fromRate,
          toRate,
          effect.duration,
          signal,
          effect.startTime,
          totalDuration
        );
        break;
      }

      case "echo":
      case "reverb":
      case "filter":
      case "loop":
        // These effects need native audio processing.
        // For now, simulate with volume changes
        console.log(`Effect ${effect.type} planned but requires native processing`);
        break;
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
      style: null,
      progress: 0,
      elapsed: 0,
      total: 0,
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
        console.error("Transition listener error:", e);
      }
    }
  }

  // --- Utility ---

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }
}

// Singleton
export const transitionExecutor = new TransitionExecutor();
