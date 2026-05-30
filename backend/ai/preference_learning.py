"""
BeatBlend Preference Learning
=============================
Lightweight user preference learning via JSON storage.
Learns from liked/skipped transitions to adjust scoring weights.
No heavy ML — simple statistical adaptation.
"""

import os
import json
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

from analysis.utils import log

PREF_FILE = Path(__file__).resolve().parent.parent / "data" / "preferences.json"


class PreferenceLearner:
    """
    Learns user preferences from transition feedback.
    Adjusts scoring weights based on liked vs skipped transitions.
    """

    def __init__(self):
        self.data = self._load()

    def _load(self) -> Dict[str, Any]:
        PREF_FILE.parent.mkdir(parents=True, exist_ok=True)
        if PREF_FILE.exists():
            try:
                with open(PREF_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "version": 1,
            "liked": [],
            "skipped": [],
            "weights": {
                "bpm": 0.30, "key": 0.25, "energy": 0.20,
                "structure": 0.10, "vocal": 0.10, "drop": 0.05,
            },
            "stats": {"total_liked": 0, "total_skipped": 0, "last_updated": ""},
        }

    def _save(self) -> None:
        PREF_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(PREF_FILE, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)

    def like(self, transition: Dict[str, Any]) -> None:
        """Record a liked transition."""
        entry = {
            "trackA": transition.get("trackA", ""),
            "trackB": transition.get("trackB", ""),
            "bpm_a": transition.get("bpmA", 0),
            "bpm_b": transition.get("bpmB", 0),
            "key_a": transition.get("keyA", ""),
            "key_b": transition.get("keyB", ""),
            "timestamp": datetime.utcnow().isoformat(),
        }
        self.data["liked"].append(entry)
        self.data["stats"]["total_liked"] += 1
        self._update_weights()
        self._save()
        log.info(f"Transition liked — total: {self.data['stats']['total_liked']}")

    def skip(self, transition: Dict[str, Any]) -> None:
        """Record a skipped transition."""
        entry = {
            "trackA": transition.get("trackA", ""),
            "trackB": transition.get("trackB", ""),
            "bpm_a": transition.get("bpmA", 0),
            "bpm_b": transition.get("bpmB", 0),
            "key_a": transition.get("keyA", ""),
            "key_b": transition.get("keyB", ""),
            "timestamp": datetime.utcnow().isoformat(),
        }
        self.data["skipped"].append(entry)
        self.data["stats"]["total_skipped"] += 1
        self._update_weights()
        self._save()
        log.info(f"Transition skipped — total: {self.data['stats']['total_skipped']}")

    def get_weights(self) -> Dict[str, float]:
        """Return current scoring weights."""
        return dict(self.data["weights"])

    def get_stats(self) -> Dict[str, Any]:
        return dict(self.data["stats"])

    def _update_weights(self) -> None:
        """
        Adjust weights based on liked vs skipped patterns.
        If users consistently like transitions with close BPM, increase BPM weight.
        """
        liked = self.data["liked"]
        skipped = self.data["skipped"]

        if len(liked) < 3:
            return

        # Analyze liked transitions: what do they have in common?
        liked_bpm_diffs = []
        for t in liked[-20:]:
            ba, bb = t.get("bpm_a", 0), t.get("bpm_b", 0)
            if ba > 0 and bb > 0:
                liked_bpm_diffs.append(abs(ba - bb))

        skipped_bpm_diffs = []
        for t in skipped[-20:]:
            ba, bb = t.get("bpm_a", 0), t.get("bpm_b", 0)
            if ba > 0 and bb > 0:
                skipped_bpm_diffs.append(abs(ba - bb))

        w = dict(self.data["weights"])

        # If liked transitions have consistently smaller BPM diffs than skipped,
        # BPM matters more to this user
        if liked_bpm_diffs and skipped_bpm_diffs:
            avg_liked = sum(liked_bpm_diffs) / len(liked_bpm_diffs)
            avg_skipped = sum(skipped_bpm_diffs) / len(skipped_bpm_diffs)
            if avg_skipped > avg_liked * 1.5:
                w["bpm"] = min(0.40, w["bpm"] + 0.02)
                w["key"] = max(0.15, w["key"] - 0.01)
            elif avg_liked > avg_skipped * 1.5:
                w["bpm"] = max(0.20, w["bpm"] - 0.02)
                w["key"] = min(0.35, w["key"] + 0.01)

        # Normalize
        total = sum(w.values())
        w = {k: round(v / total, 3) for k, v in w.items()}

        self.data["weights"] = w
        self.data["stats"]["last_updated"] = datetime.utcnow().isoformat()

    def reset(self) -> None:
        """Reset all learned preferences."""
        self.data = {
            "version": 1,
            "liked": [],
            "skipped": [],
            "weights": {
                "bpm": 0.30, "key": 0.25, "energy": 0.20,
                "structure": 0.10, "vocal": 0.10, "drop": 0.05,
            },
            "stats": {"total_liked": 0, "total_skipped": 0, "last_updated": ""},
        }
        self._save()
        log.info("Preferences reset")
