import { audioEngine } from "./AudioEngine";

export type FXType = "stutter" | "tremolo" | "gate" | "scratch" | "none";

export interface FXConfig {
  type: FXType;
  intensity: number; // 0-1
  duration: number; // ms
}

/**
 * FXEngine - Simule des effets audio basiques en manipulant play/pause/volume.
 * Pas de traitement audio natif, uniquement des hacks JS.
 */
export class FXEngine {
  private timers: Set<ReturnType<typeof setInterval>> = new Set();
  private timeouts: Set<ReturnType<typeof setTimeout>> = new Set();

  abort(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.timeouts.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.timeouts.clear();
  }

  // --- STUTTER ---
  // Coupure rapide play/pause, style glitch / trance gate
  async stutter(deckId: string, duration: number = 1000, cuts: number = 8): Promise<void> {
    this.abort();

    const deck = audioEngine.getDeck(deckId);
    if (!deck || !deck.sound) return;

    const cutDuration = duration / cuts;

    for (let i = 0; i < cuts; i++) {
      const timeout = setTimeout(() => {
        deck.sound?.pause();
        const pauseTimeout = setTimeout(() => {
          deck.sound?.play();
        }, cutDuration * 0.5);
        this.timeouts.add(pauseTimeout);
      }, i * cutDuration);
      this.timeouts.add(timeout);
    }

    // Stop after duration
    const cleanup = setTimeout(() => {
      this.abort();
    }, duration + 50);
    this.timeouts.add(cleanup);
  }

  // --- TREMOLO ---
  // Volume qui oscille rapidement
  async tremolo(deckId: string, duration: number = 2000, rate: number = 8): Promise<void> {
    this.abort();

    const deck = audioEngine.getDeck(deckId);
    if (!deck || !deck.sound) return;

    const intervalMs = 1000 / rate;
    const baseVolume = deck.volume;

    const timer = setInterval(() => {
      const now = Date.now();
      const phase = (now % 1000) / 1000;
      const vol = baseVolume * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2 * rate));
      deck.sound?.setVolume(Math.max(0, Math.min(1, vol)));
    }, intervalMs);

    this.timers.add(timer);

    const cleanup = setTimeout(() => {
      this.abort();
      deck.sound?.setVolume(baseVolume);
    }, duration);
    this.timeouts.add(cleanup);
  }

  // --- GATE ---
  // Coupe le son quand l'énergie est faible (simulé)
  async gate(deckId: string, threshold: number = 0.3): Promise<() => void> {
    this.abort();

    const deck = audioEngine.getDeck(deckId);
    if (!deck || !deck.sound) return () => {};

    const baseVolume = deck.volume;
    let isGated = false;

    const timer = setInterval(() => {
      // Simule la détection de gate en fonction du volume
      // En vrai il faudrait l'énergie RMS, on simule avec une oscillation
      const now = Date.now();
      const energy = Math.sin(now / 500) > threshold ? 1 : 0;

      if (energy === 0 && !isGated) {
        deck.sound?.pause();
        isGated = true;
      } else if (energy > 0 && isGated) {
        deck.sound?.play();
        isGated = false;
      }
    }, 50);

    this.timers.add(timer);

    return () => {
      this.abort();
      deck.sound?.setVolume(baseVolume);
      if (isGated) deck.sound?.play();
    };
  }

  // --- SCRATCH ---
  // Simule un scratch DJ (seek rapide en avant/arrière)
  async scratch(deckId: string, duration: number = 800): Promise<void> {
    this.abort();

    const deck = audioEngine.getDeck(deckId);
    if (!deck || !deck.sound) return;

    const currentPos = audioEngine.getCurrentTime(deckId);
    const seeks = [0.05, -0.03, 0.04, -0.02, 0.03, -0.01];

    for (let i = 0; i < seeks.length; i++) {
      const timeout = setTimeout(() => {
        const pos = currentPos + seeks[i];
        deck.sound?.setCurrentTime(Math.max(0, pos));
      }, i * (duration / seeks.length));
      this.timeouts.add(timeout);
    }

    const cleanup = setTimeout(() => {
      this.abort();
    }, duration + 50);
    this.timeouts.add(cleanup);
  }

  // --- QUICK TRANSITION FX ---
  // Applique un FX rapide pendant une transition
  async applyTransitionFX(deckId: string, fxType: FXType, intensity: number = 0.5): Promise<void> {
    switch (fxType) {
      case "stutter":
        await this.stutter(deckId, 600 + intensity * 400, 4 + Math.round(intensity * 4));
        break;
      case "tremolo":
        await this.tremolo(deckId, 1000 + intensity * 1000, 6 + Math.round(intensity * 6));
        break;
      case "scratch":
        await this.scratch(deckId, 500 + intensity * 300);
        break;
      case "gate":
        // Gate est continu, l'appelant doit gérer le cleanup
        await this.gate(deckId, 0.3 + intensity * 0.3);
        break;
      default:
        break;
    }
  }
}

export const fxEngine = new FXEngine();
