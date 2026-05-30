"""
BeatBlend Transition Engine
===========================
Intelligent transition scoring and optimal transition point detection.
Considers BPM, harmony, energy, structure, vocals, and phrase alignment.
"""

from typing import List, Dict, Any, Tuple, Optional
import numpy as np

from .utils import log


# ---------------------------------------------------------------------------
# Camelot wheel distance
# ---------------------------------------------------------------------------

def _camelot_distance(c1: str, c2: str) -> float:
    """Harmonic compatibility score based on Camelot wheel distance."""
    if not c1 or not c2 or c1 == "?" or c2 == "?":
        return 0.5
    try:
        n1, l1 = int(c1[:-1]), c1[-1]
        n2, l2 = int(c2[:-1]), c2[-1]
    except (ValueError, IndexError):
        return 0.5

    if c1 == c2:
        return 1.0  # same key
    if l1 == l2:
        d = abs(n1 - n2) % 12
        if d == 0: return 1.0
        if d in (1, 11): return 0.85  # adjacent on wheel
        return max(0.0, 1.0 - d / 6.0)
    # Different letter (major/minor mismatch)
    return max(0.0, 0.5 - abs(n1 - n2) / 12.0)


def _bpm_compatibility(bpm_a: float, bpm_b: float) -> float:
    """Score BPM compatibility with half/double time bonuses."""
    if bpm_a <= 0 or bpm_b <= 0:
        return 0.5
    r = bpm_a / bpm_b
    if 0.97 <= r <= 1.03: return 1.0
    if 0.94 <= r <= 1.06: return 0.9
    if 0.48 <= r <= 0.52 or 1.98 <= r <= 2.02: return 0.85  # half/double
    if 0.85 <= r <= 1.18: return 0.7
    if 0.70 <= r <= 1.43: return 0.5
    if 0.55 <= r <= 1.82: return 0.3
    return 0.1


def _energy_compatibility(curve_a: List[Dict], curve_b: List[Dict]) -> float:
    """Compare mean energy levels of two tracks."""
    if not curve_a or not curve_b:
        return 0.5
    ma = np.mean([e["value"] for e in curve_a])
    mb = np.mean([e["value"] for e in curve_b])
    return float(1.0 - min(1.0, abs(ma - mb) / 0.6))


def _structure_compatibility(sec_a: List[Dict], sec_b: List[Dict]) -> float:
    """Score based on shared structural elements."""
    ta = {s.get("type", "") for s in sec_a}
    tb = {s.get("type", "") for s in sec_b}
    if not ta or not tb:
        return 0.5
    return float(len(ta & tb) / max(len(ta | tb), 1))


def _vocal_clash_score(va: List[Dict], vb: List[Dict]) -> float:
    """Penalize when both tracks have vocals (potential clash)."""
    if not va and not vb: return 1.0  # both instrumental = perfect
    if not va or not vb: return 0.7   # one instrumental = good
    return 0.4  # both vocal = risky


def _drop_sync_score(drops_a: List[Dict], drops_b: List[Dict]) -> float:
    """Score based on drop alignment potential."""
    if not drops_a or not drops_b:
        return 0.5
    # Check if drops exist in both tracks
    return 0.8 if len(drops_a) > 0 and len(drops_b) > 0 else 0.5


# ---------------------------------------------------------------------------
# Transition Scorer
# ---------------------------------------------------------------------------

