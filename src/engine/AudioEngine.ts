import Sound from "react-native-sound";

// Initialize audio category once at module load
Sound.setCategory("Playback");

export interface Deck {
  id: string;
  sound: Sound | null;
  uri: string | null;
  volume: number;
  rate: number;
  isPlaying: boolean;
  isLoaded: boolean;
  currentTime: number;
  duration: number;
}

export interface DeckState {
  id: string;
  uri: string | null;
  volume: number;
  rate: number;
  isPlaying: boolean;
  isLoaded: boolean;
  currentTime: number;
  duration: number;
}

export type EngineEvent =
  | { type: "deck-loaded"; deckId: string }
  | { type: "deck-playing"; deckId: string }
  | { type: "deck-paused"; deckId: string }
  | { type: "deck-ended"; deckId: string }
  | { type: "deck-error"; deckId: string; error: string }
  | { type: "position-update"; deckId: string; position: number; duration: number };

type EngineListener = (event: EngineEvent) => void;

/**
 * Core Audio Engine - Manages N audio decks dynamically.
 * Uses react-native-sound for full rate/volume/seek control.
 */
export class AudioEngine {
  private decks: Map<string, Deck> = new Map();
  private listeners: Set<EngineListener> = new Set();
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  private loops: Map<string, { start: number; end: number }> = new Map();

  constructor() {
    this.startPositionTracking();
  }

  // --- Deck Management ---

  createDeck(id: string): Deck {
    if (this.decks.has(id)) {
      this.destroyDeck(id);
    }

    const deck: Deck = {
      id,
      sound: null,
      uri: null,
      volume: 1.0,
      rate: 1.0,
      isPlaying: false,
      isLoaded: false,
      currentTime: 0,
      duration: 0,
    };

    this.decks.set(id, deck);
    return deck;
  }

  destroyDeck(id: string): void {
    const deck = this.decks.get(id);
    if (!deck) return;

    try {
      deck.sound?.stop();
      deck.sound?.release();
    } catch (e) {
      // Ignore cleanup errors
    }
    this.decks.delete(id);
  }

  getDeck(id: string): Deck | undefined {
    return this.decks.get(id);
  }

  getDeckState(id: string): DeckState | null {
    const deck = this.decks.get(id);
    if (!deck) return null;

    return {
      id: deck.id,
      uri: deck.uri,
      volume: deck.volume,
      rate: deck.rate,
      isPlaying: deck.isPlaying,
      isLoaded: deck.isLoaded,
      currentTime: deck.currentTime,
      duration: deck.duration,
    };
  }

  getAllDeckStates(): DeckState[] {
    return Array.from(this.decks.values()).map((deck) => ({
      id: deck.id,
      uri: deck.uri,
      volume: deck.volume,
      rate: deck.rate,
      isPlaying: deck.isPlaying,
      isLoaded: deck.isLoaded,
      currentTime: deck.currentTime,
      duration: deck.duration,
    }));
  }

  // --- Audio Controls ---

  async loadTrack(deckId: string, uri: string): Promise<void> {
    let deck = this.decks.get(deckId);
    if (!deck) {
      deck = this.createDeck(deckId);
    }

    // Release previous sound
    if (deck.sound) {
      deck.sound.stop();
      deck.sound.release();
      deck.sound = null;
    }

    return new Promise((resolve, reject) => {
      const sound = new Sound(uri, "", (error) => {
        if (error) {
          console.warn(`[AudioEngine] Load error on deck ${deckId}:`, error);
          this.emit({ type: "deck-error", deckId, error: String(error) });
          reject(error);
          return;
        }

        deck!.sound = sound;
        deck!.uri = uri;
        deck!.isLoaded = true;
        deck!.isPlaying = false;
        deck!.duration = sound.getDuration();

        // Apply stored volume and rate
        sound.setVolume(deck!.volume);
        sound.setSpeed(deck!.rate);

        // Prevent auto-play on Android
        sound.pause();

        this.emit({ type: "deck-loaded", deckId });
        resolve();
      });
    });
  }

  async play(deckId: string): Promise<void> {
    const deck = this.decks.get(deckId);
    if (!deck || !deck.sound) return;

    deck.sound.play((success) => {
      if (!success) {
        console.warn(`[AudioEngine] Play failed on deck ${deckId}`);
      }
    });
    deck.isPlaying = true;
    this.emit({ type: "deck-playing", deckId });
  }

  async pause(deckId: string): Promise<void> {
    const deck = this.decks.get(deckId);
    if (!deck || !deck.sound) return;

    deck.sound.pause();
    deck.isPlaying = false;
    this.emit({ type: "deck-paused", deckId });
  }

