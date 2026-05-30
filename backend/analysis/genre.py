"""
BeatBlend Genre Classification
==============================
Heuristic genre detection from BPM, spectral features, and rhythmic patterns.
"""

from typing import Dict, Tuple
import numpy as np
import librosa

from .utils import log


class GenreClassifier:
    """Multi-feature heuristic genre classification."""

    GENRES: Dict[str, Tuple[int, int]] = {
        "lofi": (60, 90), "reggae": (60, 90), "house": (118, 130),
        "techno": (120, 140), "hard techno": (140, 160), "afro": (90, 120),
        "pop": (90, 130), "edm": (126, 150), "rap": (70, 110),
        "trap": (130, 180), "rage": (140, 180), "phonk": (120, 150),
        "drill": (130, 160), "hyperpop": (120, 160),
    }

    def __init__(self, y: np.ndarray, sr: int, bpm: float,
                 mean_rms: float = 0, mean_bass: float = 0,
                 mean_centroid: float = 0, mean_onset: float = 0):
        self.y = y
        self.sr = sr
        self.bpm = bpm
        self.mean_rms = mean_rms
        self.mean_bass = mean_bass
        self.mean_centroid = mean_centroid
        self.mean_onset = mean_onset
        self.genre: str = "unknown"
        self.confidence: float = 0.0

    def analyze(self) -> "GenreClassifier":
        log.info("Genre classification starting...")
        spec = np.abs(librosa.stft(self.y))
        freqs = librosa.fft_frequencies(sr=self.sr)
        bass_mask = freqs <= 250
        bass_ratio = np.mean(np.sum(spec[bass_mask, :] ** 2, axis=0)) / (np.mean(np.sum(spec ** 2, axis=0)) + 1e-8)

        centroid = float(np.mean(librosa.feature.spectral_centroid(y=self.y, sr=self.sr)[0]))
        onset_env = librosa.onset.onset_strength(y=self.y, sr=self.sr)
        density = float(np.mean(onset_env))

        onsets = librosa.onset.onset_detect(y=self.y, sr=self.sr, units="frames")
        swing = 0.0
        if len(onsets) > 10:
            intervals = np.diff(onsets).astype(float)
            ratios = intervals[:-1] / (intervals[1:] + 1e-8)
            triplet = np.sum((np.abs(ratios - 0.667) < 0.1) | (np.abs(ratios - 1.5) < 0.1))
            swing = triplet / len(ratios) if len(ratios) > 0 else 0.0

        scores = {}
        for g, (lo, hi) in self.GENRES.items():
            s = 0.35 if lo <= self.bpm <= hi else max(0, 0.35 - min(abs(self.bpm - lo), abs(self.bpm - hi)) * 0.01)
            if g in ("trap", "phonk", "drill", "rage"):
                s += bass_ratio * 0.25
            elif g in ("techno", "hard techno", "house"):
                s += bass_ratio * 0.15 + (0.1 if centroid > 2000 else 0)
            elif g == "reggae":
                s += bass_ratio * 0.20 + swing * 0.20
            elif g == "afro":
                s += swing * 0.25 + bass_ratio * 0.10
            elif g == "hyperpop":
                s += (0.2 if centroid > 3000 else 0) + density * 0.10
            elif g == "lofi":
                s += (0.25 if density < 0.3 else 0) + (0.15 if centroid < 3000 else 0)
            else:
                s += bass_ratio * 0.10 + density * 0.10
            if g in ("hyperpop", "edm"):
                s += (centroid / 8000) * 0.10
            if g == "hard techno":
                s += density * 0.15
            scores[g] = s

        if scores:
            self.genre = max(scores, key=scores.get)
            self.confidence = round(min(1.0, scores[self.genre]), 2)

        log.info(f"Genre: {self.genre} (conf={self.confidence})")
        return self

    def to_dict(self) -> dict:
        return {"genre": self.genre, "confidence": self.confidence}
