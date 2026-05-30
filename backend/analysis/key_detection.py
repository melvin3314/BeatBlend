"""
BeatBlend Key Detection
=======================
Krumhansl-Kessler tonal profile matching + Camelot wheel conversion.
"""

import numpy as np
import librosa
from .utils import log


class KeyDetector:
    """Estimates musical key and Camelot notation from chroma features."""

    MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"]
    CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]

    def __init__(self, y: np.ndarray, sr: int):
        self.y = y
        self.sr = sr
        self.key: str = "Unknown"
        self.camelot: str = "?"
        self.confidence: float = 0.0

    def analyze(self) -> "KeyDetector":
        log.info("Key detection starting...")
        chroma = librosa.feature.chroma_cqt(y=self.y, sr=self.sr, bins_per_octave=36)
        chroma_avg = np.mean(chroma, axis=1)

        major_corr = np.array([np.corrcoef(np.roll(chroma_avg, -i), self.MAJOR_PROFILE)[0, 1] for i in range(12)])
        minor_corr = np.array([np.corrcoef(np.roll(chroma_avg, -i), self.MINOR_PROFILE)[0, 1] for i in range(12)])

        best_major = int(np.argmax(major_corr))
        best_minor = int(np.argmax(minor_corr))

        if major_corr[best_major] > minor_corr[best_minor]:
            self.key = f"{self.KEYS[best_major]} major"
            self.camelot = self.CAMELOT_MAJOR[best_major]
            self.confidence = float(np.clip((major_corr[best_major] + 1) / 2, 0.0, 1.0))
        else:
            self.key = f"{self.KEYS[best_minor]} minor"
            self.camelot = self.CAMELOT_MINOR[best_minor]
            self.confidence = float(np.clip((minor_corr[best_minor] + 1) / 2, 0.0, 1.0))

        log.info(f"Key: {self.key} | Camelot: {self.camelot} | conf={self.confidence:.2f}")
        return self

    def to_dict(self) -> dict:
        return {"key": self.key, "camelot": self.camelot, "confidence": round(self.confidence, 3)}
