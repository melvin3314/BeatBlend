"""
BeatBlend Song Structure Detection
==================================
Detects intro, buildup, drop, breakdown, chorus, outro using
self-similarity matrix, spectral contrast, novelty detection, and energy evolution.

Also detects REAL_START and REAL_END — the actual musical boundaries
ignoring silence, ambient intros, and dead outros.
"""

from typing import List, Dict, Any, Tuple, Optional
import numpy as np
import scipy.signal
import scipy.ndimage
import librosa

from .utils import log, normalize, smooth, segment_mean
from .bpm import BpmDetector
from .energy import EnergyAnalyzer


class StructureAnalyzer:
    """
    Detects musical structure sections and phrases.
    No fixed percentage rules — purely data-driven.
    """

    def __init__(self, y: np.ndarray, sr: int,
                 energy: EnergyAnalyzer, bpm: BpmDetector):
        self.y = y
        self.sr = sr
        self.energy = energy
        self.bpm = bpm
        self.duration = len(y) / sr

        self.sections: List[Dict[str, Any]] = []
        self.phrases: List[Dict[str, Any]] = []
        self.breakdowns: List[Dict[str, Any]] = []
        self.real_start: float = 0.0
        self.real_end: float = 0.0
        self.confidence: float = 0.0

    def analyze(self) -> "StructureAnalyzer":
        log.info("Structure detection starting...")

        # 1. Detect real musical boundaries first
        self._detect_real_boundaries()

        # 2. Multi-feature segmentation
        boundaries = self._segment()

        # 3. Classify each segment
        self._classify_sections(boundaries)

        # 4. Detect phrases
        self._detect_phrases()

        # 5. Confidence
        self.confidence = 0.75 if len(self.sections) >= 3 else 0.5

        log.info(f"Structure: {len(self.sections)} sections | "
                 f"real_start={self.real_start:.1f}s | real_end={self.real_end:.1f}s | "
                 f"phrases={len(self.phrases)}")
        return self

    # ------------------------------------------------------------------
    # REAL_START / REAL_END detection
    # ------------------------------------------------------------------

    def _detect_real_boundaries(self) -> None:
        """
        Find where the music actually starts and ends.
        Uses: silence detection, energy threshold, first beat, spectral activity.
        """
        hop = 512
        rms = librosa.feature.rms(y=self.y, hop_length=hop)[0]
        rms_db = librosa.amplitude_to_db(rms, ref=np.max)
        times = librosa.frames_to_time(np.arange(len(rms)), sr=self.sr, hop_length=hop)

        # Silence threshold: frames below -40 dB are silent
        silence_mask = rms_db < -40
        rms_norm = normalize(rms)

        # --- REAL_START ---
        # Find first sustained musical activity
        min_activity_frames = int(0.5 * self.sr / hop)  # 0.5s sustained
        activity = rms_norm > 0.02  # very low threshold to catch quiet intros

        start_frame = 0
        for i in range(len(activity) - min_activity_frames):
            if np.all(activity[i:i + min_activity_frames]):
                start_frame = i
                break

        # Also check first beat position
        if len(self.bpm.beats) > 0:
            first_beat = self.bpm.beats[0]
            # Don't let first beat pull us too far back if there's real silence
            if first_beat < times[start_frame] + 2.0:
                start_frame = max(0, int(first_beat * self.sr / hop) - int(0.5 * self.sr / hop))

        self.real_start = round(float(times[start_frame]) if start_frame < len(times) else 0.0, 2)

        # --- REAL_END ---
        # Find last sustained musical activity
        end_frame = len(activity) - 1
        for i in range(len(activity) - 1, min_activity_frames, -1):
            if np.all(activity[i - min_activity_frames:i]):
                end_frame = i
                break

        self.real_end = round(float(times[end_frame]) if end_frame < len(times) else self.duration, 2)

        # Sanity: real_end must be > real_start
        if self.real_end <= self.real_start + 5.0:
            self.real_start = 0.0
            self.real_end = self.duration

        log.info(f"Real boundaries: start={self.real_start:.1f}s, end={self.real_end:.1f}s "
                 f"(raw duration={self.duration:.1f}s)")

    # ------------------------------------------------------------------
    # Segmentation
    # ------------------------------------------------------------------

    def _segment(self) -> np.ndarray:
        """Multi-feature agglomerative segmentation + novelty curve."""
        hop = 512

        mfcc = librosa.feature.mfcc(y=self.y, sr=self.sr, n_mfcc=13)
        chroma = librosa.feature.chroma_cqt(y=self.y, sr=self.sr)
        contrast = librosa.feature.spectral_contrast(y=self.y, sr=self.sr)
        rms = librosa.feature.rms(y=self.y)
        features = np.vstack([mfcc, chroma, contrast, rms])

        # Z-score normalize
        features = np.nan_to_num(features, nan=0.0)
        std = np.std(features, axis=1, keepdims=True) + 1e-8
        features = (features - np.mean(features, axis=1, keepdims=True)) / std

        # Agglomerative clustering
        try:
            k = max(2, min(12, features.shape[1] // 15))
            bound_frames = librosa.segment.agglomerative(features, k=k)
            bound_times = librosa.frames_to_time(bound_frames, sr=self.sr, hop_length=hop)
        except Exception as e:
            log.warning(f"Agglomerative segmentation failed: {e}")
            bound_times = np.array([])

        # Novelty curve for additional boundaries
        try:
            S = librosa.feature.melspectrogram(y=self.y, sr=self.sr, hop_length=hop)
            S_db = librosa.power_to_db(S, ref=np.max)
            novelty = self._novelty_curve(S_db)
            novelty_peaks = self._find_novelty_peaks(novelty, hop)
        except Exception:
            novelty_peaks = np.array([])

        # Merge all boundaries
        all_bounds = sorted(set(
            [self.real_start, self.real_end] +
            list(bound_times) +
            list(novelty_peaks)
        ))
        # Filter to [real_start, real_end]
        all_bounds = [b for b in all_bounds if self.real_start <= b <= self.real_end]

        return np.array(all_bounds)

    def _novelty_curve(self, S_db: np.ndarray) -> np.ndarray:
        """Compute novelty curve from self-similarity matrix."""
        # Gaussian checkerboard kernel
        L = 32
        kernel = np.zeros((L, L))
        center = L // 2
        for i in range(L):
            for j in range(L):
                if (i < center and j >= center) or (i >= center and j < center):
                    dist = (i - center) ** 2 + (j - center) ** 2
                    kernel[i, j] = np.exp(-dist / (2 * (L / 4) ** 2))

        novelty = scipy.signal.convolve2d(S_db, kernel, mode="same", boundary="symm")
        novelty = np.diag(novelty)
        novelty = np.maximum(0, novelty)
        return novelty / (np.max(novelty) + 1e-8)

    def _find_novelty_peaks(self, novelty: np.ndarray, hop: int) -> np.ndarray:
        """Find peaks in novelty curve (min 3s apart)."""
        dist = int(3.0 * self.sr / hop)
        peaks, props = scipy.signal.find_peaks(novelty, distance=max(1, dist), prominence=0.1)
        if len(peaks) == 0:
            return np.array([])
        return librosa.frames_to_time(peaks, sr=self.sr, hop_length=hop)

    # ------------------------------------------------------------------
    # Section classification
    # ------------------------------------------------------------------

    def _classify_sections(self, boundaries: np.ndarray) -> None:
        """Classify each segment as intro/build/drop/breakdown/chorus/outro."""
        if len(boundaries) < 2:
            return

        ev = self.energy.values()
        et = self.energy.times()

        # Kick density
        hop = 512
        spec = np.abs(librosa.stft(self.y, hop_length=hop))
        bass_bins = int(250 / (self.sr / 2) * spec.shape[0])
        kick = np.sum(spec[:bass_bins, :] ** 2, axis=0)
        kick = normalize(kick)
        kick_t = librosa.frames_to_time(np.arange(len(kick)), sr=self.sr, hop_length=hop)

        # Spectral flux
        flux = np.sqrt(np.sum(np.diff(spec, axis=1) ** 2, axis=0))
        flux = np.concatenate([[0.0], flux])
        flux = normalize(flux)
        flux_t = librosa.frames_to_time(np.arange(len(flux)), sr=self.sr, hop_length=hop)

        all_vals = ev
        e_high = float(np.percentile(all_vals, 75)) if len(all_vals) else 0.6
        e_low = float(np.percentile(all_vals, 25)) if len(all_vals) else 0.3

        self.sections = []
        for i in range(len(boundaries) - 1):
            start = float(boundaries[i])
            end = float(boundaries[i + 1])
            if end - start < 0.5:
                continue

            e_mean = segment_mean(ev, et, start, end)
            k_mean = segment_mean(kick, kick_t, start, end)
            f_mean = segment_mean(flux, flux_t, start, end)

            label = self._classify(start, end, e_mean, k_mean, f_mean, e_high, e_low)

            self.sections.append({
                "start": round(start, 2),
                "end": round(end, 2),
                "type": label,
                "energy": round(e_mean, 3),
                "kickDensity": round(k_mean, 3),
            })

        # Breakdowns
        self.breakdowns = [
            {"start": s["start"], "end": s["end"], "confidence": 0.75}
            for s in self.sections if s["type"] == "breakdown"
        ]

    def _classify(self, start: float, end: float, e_mean: float,
                  k_mean: float, f_mean: float,
                  e_high: float, e_low: float) -> str:
        """Classify a single segment."""
        # Intro: near real_start, low energy
        if start <= self.real_start + self.duration * 0.08 and e_mean < e_high:
            return "intro"

        # Outro: near real_end, low energy
        if end >= self.real_end - self.duration * 0.08 and e_mean < e_high:
            return "outro"

        # Drop: high energy + strong kick
        if e_mean > e_high and k_mean > 0.5:
            return "drop"

        # Breakdown: low energy + very low kick
        if e_mean < e_low and k_mean < 0.3:
            return "breakdown"

        # Build: rising energy trajectory
        ev_seg = self.energy.values()
        et_seg = self.energy.times()
        mask = (et_seg >= start) & (et_seg <= end)
        seg_vals = ev_seg[mask]
        if len(seg_vals) > 3 and seg_vals[-1] > seg_vals[0] * 1.25 and e_mean > e_low:
            return "build"

        # Chorus: high energy but less kick than drop
        if e_mean > e_high:
            return "chorus"

        return "verse"

    # ------------------------------------------------------------------
    # Phrase detection
    # ------------------------------------------------------------------

    def _detect_phrases(self) -> None:
        """Detect musical phrases from structure boundaries and beat grid."""
        beat_period = 60.0 / self.bpm.bpm if self.bpm.bpm > 0 else 0.5
        min_phrase = beat_period * 4  # at least 4 beats

        # Use section boundaries as phrase boundaries
        for s in self.sections:
            dur = s["end"] - s["start"]
            if dur >= min_phrase:
                self.phrases.append({
                    "start": s["start"],
                    "end": s["end"],
                    "confidence": 0.7,
                })

        # If no phrases from sections, use beat grid
        if not self.phrases and self.bpm.bpm > 0 and len(self.bpm.beats) > 16:
            for i in range(0, len(self.bpm.beats) - 4, 16):
                s = self.bpm.beats[i]
                e = self.bpm.beats[min(i + 16, len(self.bpm.beats) - 1)]
                self.phrases.append({"start": round(s, 2), "end": round(e, 2), "confidence": 0.5})

    def to_dict(self) -> dict:
        return {
            "sections": self.sections,
            "phrases": self.phrases,
            "breakdowns": self.breakdowns,
            "realStart": self.real_start,
            "realEnd": self.real_end,
            "confidence": round(self.confidence, 2),
        }
