"""
BeatBlend Analysis Package
==========================
Modular audio analysis for intelligent DJ transitions.
Zero madmom dependency — pure librosa + numpy + scipy stack.
"""

from .bpm import BpmDetector
from .key_detection import KeyDetector
from .energy import EnergyAnalyzer
from .structure import StructureAnalyzer
from .vocals import VocalDetector
from .transition import TransitionScorer as LegacyTransitionScorer
from .transition import TransitionPointFinder as LegacyTransitionPointFinder
from .phrase_detection import PhraseDetector
from .transition_points import TransitionPointFinder
from .genre import GenreClassifier
from .utils import AudioLoader, setup_logging, NumpyEncoder

__all__ = [
    "BpmDetector",
    "KeyDetector",
    "EnergyAnalyzer",
    "StructureAnalyzer",
    "VocalDetector",
    "LegacyTransitionScorer",
    "LegacyTransitionPointFinder",
    "PhraseDetector",
    "TransitionPointFinder",
    "GenreClassifier",
    "AudioLoader",
    "setup_logging",
    "NumpyEncoder",
]
