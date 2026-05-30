"""
BeatBlend AI Package
====================
Lightweight AI for scoring, compatibility, and preference learning.
No heavy deep learning — pure heuristics + simple statistical models.
"""

from .scoring import TransitionScorer
from .compatibility import CompatibilityEngine
from .preference_learning import PreferenceLearner

__all__ = [
    "TransitionScorer",
    "CompatibilityEngine",
    "PreferenceLearner",
]
