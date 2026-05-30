"""
BeatBlend Transition Points
===========================
Finds optimal entry/exit points for DJ transitions.
No fixed rules — data-driven from musical structure.
"""

from typing import List, Dict, Any, Tuple, Optional
import numpy as np

from .utils import log


class TransitionPointFinder:
    """
    Finds the best transition points between two tracks.
    Considers beat alignment, phrase matching, energy, vocals, and drops.
    """

    def __init__(self, analysis_a: Dict[str, Any], analysis_b: Dict[str, Any]):
        self.a = analysis_a
        self.b = analysis_b

    def find(self) -> Dict[str, Any]:
        dur_a = self._duration(self.a)
        dur_b = self._duration(self.b)
        real_end_a = self.a.get("realEnd", dur_a)
        real_start_b = self.b.get("realStart", 0.0)

        exits = self._exit_candidates(dur_a, real_end_a)
        entries = self._entry_candidates(dur_b, real_start_b)

        best = None
        best_score = -1.0

        for exit_t in exits:
            for entry_t in entries:
                mix_dur = self._mix_duration(exit_t, entry_t)
                score = self._score(exit_t, entry_t, mix_dur)
                if score > best_score:
                    best_score = score
                    best = {
                        "trackA_exit": round(exit_t, 2),
                        "trackB_entry": round(entry_t, 2),
                        "mix_duration": round(mix_dur, 1),
                        "confidence": round(min(1.0, score), 3),
                    }

        if best is None:
            best = {"trackA_exit": round(dur_a * 0.7, 2), "trackB_entry": 0.0,
                    "mix_duration": 16.0, "confidence": 0.5}

        log.info(f"Best points: exit={best['trackA_exit']}s entry={best['trackB_entry']}s "
                 f"mix={best['mix_duration']}s conf={best['confidence']}")
        return best

    def find_all(self, top_n: int = 5) -> List[Dict[str, Any]]:
        """Return top N transition point candidates."""
        dur_a = self._duration(self.a)
        dur_b = self._duration(self.b)
        real_end_a = self.a.get("realEnd", dur_a)
        real_start_b = self.b.get("realStart", 0.0)

        exits = self._exit_candidates(dur_a, real_end_a)
        entries = self._entry_candidates(dur_b, real_start_b)

        results = []
        for exit_t in exits:
            for entry_t in entries:
                mix_dur = self._mix_duration(exit_t, entry_t)
                score = self._score(exit_t, entry_t, mix_dur)
                results.append({
                    "trackA_exit": round(exit_t, 2),
                    "trackB_entry": round(entry_t, 2),
                    "mix_duration": round(mix_dur, 1),
                    "confidence": round(min(1.0, score), 3),
                })

        results.sort(key=lambda r: -r["confidence"])
        seen = set()
        unique = []
        for r in results:
            k = (round(r["trackA_exit"], 1), round(r["trackB_entry"], 1))
            if k not in seen:
                seen.add(k)
                unique.append(r)
        return unique[:top_n]

    def _duration(self, a: Dict) -> float:
        ec = a.get("energyCurve", [])
        if ec: return ec[-1]["time"]
        beats = a.get("beats", [])
        if beats: return beats[-1] + 1.0
        return 180.0

    def _exit_candidates(self, dur: float, real_end: float) -> List[float]:
        cands = []
        for p in self.a.get("phrases", []):
            t = p["end"]
            if 15 < t < real_end - 5:
                cands.append(t)
        for db in self.a.get("downbeats", []):
            if dur * 0.30 < db < real_end - 10:
                cands.append(db)
        for s in self.a.get("sections", []):
            t = s["end"]
            if 15 < t < real_end - 5 and s.get("type") in ("outro", "breakdown", "bridge", "verse"):
                cands.append(t)
        if not cands:
            for pct in [0.40, 0.55, 0.70, 0.85]:
                t = dur * pct
                if t < real_end - 5:
                    cands.append(t)
        seen = set()
        return [c for c in cands if not (round(c, 1) in seen or seen.add(round(c, 1)))][:8]

    def _entry_candidates(self, dur: float, real_start: float) -> List[float]:
        cands = [real_start]
        for p in self.b.get("phrases", []):
            t = p["start"]
            if real_start <= t < dur * 0.5:
                cands.append(t)
        for s in self.b.get("sections", []):
            t = s["start"]
            if real_start <= t < dur * 0.5 and s.get("type") in ("build", "intro"):
                cands.append(t)
        for db in self.b.get("downbeats", []):
            if real_start <= db <= real_start + 30:
                cands.append(db)
        seen = set()
        return [c for c in cands if not (round(c, 1) in seen or seen.add(round(c, 1)))][:6]

    def _mix_duration(self, exit_t: float, entry_t: float) -> float:
        bpm_a = self.a.get("bpm", 120)
        bpm_b = self.b.get("bpm", 120)
        avg = (bpm_a + bpm_b) / 2
        beat = 60.0 / avg if avg > 0 else 0.5
        base = beat * 16 if abs(bpm_a - bpm_b) < 3 else (beat * 12 if abs(bpm_a - bpm_b) < 8 else beat * 8)
        real_start_b = self.b.get("realStart", 0.0)
        if entry_t <= real_start_b + 2:
            base = min(base, beat * 8)
        return round(float(np.clip(base, 4.0, 32.0)), 1)

    def _score(self, exit_t: float, entry_t: float, mix_dur: float) -> float:
        s = 0.5
        for p in self.a.get("phrases", []):
            if abs(p["end"] - exit_t) < 0.5:
                s += 0.15
                break
        for p in self.b.get("phrases", []):
            if abs(p["start"] - entry_t) < 0.5:
                s += 0.15
                break
        va = self.a.get("vocalSections", [])
        vb = self.b.get("vocalSections", [])
        ev = any(v["start"] <= exit_t <= v["end"] for v in va)
        en = any(v["start"] <= entry_t <= v["end"] for v in vb)
        if ev and en: s -= 0.15
        elif not ev and not en: s += 0.10
        for d in self.a.get("drops", []):
            if abs(d["timestamp"] - exit_t) < 1.0:
                s += 0.10
                break
        for sec in self.b.get("sections", []):
            if sec.get("type") == "build" and abs(sec["start"] - entry_t) < 0.5:
                s += 0.10
                break
        ec_a = self.a.get("energyCurve", [])
        ec_b = self.b.get("energyCurve", [])
        e_exit = next((e["value"] for e in ec_a if abs(e["time"] - exit_t) < 0.2), 0.5)
        e_entry = next((e["value"] for e in ec_b if abs(e["time"] - entry_t) < 0.2), 0.5)
        s += (1.0 - abs(e_exit - e_entry)) * 0.10
        return float(np.clip(s, 0.0, 1.0))
