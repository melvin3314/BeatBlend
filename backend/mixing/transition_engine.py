"""
BeatBlend Transition Engine
===========================
Orchestrates full transition planning between two tracks.
Combines scoring, point finding, crossfade selection, and timing.
"""

from typing import Dict, Any, List, Optional
import numpy as np

from analysis.utils import log
from analysis.transition_points import TransitionPointFinder
from .crossfade_engine import CrossfadeEngine, CrossfadeType
from .timing_engine import TimingEngine


class TransitionEngine:
    """
    Plans a complete DJ transition between two tracks.
    Returns everything the frontend needs to execute the mix.
    """

    def __init__(self, analysis_a: Dict[str, Any], analysis_b: Dict[str, Any]):
        self.a = analysis_a
        self.b = analysis_b

    def plan(self) -> Dict[str, Any]:
        """Generate a full transition plan."""
        log.info("Planning transition...")

        # 1. Find best transition points
        finder = TransitionPointFinder(self.a, self.b)
        points = finder.find()
        all_points = finder.find_all(top_n=3)

        exit_t = points["trackA_exit"]
        entry_t = points["trackB_entry"]
        mix_dur = points["mix_duration"]

        # 2. Beat-align the points
        beats_a = self.a.get("beats", [])
        beats_b = self.b.get("beats", [])
        aligned = TimingEngine.align_beats(beats_a, beats_b, exit_t, entry_t)
        exit_t = aligned["exit"]
        entry_t = aligned["entry"]

        # 3. Select crossfade type
        crossfade = CrossfadeEngine.select(self.a, self.b, exit_t, entry_t, mix_dur)
        ctype = CrossfadeType(crossfade["type"])

        # 4. Generate volume curves
        curves = CrossfadeEngine.volume_curve(ctype, mix_dur)

        # 5. Build timeline
        timeline = TimingEngine.transition_timeline(
            exit_t, entry_t, mix_dur,
            self.a.get("bpm", 120), self.b.get("bpm", 120),
        )

        # 6. Pre-transition preparation (what to do before the mix)
        prep = self._preparation(exit_t, entry_t)

        plan = {
            "transition": {
                "trackA_exit": exit_t,
                "trackB_entry": entry_t,
                "mix_duration": mix_dur,
                "confidence": points["confidence"],
            },
            "crossfade": {
                "type": crossfade["type"],
                "reasons": crossfade["reasons"],
                "volumeCurve": curves,
            },
            "timeline": timeline,
            "preparation": prep,
            "alternatives": all_points,
        }

        log.info(f"Transition plan: {crossfade['type']} | "
                 f"exit={exit_t}s entry={entry_t}s mix={mix_dur}s")
        return plan

    def _preparation(self, exit_t: float, entry_t: float) -> Dict[str, Any]:
        """Instructions for the frontend to prepare the transition."""
        return {
            "preloadTrackB": True,
            "trackB_startOffset": entry_t,
            "monitorTrackA_position": exit_t - 5.0,  # warn 5s before exit
            "recommendedActions": [
                f"Preload Track B at offset {entry_t:.1f}s",
                f"Start crossfade when Track A reaches {exit_t:.1f}s",
            ],
        }
