"""
BeatBlend Audio Utilities
=========================
Audio loading, logging, caching, and JSON encoding.
Zero madmom — pure librosa + numpy + soundfile stack.
"""

import os
import json
import logging
import hashlib
import tempfile
from pathlib import Path
from typing import Optional, Tuple, Any, Dict
from datetime import datetime

import numpy as np
import soundfile as sf


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging(name: str = "BeatBlend", level: int = logging.INFO) -> logging.Logger:
    """Configure a logger with consistent formatting."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        ))
        logger.addHandler(handler)
    logger.setLevel(level)
    return logger


log = setup_logging("BeatBlend.Analysis")


# ---------------------------------------------------------------------------
# JSON Encoding (numpy-safe)
# ---------------------------------------------------------------------------

class NumpyEncoder(json.JSONEncoder):
    """JSON encoder that converts numpy types to native Python types."""

    def default(self, obj: Any) -> Any:
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.floating, np.float16, np.float32, np.float64)):
            return float(obj)
        if isinstance(obj, (np.integer, np.int16, np.int32, np.int64)):
            return int(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        return super().default(obj)


def safe_json_dumps(data: Any, **kwargs) -> str:
    """Dump data to JSON string with numpy support."""
    return json.dumps(data, cls=NumpyEncoder, ensure_ascii=False, **kwargs)


# ---------------------------------------------------------------------------
# Audio Loading
# ---------------------------------------------------------------------------

class AudioLoader:
    """
    Loads audio files with robust error handling.
    Supports mp3, wav, flac, ogg, m4a via soundfile + librosa.
    """

    SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aiff", ".aif"}

    def __init__(self, filepath: str, sr: int = 22050, max_duration: Optional[float] = None):
        self.filepath = filepath
        self.sr = sr
        self.max_duration = max_duration
        self.y: np.ndarray = np.array([])
        self.duration: float = 0.0
        self.y_harmonic: Optional[np.ndarray] = None
        self.y_percussive: Optional[np.ndarray] = None
        self._load()

    def _load(self) -> None:
        ext = Path(self.filepath).suffix.lower()
        if ext not in self.SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported audio format: {ext}")

        log.info(f"Loading: {self.filepath}")

        # Suppress libmpg123 stderr noise (bad ID3 tags are harmless)
        old_stderr = os.dup(2)
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, 2)
        os.close(devnull)
        try:
            import librosa
            self.y, self.sr = librosa.load(
                self.filepath,
                sr=self.sr,
                mono=True,
                duration=self.max_duration,
            )
            self.duration = float(len(self.y)) / self.sr

            # Harmonic-percussive separation
            self.y_harmonic, self.y_percussive = librosa.effects.hpss(self.y)
        finally:
            os.dup2(old_stderr, 2)
            os.close(old_stderr)

        log.info(f"Loaded: {self.duration:.1f}s @ {self.sr}Hz, "
                 f"shape={self.y.shape}")

    @property
    def harmonic(self) -> np.ndarray:
        return self.y_harmonic if self.y_harmonic is not None else self.y

    @property
    def percussive(self) -> np.ndarray:
        return self.y_percussive if self.y_percussive is not None else self.y


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def file_hash(filepath: str, algo: str = "md5") -> str:
    """Compute a hash of a file for cache keys."""
    h = hashlib.new(algo)
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def temp_filepath(prefix: str = "beatblend_", suffix: str = ".tmp") -> str:
    """Create a temporary file path."""
    return os.path.join(tempfile.gettempdir(), f"{prefix}{os.getpid()}_{int(datetime.now().timestamp() * 1000)}{suffix}")


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def normalize(arr: np.ndarray) -> np.ndarray:
    """Min-max normalize an array to [0, 1]."""
    mn, mx = np.min(arr), np.max(arr)
    denom = mx - mn
    if denom < 1e-10:
        return np.zeros_like(arr)
    return (arr - mn) / denom


def smooth(arr: np.ndarray, window: int = 5) -> np.ndarray:
    """Apply a simple moving average smooth."""
    if window < 2 or len(arr) < window:
        return arr
    return np.convolve(arr, np.ones(window) / window, mode="same")


def frames_to_time(frames: np.ndarray, sr: int, hop_length: int = 512) -> np.ndarray:
    """Convert frame indices to time in seconds."""
    import librosa
    return librosa.frames_to_time(frames, sr=sr, hop_length=hop_length)


def time_to_frames(seconds: float, sr: int, hop_length: int = 512) -> int:
    """Convert seconds to frame index."""
    return int(seconds * sr / hop_length)


def segment_mean(feature: np.ndarray, times: np.ndarray,
                 start: float, end: float) -> float:
    """Mean of a feature within a time window."""
    mask = (times >= start) & (times < end)
    if not np.any(mask):
        return 0.0
    return float(np.mean(feature[mask]))


def find_peaks_safe(arr: np.ndarray, distance: int = 10,
                    prominence: float = 0.05) -> np.ndarray:
    """Find peaks with fallback for short arrays."""
    from scipy.signal import find_peaks
    if len(arr) < 3:
        return np.array([], dtype=int)
    dist = min(distance, max(1, len(arr) // 2))
    peaks, _ = find_peaks(arr, distance=dist, prominence=prominence)
    return peaks
