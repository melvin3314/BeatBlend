"""
BeatBlend Compatibility Engine
==============================
Batch compatibility analysis across a pool of tracks.
"""

from typing import List, Dict, Any
import numpy as np

from analysis.utils import log
from .scoring import TransitionScorer


class CompatibilityEngine:
    """Computes compatibility matrices for a pool of tracks."""

    def __init__(self, tracks: List[Dict[str, Any]]):
        self.tracks = tracks
        self.matrix: np.ndarray = np.array([])

    def compute_matrix(self) -> np.ndarray:
        """Compute NxN compatibility matrix."""
        n = len(self.tracks)
        self.matrix = np.zeros((n, n))

        for i in range(n):
            for j in range(n):
                if i == j:
                    self.matrix[i, j] = 1.0
                else:
                    scorer = TransitionScorer(self.tracks[i], self.tracks[j])
                    result = scorer.score()
                    self.matrix[i, j] = result["overall"]

        log.info(f"Compatibility matrix: {n}x{n} computed")
        return self.matrix

    def best_pairs(self, top_n: int = 10) -> List[Dict[str, Any]]:
        """Return the best track pairs sorted by compatibility."""
        if self.matrix.size == 0:
            self.compute_matrix()

        pairs = []
        n = len(self.tracks)
        for i in range(n):
            for j in range(n):
                if i != j:
                    pairs.append({
                        "trackA": self.tracks[i].get("id", str(i)),
                        "trackB": self.tracks[j].get("id", str(j)),
                        "score": round(float(self.matrix[i, j]) * 100),
                        "compatibility": round(float(self.matrix[i, j]), 3),
                    })

        pairs.sort(key=lambda p: -p["compatibility"])
        return pairs[:top_n]

    def best_sequence(self, start_id: str) -> List[Dict[str, Any]]:
        """Greedy best sequence starting from a given track."""
        if self.matrix.size == 0:
            self.compute_matrix()

        id_to_idx = {t.get("id", str(i)): i for i, t in enumerate(self.tracks)}
        if start_id not in id_to_idx:
            return []

        n = len(self.tracks)
        visited = {id_to_idx[start_id]}
        sequence = [self.tracks[id_to_idx[start_id]]]

        while len(visited) < n:
            current = id_to_idx.get(sequence[-1].get("id", ""), -1)
            if current < 0:
                break

            best_idx, best_score = -1, -1.0
            for j in range(n):
                if j not in visited and self.matrix[current, j] > best_score:
                    best_score = self.matrix[current, j]
                    best_idx = j

            if best_idx < 0:
                break

            visited.add(best_idx)
            sequence.append(self.tracks[best_idx])

        return sequence
