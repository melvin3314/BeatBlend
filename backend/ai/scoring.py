"""
BeatBlend Transition Scoring
============================
Comprehensive transition compatibility scoring between two tracks.
"""

from typing import List, Dict, Any
import numpy as np

from analysis.utils import log


class TransitionScorer:
    """Scores transition quality between two analyzed tracks."""

    def __init__(self, analysis_a: Dict[str, Any], analysis_b: Dict[str, Any]):
        self.a = analysis_a
        self.b = analysis_b

    def score(self) -> Dict[str, Any]:
        bpm = self._bpm_score()
        key = self._key_score()
        energy = self._energy_score()
        struct = self._structure_score()
        vocal = self._vocal_score()
        drop = self._drop_score()

        overall = round(float(
            bpm * 0.30 + key * 0.25 + energy * 0.20 +
            struct * 0.10 + vocal * 0.10 + drop * 0.05
        ), 3)

        reasons = self._reasons(bpm, key, energy, struct, vocal, drop)
        risk = "low" if overall > 0.7 else ("medium" if overall > 0.45 else "high")

        return {
            "score": round(overall * 100),
            "overall": overall,
            "breakdown": {
                "bpm": round(bpm, 3), "key": round(key, 3),
                "energy": round(energy, 3), "structure": round(struct, 3),
                "vocal": round(vocal, 3), "dropSync": round(drop, 3),
            },
            "riskLevel": risk,
            "reasons": reasons,
        }

    def _bpm_score(self) -> float:
        ba, bb = self.a.get("bpm", 0), self.b.get("bpm", 0)
        if ba <= 0 or bb <= 0: return 0.5
        r = ba / bb
        if 0.97 <= r <= 1.03: return 1.0
        if 0.94 <= r <= 1.06: return 0.9
        if 0.48 <= r <= 0.52 or 1.98 <= r <= 2.02: return 0.85
        if 0.85 <= r <= 1.18: return 0.7
        if 0.70 <= r <= 1.43: return 0.5
        if 0.55 <= r <= 1.82: return 0.3
        return 0.1

    def _key_score(self) -> float:
        ca = self.a.get("camelot", "?")
        cb = self.b.get("camelot", "?")
        if ca == "?" or cb == "?": return 0.5
        try:
            n1, l1 = int(ca[:-1]), ca[-1]
            n2, l2 = int(cb[:-1]), cb[-1]
        except (ValueError, IndexError):
            return 0.5
        if ca == cb: return 1.0
        if l1 == l2:
            d = abs(n1 - n2) % 12
            if d == 0: return 1.0
            if d in (1, 11): return 0.85
            return max(0.0, 1.0 - d / 6.0)
        return max(0.0, 0.5 - abs(n1 - n2) / 12.0)

    def _energy_score(self) -> float:
        ea = self.a.get("energyCurve", [])
        eb = self.b.get("energyCurve", [])
        if not ea or not eb: return 0.5
        ma = np.mean([e["value"] for e in ea])
        mb = np.mean([e["value"] for e in eb])
        return float(1.0 - min(1.0, abs(ma - mb) / 0.6))

    def _structure_score(self) -> float:
        sa = {s.get("type", "") for s in self.a.get("sections", [])}
        sb = {s.get("type", "") for s in self.b.get("sections", [])}
        if not sa or not sb: return 0.5
        return float(len(sa & sb) / max(len(sa | sb), 1))

    def _vocal_score(self) -> float:
        va = self.a.get("vocalSections", [])
        vb = self.b.get("vocalSections", [])
        if not va and not vb: return 1.0
        if not va or not vb: return 0.7
        return 0.4

    def _drop_score(self) -> float:
        da = self.a.get("drops", [])
        db = self.b.get("drops", [])
        if not da or not db: return 0.5
        return 0.8 if len(da) > 0 and len(db) > 0 else 0.5

    def _reasons(self, bpm, key, energy, struct, vocal, drop) -> List[str]:
        r = []
        if bpm > 0.8: r.append("Compatible BPM")
        elif bpm > 0.5: r.append("Workable BPM with adjustment")
        else: r.append("BPM mismatch — significant adjustment needed")
        if key > 0.8: r.append("Compatible harmonic mix")
        elif key > 0.5: r.append("Acceptable key relationship")
        else: r.append("Key clash — harmonic mismatch")
        if energy > 0.7: r.append("Energy curves align")
        if struct > 0.6: r.append("Similar song structures")
        if vocal > 0.7: r.append("Low vocal clash risk")
        elif vocal < 0.5: r.append("Vocal overlap possible — caution")
        if drop > 0.7: r.append("Drop timings match")
        return r
