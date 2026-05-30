"""
BeatBlend Crossfade Engine
==========================
Defines and selects crossfade types for DJ transitions.
"""

from typing import Dict, Any, List
from enum import Enum
import numpy as np

from analysis.utils import log


class CrossfadeType(Enum):
    SMOOTH = "smooth_fade"
    FAST_CUT = "fast_cut"
    CINEMATIC = "cinematic_fade"
    BUILDUP = "buildup_transition"
    DROP_SWITCH = "drop_switch"
    ENERGY_SWAP = "energy_swap"


class CrossfadeEngine:
    """
    Selects the best crossfade type based on track characteristics
    and provides volume automation curves.
    """

    @staticmethod
    def select(analysis_a: Dict, analysis_b: Dict,
               exit_t: float, entry_t: float,
               mix_dur: float) -> Dict[str, Any]:
        """Choose the best crossfade type for a transition."""
        bpm_a = analysis_a.get("bpm", 120)
        bpm_b = analysis_b.get("bpm", 120)
        bpm_diff = abs(bpm_a - bpm_b)

        # Check vocal presence at transition points
        va = analysis_a.get("vocalSections", [])
        vb = analysis_b.get("vocalSections", [])
        exit_vocal = any(v["start"] <= exit_t <= v["end"] for v in va)
        entry_vocal = any(v["start"] <= entry_t <= v["end"] for v in vb)

        # Check energy levels
        ec_a = analysis_a.get("energyCurve", [])
        ec_b = analysis_b.get("energyCurve", [])
        e_exit = next((e["value"] for e in ec_a if abs(e["time"] - exit_t) < 0.2), 0.5)
        e_entry = next((e["value"] for e in ec_b if abs(e["time"] - entry_t) < 0.2), 0.5)

        # Check if entry is near a drop
        near_drop = any(abs(d["timestamp"] - entry_t) < 2.0 for d in analysis_b.get("drops", []))

        reasons = []

        if near_drop and e_entry > 0.7:
            ctype = CrossfadeType.DROP_SWITCH
            reasons.append("Drop switch — entry near drop with high energy")
        elif bpm_diff < 3 and not exit_vocal and not entry_vocal:
            ctype = CrossfadeType.SMOOTH
            reasons.append("Smooth fade — close BPM, instrumental overlap")
        elif bpm_diff > 15:
            ctype = CrossfadeType.FAST_CUT
            reasons.append("Fast cut — large BPM difference")
        elif e_exit < 0.3 and e_entry > 0.6:
            ctype = CrossfadeType.ENERGY_SWAP
            reasons.append("Energy swap — low to high energy transition")
        elif e_exit > 0.6 and e_entry < 0.4:
            ctype = CrossfadeType.BUILDUP
            reasons.append("Buildup transition — high to low energy")
        elif mix_dur > 16:
            ctype = CrossfadeType.CINEMATIC
            reasons.append("Cinematic fade — long mix duration")
        else:
            ctype = CrossfadeType.SMOOTH
            reasons.append("Smooth fade — default")

        log.info(f"Crossfade: {ctype.value} | reasons={reasons}")
        return {"type": ctype.value, "reasons": reasons, "mixDuration": mix_dur}

    @staticmethod
    def volume_curve(ctype: CrossfadeType, duration: float,
                     steps: int = 50) -> Dict[str, List[float]]:
        """Generate volume automation curves for track A (out) and B (in)."""
        t = np.linspace(0, 1, steps)

        if ctype == CrossfadeType.SMOOTH:
            vol_a = 1.0 - t
            vol_b = t
        elif ctype == CrossfadeType.FAST_CUT:
            cut_point = 0.3
            vol_a = np.where(t < cut_point, 1.0, 0.0)
            vol_b = np.where(t >= cut_point, 1.0, 0.0)
        elif ctype == CrossfadeType.CINEMATIC:
            vol_a = np.cos(t * np.pi / 2)
            vol_b = np.sin(t * np.pi / 2)
        elif ctype == CrossfadeType.BUILDUP:
            vol_a = 1.0 - t ** 0.5
            vol_b = t ** 2
        elif ctype == CrossfadeType.DROP_SWITCH:
            vol_a = np.where(t < 0.15, 1.0, np.maximum(0, 1.0 - (t - 0.15) / 0.3))
            vol_b = np.where(t < 0.15, 0.0, np.minimum(1.0, (t - 0.15) / 0.3))
        elif ctype == CrossfadeType.ENERGY_SWAP:
            vol_a = 1.0 - t ** 1.5
            vol_b = t ** 1.5
        else:
            vol_a = 1.0 - t
            vol_b = t

        return {
            "volumeA": [round(float(v), 3) for v in vol_a],
            "volumeB": [round(float(v), 3) for v in vol_b],
            "duration": duration,
        }
