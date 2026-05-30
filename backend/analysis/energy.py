"""
BeatBlend Energy Analysis
=========================
Multi-feature composite energy curve: RMS, spectral flux, bass intensity,
onset density, and spectral centroid.
"""

from typing import List, Dict, Any
import numpy as np
import librosa
from .utils import log, normalize


class EnergyAnalyzer:
    """Computes a composite energy curve from multiple audio features."""

    def __init__(self, y: np.ndarray, sr: int):
        self.y = y
        self.sr = sr
        self.curve: List[Dict[str, Any]] = []
        self.mean_rms: float = 0.0
        self.mean_centroid: float = 0.0
        self.mean_flux: float = 0.0
        self.mean_bass: float = 0.0
        self.mean_onset: float = 0.0
        self.transient_density: float = 0.0

    def analyze(self) -> "EnergyAnalyzer":
        log.info("Energy analysis starting...")
        hop = 512
        n_fft = 2048

        rms = librosa.feature.rms(y=self.y, hop_length=hop, frame_length=n_fft)[0]
        centroid = librosa.feature.spectral_centroid(y=self.y, sr=self.sr, hop_length=hop)[0]

        spec = np.abs(librosa.stft(self.y, hop_length=hop, n_fft=n_fft))
        flux = np.sqrt(np.sum(np.diff(spec, axis=1) ** 2, axis=0))
        flux = np.concatenate([[0.0], flux])

        bass_bins = int(250 / (self.sr / 2) * spec.shape[0])
        bass_energy = np.sum(spec[:bass_bins, :] ** 2, axis=0)

        onset_env = librosa.onset.onset_strength(y=self.y, sr=self.sr, hop_length=hop)

        onsets_t = librosa.onset.onset_detect(y=self.y, sr=self.sr, hop_length=hop, units="time")
        dur = len(self.y) / self.sr
        self.transient_density = len(onsets_t) / dur if dur > 0 else 0.0

        times = librosa.frames_to_time(np.arange(len(rms)), sr=self.sr, hop_length=hop)

        rms_n = normalize(rms)
        cent_n = normalize(centroid)
        flux_n = normalize(flux)
        bass_n = normalize(bass_energy)
        onset_n = normalize(onset_env)

        for i, t in enumerate(times):
            val = (
                0.30 * (rms_n[i] if i < len(rms_n) else 0)
                + 0.15 * (cent_n[i] if i < len(cent_n) else 0)
                + 0.20 * (flux_n[i] if i < len(flux_n) else 0)
                + 0.20 * (bass_n[i] if i < len(bass_n) else 0)
                + 0.15 * (onset_n[i] if i < len(onset_n) else 0)
            )
            self.curve.append({
                "time": round(float(t), 3),
                "value": round(float(val), 3),
                "level": self._level(val),
                "rms": round(float(rms[i]) if i < len(rms) else 0.0, 6),
            })

        self.mean_rms = float(np.mean(rms))
        self.mean_centroid = float(np.mean(centroid))
        self.mean_flux = float(np.mean(flux))
        self.mean_bass = float(np.mean(bass_energy))
        self.mean_onset = float(np.mean(onset_env))

        log.info(f"Energy: {len(self.curve)} frames | transient_density={self.transient_density:.2f}")
        return self

    @staticmethod
    def _level(v: float) -> str:
        if v < 0.3: return "low"
        if v < 0.55: return "medium"
        if v < 0.8: return "high"
        return "explosive"

    def values(self) -> np.ndarray:
        return np.array([e["value"] for e in self.curve])

    def times(self) -> np.ndarray:
        return np.array([e["time"] for e in self.curve])

    def to_dict(self) -> dict:
        return {
            "energyCurve": self.curve,
            "meanRms": round(self.mean_rms, 6),
            "meanCentroid": round(self.mean_centroid, 2),
            "meanFlux": round(self.mean_flux, 4),
            "meanBass": round(self.mean_bass, 4),
            "meanOnset": round(self.mean_onset, 4),
            "transientDensity": round(self.transient_density, 3),
        }
