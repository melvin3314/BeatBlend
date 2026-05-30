"""
BeatBlend Phrase Detection
==========================
Detects musical phrases from structure boundaries, beat grid,
energy shifts, and spectral changes.
"""

from typing import List, Dict, Any
import numpy as np
import librosa

from .utils import log


class PhraseDetector:
    """
    Detects musical phrases — natural boundaries where transitions feel right.
    Uses structure boundaries, beat multiples, energy shifts, and novelty.
    """

    def __init__(self, y: np.ndarray, sr: int,
                 bpm: float, beats: List[float],
                 sections: List[Dict], energy_curve: List[Dict]):
        self.y = y
        self.sr = sr
        self.bpm = bpm
        self.beats = beats
        self.sections = sections
        self.energy_curve = energy_curve
        self.phrases: List[Dict[str, Any]] = []

    def analyze(self) -> "PhraseDetector":
        log.info("Phrase detection starting...")
        beat_period = 60.0 / self.bpm if self.bpm > 0 else 0.5
        min_phrase = beat_period * 4
        max_phrase = beat_period * 32

        candidates: List[Dict] = []

        # 1. Section boundaries are natural phrase boundaries
        for s in self.sections:
            dur = s["end"] - s["start"]
            if min_phrase <= dur <= max_phrase:
                candidates.append({
                    "start": s["start"], "end": s["end"],
                    "confidence": 0.75, "source": "section",
                })

        # 2. Energy shift boundaries
        ev = np.array([e["value"] for e in self.energy_curve])
        et = np.array([e["time"] for e in self.energy_curve])
        if len(ev) > 10:
            energy_diff = np.abs(np.diff(ev))
            threshold = np.mean(energy_diff) + 1.5 * np.std(energy_diff)
            shift_frames = np.where(energy_diff > threshold)[0]
            for sf in shift_frames:
                t = float(et[min(sf + 1, len(et) - 1)])
                # Find nearest beat
                nearest_beat = min(self.beats, key=lambda b: abs(b - t))
                if nearest_beat not in [c["start"] for c in candidates]:
                    # Extend to next significant boundary
                    end_t = t + beat_period * 8
                    candidates.append({
                        "start": round(nearest_beat, 2),
                        "end": round(min(end_t, et[-1]), 2),
                        "confidence": 0.60, "source": "energy_shift",
                    })

        # 3. Beat-grid phrases (every 8-16 beats)
        if not candidates and len(self.beats) > 16:
            for i in range(0, len(self.beats) - 8, 8):
                s = self.beats[i]
                e = self.beats[min(i + 8, len(self.beats) - 1)]
                if e - s >= min_phrase:
                    candidates.append({
                        "start": round(s, 2), "end": round(e, 2),
                        "confidence": 0.45, "source": "beat_grid",
                    })

        # 4. Novelty-based boundaries
        try:
            novelty_peaks = self._novelty_boundaries()
            for t in novelty_peaks:
                candidates.append({
                    "start": round(t, 2),
                    "end": round(t + beat_period * 8, 2),
                    "confidence": 0.55, "source": "novelty",
                })
        except Exception as e:
            log.warning(f"Novelty detection skipped: {e}")

        # Deduplicate and sort
        candidates.sort(key=lambda c: (c["start"], -c["confidence"]))
        self.phrases = []
        last_end = -1.0
        for c in candidates:
            if c["start"] >= last_end - 1.0:
                self.phrases.append(c)
                last_end = c["end"]

        log.info(f"Phrases detected: {len(self.phrases)}")
        return self

    def _novelty_boundaries(self) -> np.ndarray:
        """Find boundaries via self-similarity novelty."""
        import scipy.signal
        hop = 512
        S = librosa.feature.melspectrogram(y=self.y, sr=self.sr, hop_length=hop)
        S_db = librosa.power_to_db(S, ref=np.max)

        L = 32
        kernel = np.zeros((L, L))
        c = L // 2
        for i in range(L):
            for j in range(L):
                if (i < c and j >= c) or (i >= c and j < c):
                    d = (i - c) ** 2 + (j - c) ** 2
                    kernel[i, j] = np.exp(-d / (2 * (L / 4) ** 2))

        novelty = scipy.signal.convolve2d(S_db, kernel, mode="same", boundary="symm")
        novelty = np.diag(novelty)
        novelty = np.maximum(0, novelty)
        novelty = novelty / (np.max(novelty) + 1e-8)

        dist = int(3.0 * self.sr / hop)
        peaks, _ = scipy.signal.find_peaks(novelty, distance=max(1, dist), prominence=0.08)
        return librosa.frames_to_time(peaks, sr=self.sr, hop_length=hop)

    def to_dict(self) -> dict:
        return {"phrases": self.phrases}
