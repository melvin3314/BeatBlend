#!/usr/bin/env python
"""
BeatBlend Stem Mix Test
=========================
CLI test script for offline stem mixing.

Usage:
    python test_stem_mix.py trackA.mp3 trackB.mp3 [--mode vocal_carry|smooth|drop_switch]

Example:
    python test_stem_mix.py eminem.mp3 dre.mp3 --mode vocal_carry
"""

import argparse
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from stems import (
    separate_stems,
    load_track_stems,
    stretch_stems_to_bpm,
    mix_tracks,
    export_mix,
)
from stems.stem_utils import get_stem_logger, log


def main():
    parser = argparse.ArgumentParser(description="BeatBlend Stem Mix Test")
    parser.add_argument("track_a", help="Path to Track A audio file")
    parser.add_argument("track_b", help="Path to Track B audio file")
    parser.add_argument(
        "--mode",
        choices=["vocal_carry", "smooth", "drop_switch"],
        default="vocal_carry",
        help="Mix transition mode (default: vocal_carry)",
    )
    parser.add_argument(
        "--overlap",
        type=float,
        default=8.0,
        help="Transition overlap in seconds (default: 8)",
    )
    parser.add_argument(
        "--bpm-a",
        type=float,
        default=None,
        help="Track A BPM (auto-detect if not provided)",
    )
    parser.add_argument(
        "--bpm-b",
        type=float,
        default=None,
        help="Track B BPM (auto-detect if not provided)",
    )
    parser.add_argument(
        "--target-bpm",
        type=float,
        default=None,
        help="Target BPM for sync (default: use Track A BPM)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output path (default: auto-generated in output/)",
    )
    parser.add_argument(
        "--format",
        choices=["wav", "mp3"],
        default="wav",
        help="Output format (default: wav)",
    )

    args = parser.parse_args()

    # Validate inputs
    for path in (args.track_a, args.track_b):
        if not os.path.exists(path):
            print(f"[ERROR] File not found: {path}")
            sys.exit(1)

    start_total = time.time()

    try:
        # Step 1: Separate stems (or use cache)
        print("=" * 60)
        print("STEP 1: STEM SEPARATION")
        print("=" * 60)

        t0 = time.time()
        print(f"\n[Track A] Separating: {args.track_a}")
        a_stem_paths = separate_stems(args.track_a)
        print(f"  → {a_stem_paths}")

        print(f"\n[Track B] Separating: {args.track_b}")
        b_stem_paths = separate_stems(args.track_b)
        print(f"  → {b_stem_paths}")
        print(f"  Separation time: {time.time() - t0:.1f}s")

        # Step 2: Load stems
        print("\n" + "=" * 60)
        print("STEP 2: LOAD STEMS")
        print("=" * 60)

        a_stems = load_track_stems(os.path.dirname(a_stem_paths["vocals"]))
        b_stems = load_track_stems(os.path.dirname(b_stem_paths["vocals"]))
        sr = a_stems.get("_sr", 44100)
        print(f"  Sample rate: {sr} Hz")

        # Step 3: BPM Sync (if BPMs provided)
        print("\n" + "=" * 60)
        print("STEP 3: BPM SYNC")
        print("=" * 60)

        bpm_a = args.bpm_a or 128.0
        bpm_b = args.bpm_b or 128.0
        target_bpm = args.target_bpm or bpm_a

        print(f"  Track A BPM: {bpm_a:.1f}")
        print(f"  Track B BPM: {bpm_b:.1f}")
        print(f"  Target BPM:  {target_bpm:.1f}")

        if abs(bpm_a - target_bpm) > 0.5:
            print(f"  Stretching Track A → {target_bpm:.1f} BPM")
            a_stems = stretch_stems_to_bpm(
                {k: v for k, v in a_stems.items() if not k.startswith("_")},
                sr, bpm_a, target_bpm
            )

        if abs(bpm_b - target_bpm) > 0.5:
            print(f"  Stretching Track B → {target_bpm:.1f} BPM")
            b_stems = stretch_stems_to_bpm(
                {k: v for k, v in b_stems.items() if not k.startswith("_")},
                sr, bpm_b, target_bpm
            )

        # Step 4: Mix
        print("\n" + "=" * 60)
        print(f"STEP 4: MIX ({args.mode})")
        print("=" * 60)

        t0 = time.time()
        result = mix_tracks(
            a_stems,
            b_stems,
            sr=sr,
            mode=args.mode,
            overlap_sec=args.overlap,
        )
        print(f"  Mix time: {time.time() - t0:.1f}s")
        print(f"  Result shape: {result.shape}")

        # Step 5: Export
        print("\n" + "=" * 60)
        print("STEP 5: EXPORT")
        print("=" * 60)

        output_path = export_mix(result, sr, output_path=args.output, format=args.format)
        print(f"  → {output_path}")

        # Summary
        print("\n" + "=" * 60)
        print("DONE")
        print("=" * 60)
        print(f"Total time: {time.time() - start_total:.1f}s")
        print(f"Output: {output_path}")

    except Exception:
        print("\n[ERROR] Mix failed:")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