  async stop(deckId: string): Promise<void> {
    const deck = this.decks.get(deckId);
    if (!deck || !deck.sound) return;

    deck.sound.stop();
    deck.isPlaying = false;
    this.emit({ type: "deck-paused", deckId });
  }

  stopAll(): void {
    for (const [id] of this.decks) {
      this.stop(id);
    }
  }

  async seekTo(deckId: string, seconds: number): Promise<void> {
    const deck = this.decks.get(deckId);
    if (!deck || !deck.sound) return;

    deck.sound.setCurrentTime(seconds);
  }

  setVolume(deckId: string, volume: number): void {
    const deck = this.decks.get(deckId);
    if (!deck) return;

    const clamped = Math.max(0, Math.min(1, volume));
    deck.volume = clamped;
    deck.sound?.setVolume(clamped);
  }

  setRate(deckId: string, rate: number): void {
    const deck = this.decks.get(deckId);
    if (!deck) return;

    const clamped = Math.max(0.25, Math.min(4.0, rate));
    deck.rate = clamped;
    deck.sound?.setSpeed(clamped);
  }

  getRate(deckId: string): number {
    const deck = this.decks.get(deckId);
    return deck?.rate ?? 1.0;
  }

  rampRate(deckId: string, fromRate: number, toRate: number, durationMs: number): () => void {
    const deck = this.decks.get(deckId);
    if (!deck) return () => {};

    const start = Date.now();
    let cancelled = false;

    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const intervalMs = 50; // 20 Hz — smooth enough for pitch, light on CPU
    const timer = setInterval(() => {
      if (cancelled) {
        clearInterval(timer);
        return;
      }
      const elapsed = Date.now() - start;
      const linearProgress = Math.min(1, elapsed / durationMs);
      const easedProgress = easeInOutCubic(linearProgress);
      const currentRate = fromRate + (toRate - fromRate) * easedProgress;
      const clamped = Math.max(0.25, Math.min(4.0, currentRate));

      deck.sound?.setSpeed(clamped);
      deck.rate = clamped;

      if (linearProgress >= 1) {
        clearInterval(timer);
      }
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }

  getCurrentTime(deckId: string): number {
    const deck = this.decks.get(deckId);
    if (!deck) return 0;
    return deck.currentTime;
  }

  // --- Loop Control ---

  setLoop(deckId: string, start: number, end: number): void {
    this.loops.set(deckId, { start, end });
    console.log(`[AudioEngine] Loop set on ${deckId}: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
  }

  clearLoop(deckId: string): void {
    this.loops.delete(deckId);
    console.log(`[AudioEngine] Loop cleared on ${deckId}`);
  }

  isLooping(deckId: string): boolean {
    return this.loops.has(deckId);
  }

  getLoop(deckId: string): { start: number; end: number } | null {
    return this.loops.get(deckId) ?? null;
  }

  getDuration(deckId: string): number {
    const deck = this.decks.get(deckId);
    if (!deck) return 0;
    return deck.duration;
  }

  // --- Event System ---

  on(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error("Engine listener error:", e);
      }
    }
  }

  // --- Position Tracking ---

  private startPositionTracking(): void {
    this.positionTimer = setInterval(() => {
      for (const [deckId, deck] of this.decks) {
        if (!deck.sound || !deck.isPlaying) continue;

        deck.sound.getCurrentTime((seconds) => {
          deck.currentTime = seconds;
          const duration = deck.duration;

          // --- LOOP HANDLING (smoothed) ---
          const loop = this.loops.get(deckId);
          if (loop && seconds >= loop.end - 0.05) {
            const originalVol = deck.volume;
            // Jump 50ms before end to 30ms after start for smoother transition
            const jumpTarget = loop.start + 0.03;
            
            // Brief volume duck to mask the jump (20ms fade out/in)
            deck.sound?.setVolume(originalVol * 0.3);
            deck.sound?.setCurrentTime(jumpTarget);
            deck.currentTime = jumpTarget;
            
            // Restore volume after a tiny delay
            setTimeout(() => {
              deck.sound?.setVolume(originalVol);
            }, 40);
            
            this.emit({
              type: "position-update",
              deckId,
              position: jumpTarget,
              duration,
            });
            return;
          }

          this.emit({
            type: "position-update",
            deckId,
            position: seconds,
            duration,
          });

          // Detect track end
          if (duration > 0 && seconds >= duration - 0.2) {
            deck.isPlaying = false;
            this.emit({ type: "deck-ended", deckId });
          }
        });
      }
    }, 100);
  }

  // --- Cleanup ---

  destroy(): void {
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }

    for (const [id] of this.decks) {
      this.destroyDeck(id);
    }

    this.listeners.clear();
  }
}

// Singleton
export const audioEngine = new AudioEngine();