class TransitionScorer:
    """
    Computes a comprehensive transition compatibility score between two tracks.
    """

    def __init__(self, analysis_a: Dict[str, Any], analysis_b: Dict[str, Any]):
        self.a = analysis_a
        self.b = analysis_b

    def compute(self) -> Dict[str, Any]:
        """Compute full compatibility report."""
        bpm = _bpm_compatibility(
            self.a.get("bpm", 0), self.b.get("bpm", 0))
        key = _camelot_distance(
            self.a.get("camelot", "?"), self.b.get("camelot", "?"))
        energy = _energy_compatibility(
            self.a.get("energyCurve", []), self.b.get("energyCurve", []))
        struct = _structure_compatibility(
            self.a.get("sections", []), self.b.get("sections", []))
        vocal = _vocal_clash_score(
            self.a.get("vocalSections", []), self.b.get("vocalSections", []))
        drop = _drop_sync_score(
            self.a.get("drops", []), self.b.get("drops", []))

        overall = round(float(
            bpm * 0.30 + key * 0.25 + energy * 0.20 + struct * 0.10 +
            vocal * 0.10 + drop * 0.05
        ), 3)

        reasons = self._build_reasons(bpm, key, energy, struct, vocal, drop)

        risk = "low" if overall > 0.7 else ("medium" if overall > 0.45 else "high")

        log.info(f"Transition score: {overall:.2f} ({risk} risk)")

        return {
            "score": round(overall * 100),
            "overall": overall,
            "bpm": round(bpm, 3),
            "key": round(key, 3),
            "energy": round(energy, 3),
            "structure": round(struct, 3),
            "vocal": round(vocal, 3),
            "dropSync": round(drop, 3),
            "riskLevel": risk,
            "reasons": reasons,
        }

    def _build_reasons(self, bpm: float, key: float, energy: float,
                       struct: float, vocal: float, drop: float) -> List[str]:
        reasons = []
        if bpm > 0.8: reasons.append("Compatible BPM")
        elif bpm > 0.5: reasons.append("Workable BPM with pitch adjustment")
        else: reasons.append("BPM mismatch — significant adjustment needed")

        if key > 0.8: reasons.append("Compatible harmonic mix")
        elif key > 0.5: reasons.append("Acceptable key relationship")
        else: reasons.append("Key clash — harmonic mismatch")

        if energy > 0.7: reasons.append("Energy curves align")
        elif energy > 0.4: reasons.append("Moderate energy compatibility")

        if struct > 0.6: reasons.append("Similar song structures")
        if vocal > 0.7: reasons.append("Low vocal clash risk")
        elif vocal < 0.5: reasons.append("Vocal overlap possible — caution")
        if drop > 0.7: reasons.append("Drop timings match")

        return reasons


# ---------------------------------------------------------------------------
# Best Transition Point Finder
# ---------------------------------------------------------------------------

