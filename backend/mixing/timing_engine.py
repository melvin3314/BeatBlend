"""
BeatBlend Timing Engine
=======================
Handles beat-aligned timing calculations for transitions.
"""

from typing import List, Dict, Any, Optional
import numpy as np

from analysis.utils import log


class TimingEngine:
    """Beat-aligned timing calculations for DJ transitions."""

    @staticmethod
    def snap_to_beat(time_sec: float, beats: List[float]) -> float:
        """Snap a time to the nearest beat."""
        if not beats:
            return time_sec
        idx = np.argmin(np.abs(np.array(beats) - time_sec))
        return round(beats[idx], 3)

    @staticmethod
    def snap_to_downbeat(time_sec: float, downbeats: List[float]) -> float:
        """Snap to nearest downbeat (bar start)."""
        if not downbeats:
            return time_sec
        idx = np.argmin(np.abs(np.array(downbeats) - time_sec))
        return round(downbeats[idx], 3)

    @staticmethod
    def beat_duration(bpm: float) -> float:
        """Duration of one beat in seconds."""
        return 60.0 / bpm if bpm > 0 else 0.5

    @staticmethod
    def bar_duration(bpm: float, beats_per_bar: int = 4) -> float:
        """Duration of one bar in seconds."""
        return TimingEngine.beat_duration(bpm) * beats_per_bar

    @staticmethod
    def beats_to_seconds(num_beats: int, bpm: float) -> float:
        return num_beats * TimingEngine.beat_duration(bpm)

    @staticmethod
    def seconds_to_beats(seconds: float, bpm: float) -> float:
        return seconds / TimingEngine.beat_duration(bpm) if bpm > 0 else 0

    @staticmethod
    def align_beats(beats_a: List[float], beats_b: List[float],
                    exit_t: float, entry_t: float) -> Dict[str, float]:
        """Find beat-aligned exit and entry times."""
        exit_aligned = TimingEngine.snap_to_beat(exit_t, beats_a)
        entry_aligned = TimingEngine.snap_to_beat(entry_t, beats_b)
        return {"exit": exit_aligned, "entry": entry_aligned}

    @staticmethod
    def transition_timeline(exit_t: float, entry_t: float, mix_dur: float,
                            bpm_a: float, bpm_b: float) -> Dict[str, Any]:
        """Build a full transition timeline with beat markers."""
        beat_a = TimingEngine.beat_duration(bpm_a)
        beat_b = TimingEngine.beat_duration(bpm_b)

        return {
            "exitTime": round(exit_t, 3),
            "entryTime": round(entry_t, 3),
            "mixStart": round(exit_t, 3),
            "mixEnd": round(exit_t + mix_dur, 3),
            "mixDuration": round(mix_dur, 3),
            "beatsInMix": round(mix_dur / ((beat_a + beat_b) / 2), 1),
            "trackA_beatDuration": round(beat_a, 3),
            "trackB_beatDuration": round(beat_b, 3),
        }
