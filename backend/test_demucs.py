"""
BeatBlend Demucs Test Script
=============================
Quick test of stem separation.

Usage:
    python test_demucs.py "path/to/music.mp3"
    python test_demucs.py "path/to/music.mp3" --force
"""

import argparse
import os
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from stems import separate_stems, validate_audio, get_stem_logger

log = get_stem_logger()


def main():
    parser = argparse.ArgumentParser(
        description="BeatBlend Demucs Stem Separation Test"
    )
    parser.add_argument(
        "audio",
        help="Path to audio file (mp3, wav, flac, etc.)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Bypass cache and re-run Demucs",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="Override Demucs timeout in seconds",
    )
    args = parser.parse_args()

    audio_path = args.audio

    print(f"\n{'='*60}")
    print(f"BeatBlend Demucs Test")
    print(f"{'='*60}")
    print(f"Audio: {audio_path}")
    print(f"Force: {args.force}")
    if args.timeout:
        print(f"Timeout: {args.timeout}s")
    print()

    try:
        validate_audio(audio_path)
    except (FileNotFoundError, ValueError) as e:
        print(f"[ERROR] Validation failed: {e}")
        sys.exit(1)

    print("Starting separation...\n")
    t0 = time.time()

    try:
        stems = separate_stems(
            audio_path,
            force=args.force,
            timeout=args.timeout,
        )
    except Exception as e:
        print(f"\n[ERROR] Separation failed:")
        traceback.print_exc()
        sys.exit(1)

    elapsed = time.time() - t0

    print(f"\n{'='*60}")
    print(f"RESULTS")
    print(f"{'='*60}")
    print(f"Time: {elapsed:.1f}s")
    print(f"Stems found: {len(stems)}")
    print()

    for name, path in stems.items():
        size_mb = os.path.getsize(path) / (1024 * 1024) if os.path.exists(path) else 0
        print(f"  {name:8s} → {path}")
        print(f"           ({size_mb:.1f} MB)")
        print()

    print(f"{'='*60}")
    print("SUCCESS — All stems ready for mixing.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