class TransitionPointFinder:
    """
    Finds optimal entry/exit points for a DJ transition between two tracks.
    No fixed rules — purely data-driven from musical structure.
    """

    def __init__(self, analysis_a: Dict[str, Any], analysis_b: Dict[str, Any]):
        self.a = analysis_a
        self.b = analysis_b

    def find(self) -> Dict[str, Any]:
        """Find best transition points."""
        dur_a = self._duration(self.a)
        dur_b = self._duration(self.b)

        real_start_b = self.a.get("realStart", 0.0) if "realStart" in self.a else \
                        self.b.get("realStart", 0.0)
        real_end_a = self.a.get("realEnd", dur_a) if "realEnd" in self.a else dur_a

        # Candidate exit points from track A
        exit_candidates = self._exit_candidates(dur_a, real_end_a)

        # Candidate entry points from track B
        entry_candidates = self._entry_candidates(dur_b, real_start_b)

        # Score each combination
        best = None
        best_score = -1.0

        for exit_t in exit_candidates:
            for entry_t in entry_candidates:
                mix_dur = self._ideal_mix_duration(exit_t, entry_t)
                score = self._score_transition(exit_t, entry_t, mix_dur)

                if score > best_score:
                    best_score = score
                    best = {
                        "trackA_exit": round(exit_t, 2),
                        "trackB_entry": round(entry_t, 2),
                        "mix_duration": round(mix_dur, 1),
                        "confidence": round(min(1.0, score), 3),
                    }

        if best is None:
            best = {
                "trackA_exit": round(dur_a * 0.7, 2),
                "trackB_entry": 0.0,
                "mix_duration": 16.0,
                "confidence": 0.5,
            }

        log.info(f"Best transition: exit={best['trackA_exit']}s, "
                 f"entry={best['trackB_entry']}s, mix={best['mix_duration']}s")

        return best

    def _duration(self, analysis: Dict) -> float:
        """Extract duration from analysis dict."""
        ec = analysis.get("energyCurve", [])
        if ec:
            return ec[-1]["time"]
        beats = analysis.get("beats", [])
        if beats:
            return beats[-1] + 1.0
        return 180.0

    def _exit_candidates(self, dur_a: float, real_end: float) -> List[float]:
        """Generate candidate exit points from track A."""
        candidates = []

        # Phrase endings
        for p in self.a.get("phrases", []):
            t = p["end"]
            if t > 15 and t < real_end - 5:
                candidates.append((t, 0.70 + p.get("confidence", 0.5) * 0.15))

        # Pre-drop points
        for d in self.a.get("drops", []):
            t = d["timestamp"] - 0.5
            if t > 15 and t < real_end - 5:
                candidates.append((t, 0.65 + d.get("intensity", 0.5) * 0.20))

        # Section boundaries
        for s in self.a.get("sections", []):
            t = s["end"]
            if t > 15 and t < real_end - 5:
                if s.get("type") in ("outro", "breakdown", "bridge", "verse"):
                    candidates.append((t, 0.55))

        # Downbeats in middle section with low energy
        energy_curve = self.a.get("energyCurve", [])
        for db in self.a.get("downbeats", []):
            if db < dur_a * 0.30 or db > real_end - 10:
                continue
            e = next((e["value"] for e in energy_curve
                      if abs(e["time"] - db) < 0.15), 0.5)
            candidates.append((db, 0.40 + (1.0 - e) * 0.15))

        # Fallback: evenly spaced points
        if not candidates:
            for pct in [0.40, 0.55, 0.70, 0.85]:
                t = dur_a * pct
                if t < real_end - 5:
                    candidates.append((t, 0.35))

        # Deduplicate and sort by score
        candidates.sort(key=lambda x: -x[1])
        seen = set()
        unique = []
        for t, s in candidates:
            key = round(t, 1)
            if key not in seen:
                seen.add(key)
                unique.append(t)
        return unique[:8]

    def _entry_candidates(self, dur_b: float, real_start: float) -> List[float]:
        """Generate candidate entry points for track B."""
        candidates = []

        # Real start is always a candidate
        candidates.append((real_start, 0.60))

        # Phrase starts
        for p in self.b.get("phrases", []):
            t = p["start"]
            if t >= real_start and t < dur_b * 0.5:
                candidates.append((t, 0.65 + p.get("confidence", 0.5) * 0.15))

        # Build starts (great entry points)
        for s in self.b.get("sections", []):
            t = s["start"]
            if t >= real_start and t < dur_b * 0.5:
                if s.get("type") == "build":
                    candidates.append((t, 0.70))
                elif s.get("type") == "intro":
                    candidates.append((t, 0.55))

        # Downbeats near real_start
        for db in self.b.get("downbeats", []):
            if real_start <= db <= real_start + 30:
                candidates.append((db, 0.50))

        # Fallback
        if not candidates:
            candidates.append((real_start, 0.40))

        candidates.sort(key=lambda x: -x[1])
        seen = set()
        unique = []
        for t, s in candidates:
            key = round(t, 1)
            if key not in seen:
                seen.add(key)
                unique.append(t)
        return unique[:6]

    def _ideal_mix_duration(self, exit_t: float, entry_t: float) -> float:
        """Determine ideal mix duration based on musical context."""
        bpm_a = self.a.get("bpm", 120)
        bpm_b = self.b.get("bpm", 120)
        avg_bpm = (bpm_a + bpm_b) / 2
        beat_dur = 60.0 / avg_bpm if avg_bpm > 0 else 0.5

        # Base: 8-16 beats
        base = beat_dur * 8

        # Longer mix if BPMs are close
        bpm_diff = abs(bpm_a - bpm_b)
        if bpm_diff < 3:
            base = beat_dur * 16
        elif bpm_diff < 8:
            base = beat_dur * 12

        # Shorter if entry is at real_start (intro mix)
        real_start_b = self.b.get("realStart", 0.0)
        if entry_t <= real_start_b + 2:
            base = min(base, beat_dur * 8)

        return round(float(np.clip(base, 4.0, 32.0)), 1)

    def _score_transition(self, exit_t: float, entry_t: float,
                          mix_dur: float) -> float:
        """Score a specific transition point pair."""
        score = 0.5  # baseline

        # Prefer phrase-aligned exits
        for p in self.a.get("phrases", []):
            if abs(p["end"] - exit_t) < 0.5:
                score += 0.15
                break

        # Prefer phrase-aligned entries
        for p in self.b.get("phrases", []):
            if abs(p["start"] - entry_t) < 0.5:
                score += 0.15
                break

        # Penalize vocal overlap
        va = self.a.get("vocalSections", [])
        vb = self.b.get("vocalSections", [])
        exit_vocal = any(v["start"] <= exit_t <= v["end"] for v in va)
        entry_vocal = any(v["start"] <= entry_t <= v["end"] for v in vb)
        if exit_vocal and entry_vocal:
            score -= 0.15
        elif not exit_vocal and not entry_vocal:
            score += 0.10

        # Prefer exit before drop
        for d in self.a.get("drops", []):
            if abs(d["timestamp"] - exit_t) < 1.0:
                score += 0.10
                break

        # Prefer entry at build start
        for s in self.b.get("sections", []):
            if s.get("type") == "build" and abs(s["start"] - entry_t) < 0.5:
                score += 0.10
                break

        # Energy alignment at transition point
        ec_a = self.a.get("energyCurve", [])
        ec_b = self.b.get("energyCurve", [])
        e_exit = next((e["value"] for e in ec_a if abs(e["time"] - exit_t) < 0.2), 0.5)
        e_entry = next((e["value"] for e in ec_b if abs(e["time"] - entry_t) < 0.2), 0.5)
        energy_diff = abs(e_exit - e_entry)
        score += (1.0 - energy_diff) * 0.10

        return float(np.clip(score, 0.0, 1.0))
