"""
BeatBlend Autoplay Engine
=========================
Intelligent autoplay that selects the next track and plans transitions
like a real human DJ — considering energy flow, key, BPM, and structure.
"""

from typing import List, Dict, Any, Optional
import numpy as np

from analysis.utils import log
from .transition_engine import TransitionEngine
from .queue_manager import QueueManager


class AutoplayEngine:
    """
    Autonomous DJ engine.
    Given a current track and a pool of candidates, selects the best next track
    and generates a full transition plan.
    """

    def __init__(self, pool: List[Dict[str, Any]]):
        """
        pool: list of pre-analyzed track dicts.
        """
        self.pool = {t.get("id", str(i)): t for i, t in enumerate(pool)}
        self.history: List[str] = []  # IDs of played tracks

    def select_next(self, current: Dict[str, Any],
                    exclude_played: bool = True) -> Optional[Dict[str, Any]]:
        """
        Select the best next track from the pool.
        Returns None if pool is exhausted.
        """
        candidates = {
            tid: t for tid, t in self.pool.items()
            if not exclude_played or tid not in self.history
        }

        if not candidates:
            log.info("Autoplay: pool exhausted")
            return None

        if len(candidates) == 1:
            return next(iter(candidates.values()))

        # Score every candidate
        scored = []
        for tid, track in candidates.items():
            score = self._score(current, track)
            scored.append((score, tid, track))

        scored.sort(key=lambda x: -x[0])

        best_score, best_id, best_track = scored[0]
        self.history.append(best_id)

        log.info(f"Autoplay selected: {best_track.get('id', '?')} "
                 f"(score={best_score:.2f}, candidates={len(scored)})")
        return best_track

    def plan_next(self, current: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Select next track AND generate a full transition plan."""
        next_track = self.select_next(current)
        if next_track is None:
            return None

        engine = TransitionEngine(current, next_track)
        plan = engine.plan()
        plan["nextTrack"] = {
            "id": next_track.get("id"),
            "bpm": next_track.get("bpm"),
            "key": next_track.get("key"),
            "camelot": next_track.get("camelot"),
            "genre": next_track.get("genre"),
        }
        return plan

    def energy_curve_sequence(self, tracks: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Analyze the energy flow across a sequence of tracks.
        Returns energy progression data for visualization.
        """
        if not tracks:
            return {"progression": [], "rating": "unknown"}

        energies = []
        for t in tracks:
            ec = t.get("energyCurve", [])
            if ec:
                energies.append(np.mean([e["value"] for e in ec]))
            else:
                energies.append(0.5)

        diffs = np.diff(energies) if len(energies) > 1 else np.array([])
        smoothness = 1.0 - min(1.0, np.std(diffs)) if len(diffs) > 0 else 1.0

        if smoothness > 0.8:
            rating = "excellent"
        elif smoothness > 0.6:
            rating = "good"
        elif smoothness > 0.4:
            rating = "acceptable"
        else:
            rating = "erratic"

        return {
            "progression": [round(float(e), 3) for e in energies],
            "smoothness": round(float(smoothness), 3),
            "rating": rating,
        }

    def reset_history(self) -> None:
        self.history.clear()

    def _score(self, current: Dict, candidate: Dict) -> float:
        """Score a candidate track for autoplay selection."""
        s = 0.5

        # BPM compatibility
        bpm_c = current.get("bpm", 120)
        bpm_n = candidate.get("bpm", 120)
        if bpm_c > 0 and bpm_n > 0:
            r = bpm_c / bpm_n
            if 0.94 <= r <= 1.06: s += 0.20
            elif 0.85 <= r <= 1.18: s += 0.10
            elif 0.48 <= r <= 0.52 or 1.98 <= r <= 2.02: s += 0.15

        # Key compatibility
        cc = current.get("camelot", "?")
        cn = candidate.get("camelot", "?")
        if cc != "?" and cn != "?":
            try:
                n1, l1 = int(cc[:-1]), cc[-1]
                n2, l2 = int(cn[:-1]), cn[-1]
                if cc == cn: s += 0.20
                elif l1 == l2 and abs(n1 - n2) % 12 in (1, 11): s += 0.15
            except (ValueError, IndexError):
                pass

        # Energy flow (prefer slight energy variation, not identical)
        ec_c = current.get("energyCurve", [])
        ec_n = candidate.get("energyCurve", [])
        if ec_c and ec_n:
            mc = np.mean([e["value"] for e in ec_c])
            mn = np.mean([e["value"] for e in ec_n])
            diff = abs(mc - mn)
            if 0.05 < diff < 0.3: s += 0.10  # slight variation = interesting
            elif diff < 0.05: s += 0.05  # same energy = safe but boring

        # Genre compatibility bonus
        gc = current.get("genre", "")
        gn = candidate.get("genre", "")
        if gc and gn and gc == gn:
            s += 0.05

        return float(np.clip(s, 0.0, 1.0))
