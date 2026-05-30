"""
BeatBlend Queue Manager
=======================
Intelligent track queue with optimized ordering for smooth transitions.
"""

from typing import List, Dict, Any, Optional, Tuple
import numpy as np

from analysis.utils import log


class QueueManager:
    """
    Manages the playback queue with intelligent ordering.
    Optimizes track order for the smoothest possible transitions.
    """

    def __init__(self, tracks: List[Dict[str, Any]]):
        """
        tracks: list of track analysis dicts, each must have at least:
                {id, bpm, camelot, energyCurve, sections}
        """
        self.tracks = tracks
        self.queue: List[Dict[str, Any]] = []

    def optimize(self, start_track_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Greedy optimization: starting from start_track, always pick
        the best next track based on transition compatibility.
        """
        if len(self.tracks) < 2:
            self.queue = list(self.tracks)
            return self.queue

        remaining = {t.get("id", str(i)): t for i, t in enumerate(self.tracks)}
        self.queue = []

        # Find start track
        if start_track_id and start_track_id in remaining:
            current = remaining.pop(start_track_id)
        else:
            first_id = next(iter(remaining))
            current = remaining.pop(first_id)

        self.queue.append(current)

        while remaining:
            best_id, best_score = None, -1.0
            for tid, track in remaining.items():
                score = self._compatibility_score(current, track)
                if score > best_score:
                    best_score = score
                    best_id = tid

            if best_id:
                current = remaining.pop(best_id)
                self.queue.append(current)
            else:
                # Fallback: take any remaining
                tid = next(iter(remaining))
                self.queue.append(remaining.pop(tid))

        log.info(f"Queue optimized: {len(self.queue)} tracks")
        return self.queue

    def insert(self, track: Dict[str, Any], position: Optional[int] = None) -> None:
        """Insert a track at the best position (or specific index)."""
        if position is not None:
            self.queue.insert(position, track)
            return

        # Find best insertion point
        best_pos, best_score = 0, -1.0
        for i in range(len(self.queue) + 1):
            score = 0.0
            if i > 0:
                score += self._compatibility_score(self.queue[i - 1], track)
            if i < len(self.queue):
                score += self._compatibility_score(track, self.queue[i])
            if i > 0 and i < len(self.queue):
                score /= 2
            if score > best_score:
                best_score = score
                best_pos = i

        self.queue.insert(best_pos, track)
        log.info(f"Track inserted at position {best_pos}")

    def remove(self, track_id: str) -> bool:
        """Remove a track from the queue."""
        for i, t in enumerate(self.queue):
            if t.get("id") == track_id:
                self.queue.pop(i)
                return True
        return False

    def next(self) -> Optional[Dict[str, Any]]:
        """Pop and return the next track."""
        if self.queue:
            return self.queue.pop(0)
        return None

    def peek(self, n: int = 1) -> List[Dict[str, Any]]:
        """Look at the next n tracks without removing."""
        return self.queue[:n]

    @staticmethod
    def _compatibility_score(a: Dict, b: Dict) -> float:
        """Quick compatibility score between two tracks."""
        score = 0.5

        # BPM
        bpm_a = a.get("bpm", 120)
        bpm_b = b.get("bpm", 120)
        if bpm_a > 0 and bpm_b > 0:
            r = bpm_a / bpm_b
            if 0.94 <= r <= 1.06: score += 0.20
            elif 0.85 <= r <= 1.18: score += 0.10
            elif 0.48 <= r <= 0.52 or 1.98 <= r <= 2.02: score += 0.15

        # Camelot
        ca = a.get("camelot", "?")
        cb = b.get("camelot", "?")
        if ca != "?" and cb != "?":
            try:
                n1, l1 = int(ca[:-1]), ca[-1]
                n2, l2 = int(cb[:-1]), cb[-1]
                if ca == cb: score += 0.20
                elif l1 == l2 and abs(n1 - n2) % 12 in (1, 11): score += 0.15
                elif l1 == l2 and abs(n1 - n2) % 12 == 0: score += 0.20
            except (ValueError, IndexError):
                pass

        # Energy
        ec_a = a.get("energyCurve", [])
        ec_b = b.get("energyCurve", [])
        if ec_a and ec_b:
            ma = np.mean([e["value"] for e in ec_a])
            mb = np.mean([e["value"] for e in ec_b])
            score += (1.0 - abs(ma - mb)) * 0.10

        return float(np.clip(score, 0.0, 1.0))
