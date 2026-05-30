"""
BeatBlend BPM Detection
=======================
Pure librosa beat tracking with enhanced confidence estimation.
No madmom dependency.
"""

from typing import List, Tuple, Optional
import numpy as np
import librosa

from .utils import log, normalize, smooth


class BpmDetector:
    """
    Detects BPM, beat positions, and downbeats using librosa.
    Enhanced with onset envelope, tempo confidence, and beat consistency scoring.
    """

    def __init__(self, y: np.ndarray, sr: int):
        self.y = y
        self.sr = sr
        self.bpm: float = 0.0
        self.beats: List[float] = []
        self.downbeats: List[float] = []
        self.bars: List[float] = []
        self.confidence: float = 0.0
        self.beat_frames: np.ndarray = np.array([], dtype=int)

    def analyze(self) -> "BpmDetector":
        log.info("BPM detection starting...")

        # 1. Onset envelope for better beat tracking
        onset_env = librosa.onset.onset_strength(
            y=self.y, sr=self.sr, hop_length=512,
        )

        # 2. Global tempo estimation
        tempo = librosa.feature.rhythm.tempo(
            onset_envelope=onset_env, sr=self.sr, hop_length=512,
        )
        self.bpm = float(tempo.item() if hasattr(tempo, "item") else tempo[0])

        # 3. Beat tracking with tightness based on tempo stability
        tempo_val, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_env, sr=self.sr, hop_length=512,
            tightness=100,  # higher = tighter to tempo
            units="frames",
        )
        self.bpm = float(tempo_val.item() if hasattr(tempo_val, "item") else tempo_val)
        self.beat_frames = beat_frames
        self.beats = [float(t) for t in librosa.frames_to_time(beat_frames, sr=self.sr, hop_length=512)]

        # 4. Downbeat estimation via dynamic programming
        self._detect_downbeats()

        # 5. Bars = downbeats
        self.bars = self.downbeats.copy()

        # 6. Confidence scoring
        self.confidence = self._compute_confidence(onset_env, beat_frames)

        log.info(f"BPM: {self.bpm:.1f} | beats={len(self.beats)} | "
                 f"downbeats={len(self.downbeats)} | conf={self.confidence:.2f}")
        return self

    def _detect_downbeats(self) -> None:
        """Estimate downbeats (first beat of each bar) using spectral flux patterns."""
        if len(self.beat_frames) < 4:
            self.downbeats = []
            return

        # Use spectral flux to find bar boundaries
        spec = np.abs(librosa.stft(self.y, hop_length=512))
        flux = np.sqrt(np.sum(np.diff(spec, axis=1) ** 2, axis=0))
        flux = np.concatenate([[0.0], flux])

        # Score each beat as a potential downbeat based on flux change
        scores = []
        for bf in self.beat_frames:
            if bf < len(flux):
                # Downbeats often have higher flux (new bar = new musical event)
                window = max(1, min(3, bf))
                local_flux = np.mean(flux[max(0, bf - window): min(len(flux), bf + window + 1)])
                scores.append(float(local_flux))

        if not scores:
            self.downbeats = []
            return

        scores = np.array(scores)
        threshold = np.mean(scores) + 0.5 * np.std(scores)

        # Every 4th beat is a strong candidate; flux peaks confirm
        for i, bf in enumerate(self.beat_frames):
            is_fourth = (i % 4 == 0)
            is_strong = scores[i] > threshold if i < len(scores) else False
            if is_fourth or is_strong:
                t = float(librosa.frames_to_time(bf, sr=self.sr, hop_length=512))
                self.downbeats.append(t)

        # Deduplicate close downbeats
        if len(self.downbeats) > 1:
            filtered = [self.downbeats[0]]
            for db in self.downbeats[1:]:
                if db - filtered[-1] > 0.3:
                    filtered.append(db)
            self.downbeats = filtered

    def _compute_confidence(self, onset_env: np.ndarray,
                            beat_frames: np.ndarray) -> float:
        """
        Compute beat confidence from:
        - Inter-beat interval consistency
        - Onset strength at beat positions
        - Tempo stability across the track
        """
        if len(beat_frames) < 2:
            return 0.3

        # 1. Interval consistency
        intervals = np.diff(beat_frames).astype(float)
        mean_interval = np.mean(intervals) + 1e-8
        cv = np.std(intervals) / mean_interval  # coefficient of variation
        consistency = max(0.0, 1.0 - cv)

        # 2. Onset strength at beat positions
        beat_onset_strength = []
        for bf in beat_frames:
            if 0 <= bf < len(onset_env):
                beat_onset_strength.append(float(onset_env[bf]))
        mean_onset = np.mean(beat_onset_strength) if beat_onset_strength else 0.0
        onset_score = min(1.0, mean_onset / (np.mean(onset_env) + 1e-8))

        # 3. Tempo stability (split track in halves, compare BPM)
        if len(beat_frames) > 20:
            mid = len(beat_frames) // 2
            bpm_first = 60.0 / (np.mean(np.diff(beat_frames[:mid])) / self.sr * 512) if mid > 1 else self.bpm
            bpm_second = 60.0 / (np.mean(np.diff(beat_frames[mid:])) / self.sr * 512) if (len(beat_frames) - mid) > 1 else self.bpm
            tempo_stability = 1.0 - min(1.0, abs(bpm_first - bpm_second) / max(self.bpm, 1.0))
        else:
            tempo_stability = 0.7

        # Weighted combination
        confidence = 0.40 * consistency + 0.35 * onset_score + 0.25 * tempo_stability
        return round(float(np.clip(confidence, 0.0, 1.0)), 3)

    def to_dict(self) -> dict:
        return {
            "bpm": round(self.bpm, 1),
            "beats": [round(b, 3) for b in self.beats],
            "downbeats": [round(d, 3) for d in self.downbeats],
            "bars": [round(b, 3) for b in self.bars],
            "confidence": self.confidence,
        }
