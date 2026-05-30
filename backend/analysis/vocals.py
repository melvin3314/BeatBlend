"""
BeatBlend Vocal Detection
=========================
Detects vocal sections using mid-frequency energy, harmonic density,
and spectral contrast heuristics. No stem separation required.
"""

from typing import List, Dict, Any
import numpy as np
import scipy.ndimage
import librosa

from .utils import log, normalize


class VocalDetector:
    """Estimates vocal sections without stem separation."""

    def __init__(self, y: np.ndarray, sr: int,
                 y_harmonic: np.ndarray = None):
        self.y = y
        self.sr = sr
        self.y_harmonic = y_harmonic if y_harmonic is not None else y
        self.sections: List[Dict[str, Any]] = []

    def analyze(self) -> "VocalDetector":
        log.info("Vocal detection starting...")
        hop = 512
        n_fft = 2048

        spec = np.abs(librosa.stft(self.y, hop_length=hop, n_fft=n_fft))
        freqs = librosa.fft_frequencies(sr=self.sr, n_fft=n_fft)
        times = librosa.frames_to_time(np.arange(spec.shape[1]), sr=self.sr, hop_length=hop)

        # Mid-frequency energy (200 Hz - 4 kHz) where vocals dominate
        mid_mask = (freqs >= 200) & (freqs <= 4000)
        mid_energy = np.sum(spec[mid_mask, :] ** 2, axis=0)
        mid_energy = normalize(mid_energy)

        # Harmonic density
        harm_spec = np.abs(librosa.stft(self.y_harmonic, hop_length=hop, n_fft=n_fft))
        harmonic_density = np.sum(harm_spec ** 2, axis=0)
        harmonic_density = normalize(harmonic_density)

        # Spectral contrast (vocals = lower contrast, denser spectrum)
        contrast = librosa.feature.spectral_contrast(y=self.y, sr=self.sr, hop_length=hop)
        mean_contrast = np.mean(contrast, axis=0)
        mean_contrast = normalize(mean_contrast)

        # Smooth
        mid_energy = scipy.ndimage.gaussian_filter1d(mid_energy, sigma=2)
        harmonic_density = scipy.ndimage.gaussian_filter1d(harmonic_density, sigma=2)
        mean_contrast = scipy.ndimage.gaussian_filter1d(mean_contrast, sigma=2)

        # Vocal likelihood score
        vocal_score = 0.5 * mid_energy + 0.3 * harmonic_density + 0.2 * (1.0 - mean_contrast)
        threshold = np.mean(vocal_score) + 0.3 * np.std(vocal_score)

        # Extract contiguous regions
        in_section = False
        sec_start = 0.0
        for i, score in enumerate(vocal_score):
            t = float(times[i])
            if score > threshold and not in_section:
                in_section = True
                sec_start = t
            elif score <= threshold and in_section:
                in_section = False
                if t - sec_start > 1.0:
                    conf = min(1.0, float(np.mean(vocal_score[max(0, i - 20):i])) * 2)
                    self.sections.append({
                        "start": round(sec_start, 2),
                        "end": round(t, 2),
                        "confidence": round(conf, 2),
                    })

        if in_section:
            t = float(times[-1])
            if t - sec_start > 1.0:
                self.sections.append({
                    "start": round(sec_start, 2),
                    "end": round(t, 2),
                    "confidence": 0.6,
                })

        log.info(f"Vocal sections: {len(self.sections)}")
        return self

    def to_dict(self) -> dict:
        return {"vocalSections": self.sections}
