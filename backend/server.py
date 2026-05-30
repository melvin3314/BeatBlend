"""
BeatBlend Backend Server
========================
Flask server for intelligent DJ transition analysis and mixing.
Full AI pipeline: analysis → scoring → transition planning → autoplay.

Endpoints:
  POST /analyze        — Full track analysis (with cache)
  POST /compatibility  — Compare two tracks + best transition points
  POST /transition     — Full transition plan between two tracks
  POST /autoplay       — Select next track + plan transition
  POST /batch-analyze  — Analyze multiple tracks
  POST /bpm            — BPM only
  POST /energy         — Energy curve only
  POST /harmonic       — Key + BPM
  POST /structure      — Structure + phrases
  POST /genre          — Genre classification
  POST /preferences    — Record like/skip feedback
  GET  /preferences    — Get learned weights
  POST /cache/clear    — Clear analysis cache
  POST /separate       — Demucs stem separation (vocals/drums/bass/other)
  POST /generate_mix   — Offline stem mixing (vocal_carry/smooth/drop_switch)
  GET  /health         — Health check
"""

import os
import sys
import json
import subprocess
import tempfile
import traceback
from pathlib import Path
from typing import Any, Dict, Optional, List
from datetime import datetime

from flask import Flask, request, Response
from werkzeug.utils import secure_filename

sys.path.insert(0, str(Path(__file__).resolve().parent))

from analysis import (
    BpmDetector, KeyDetector, EnergyAnalyzer, StructureAnalyzer,
    VocalDetector, PhraseDetector, TransitionPointFinder, GenreClassifier,
    AudioLoader, setup_logging, NumpyEncoder,
)
from mixing import TransitionEngine, AutoplayEngine, QueueManager
from ai import TransitionScorer, CompatibilityEngine, PreferenceLearner
import cache as analysis_cache
from stems import (
    separate_stems, validate_audio, cleanup_temp, get_stem_logger,
    load_track_stems, stretch_stems_to_bpm, mix_tracks, export_mix,
    TransitionMeta,
)
from stems.exporter import OUTPUT_DIR
from stems.structure_analyzer import analyze_structure
from stems.transition_ai import build_ai_transition_plan
from stems.transition_engine import build_dj_mix
from stems.mix_engine import MixEngine

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(__name__)
UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {"wav", "mp3", "flac", "ogg", "m4a", "aiff", "aif"}
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024

logger = setup_logging("BeatBlend.Server")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def cleanup(path: str) -> None:
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception as e:
        logger.warning(f"Cleanup failed: {e}")


def safe_json(data: Any, status: int = 200) -> Response:
    return Response(
        json.dumps(data, cls=NumpyEncoder, ensure_ascii=False),
        status=status, mimetype="application/json",
    )


def handle_upload() -> Optional[str]:
    if "audio" in request.files:
        f = request.files["audio"]
        if f.filename == "" or not (f and allowed_file(f.filename)):
            return None
        name = secure_filename(f.filename)
        stem, ext = os.path.splitext(name)
        path = os.path.join(app.config["UPLOAD_FOLDER"],
                            f"{stem}_{int(datetime.now().timestamp())}{ext}")
        f.save(path)
        return path
    if request.is_json:
        data = request.get_json(silent=True) or {}
        b64 = data.get("audio_base64")
        fname = data.get("filename", "upload.mp3")
        if b64:
            import base64
            raw = base64.b64decode(b64)
            stem, ext = os.path.splitext(secure_filename(fname))
            path = os.path.join(app.config["UPLOAD_FOLDER"],
                                f"{stem}_{int(datetime.now().timestamp())}{ext or '.mp3'}")
            with open(path, "wb") as fh:
                fh.write(raw)
            return path
    return None


# ---------------------------------------------------------------------------
# Full analysis pipeline
# ---------------------------------------------------------------------------

def run_full_analysis(filepath: str, force: bool = False) -> Dict[str, Any]:
    """Run complete analysis with cache support."""
    if not force:
        cached = analysis_cache.get_cached(filepath)
        if cached:
            return {"success": True, "cached": True, **cached}

    loader = AudioLoader(filepath, sr=22050, max_duration=180)
    y, sr = loader.y, loader.sr

    bpm = BpmDetector(y, sr).analyze()
    key = KeyDetector(loader.harmonic, sr).analyze()
    energy = EnergyAnalyzer(y, sr).analyze()
    structure = StructureAnalyzer(y, sr, energy, bpm).analyze()
    vocals = VocalDetector(y, sr, loader.y_harmonic).analyze()
    phrases = PhraseDetector(y, sr, bpm.bpm, bpm.beats,
                             structure.sections, energy.curve).analyze()
    genre = GenreClassifier(y, sr, bpm.bpm, energy.mean_rms,
                            energy.mean_bass, energy.mean_centroid,
                            energy.mean_onset).analyze()

    result = {
        "bpm": round(bpm.bpm, 1),
        "key": key.key,
        "camelot": key.camelot,
        "genre": genre.genre,
        "beats": [round(b, 3) for b in bpm.beats],
        "downbeats": [round(d, 3) for d in bpm.downbeats],
        "bars": [round(b, 3) for b in bpm.bars],
        "phrases": phrases.phrases,
        "drops": _detect_drops(energy, y, sr),
        "builds": _detect_builds(energy, y, sr),
        "breakdowns": structure.breakdowns,
        "energyCurve": energy.curve,
        "vocalSections": vocals.sections,
        "sections": structure.sections,
        "realStart": structure.real_start,
        "realEnd": structure.real_end,
        "duration": loader.duration,
        "confidence": {
            "bpm": bpm.confidence,
            "key": key.confidence,
            "structure": structure.confidence,
            "genre": genre.confidence,
        },
    }

    analysis_cache.set_cached(filepath, result)
    return {"success": True, "cached": False, **result}


def _detect_drops(energy, y, sr) -> list:
    import numpy as np
    import scipy.signal
    import librosa
    vals, times = energy.values(), energy.times()
    if len(vals) < 11: return []
    win = min(11, len(vals) // 2 * 2 + 1)
    if win < 3: return []
    sv = scipy.signal.savgol_filter(vals, win, 2)
    peaks, _ = scipy.signal.find_peaks(sv, distance=int(2 * sr / 512), prominence=0.1)
    hop = 512
    spec = np.abs(librosa.stft(y, hop_length=hop))
    bb = int(250 / (sr / 2) * spec.shape[0])
    bass = np.sum(spec[:bb, :] ** 2, axis=0)
    bass = bass / (np.max(bass) + 1e-8)
    bt = librosa.frames_to_time(np.arange(len(bass)), sr=sr, hop_length=hop)
    drops = []
    for p in peaks:
        t = float(times[p]); e = float(sv[p])
        bi = np.argmin(np.abs(bt - t)); bp = float(bass[bi]) if bi < len(bass) else 0
        if e > 0.6 and bp > 0.5:
            intensity = min(1.0, e * 0.5 + bp * 0.5)
            drops.append({"timestamp": round(t, 3), "intensity": round(intensity, 3),
                          "confidence": round(0.5 + 0.5 * intensity, 3)})
    return sorted(drops, key=lambda d: d["timestamp"])


def _detect_builds(energy, y, sr) -> list:
    import numpy as np
    import librosa
    vals, times = energy.values(), energy.times()
    if len(vals) < 10: return []
    hop = 512
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
    ct = librosa.frames_to_time(np.arange(len(centroid)), sr=sr, hop_length=hop)
    win = max(3, int(3.0 / (times[1] - times[0]))) if len(times) > 1 else 20
    step = max(1, win // 2)
    builds = []
    for i in range(0, len(vals) - win, step):
        ei = min(i + win, len(vals) - 1)
        if ei - i < 3 or vals[ei] < vals[i] * 1.15: continue
        t0, t1 = times[i], times[ei]
        cm = (ct >= t0) & (ct <= t1)
        if np.sum(cm) < 2: continue
        cs = centroid[cm]
        if cs[-1] < cs[0] * 1.05: continue
        builds.append({"start": round(float(t0), 3), "end": round(float(t1), 3),
                       "energyRise": round(float(vals[ei] - vals[i]), 3),
                       "confidence": round(min(1.0, (vals[ei] - vals[i]) * 2), 3)})
    if not builds: return []
    builds.sort(key=lambda b: b["start"])
    merged = [builds[0]]
    for b in builds[1:]:
        if b["start"] <= merged[-1]["end"]:
            merged[-1]["end"] = max(merged[-1]["end"], b["end"])
            merged[-1]["confidence"] = max(merged[-1]["confidence"], b["confidence"])
        else: merged.append(b)
    return merged


# ---------------------------------------------------------------------------
# Routes — Analysis
# ---------------------------------------------------------------------------

@app.route("/analyze", methods=["POST"])
def analyze():
    path = None
    try:
        path = handle_upload()
        if not path: return safe_json({"success": False, "error": "No valid audio file"}, 400)
        force = request.args.get("force", "false").lower() == "true"
        result = run_full_analysis(path, force=force)
        return safe_json(result)
    except Exception as e:
        logger.error(f"Analysis error: {e}\n{traceback.format_exc()}")
        return safe_json({"success": False, "error": str(e)}, 500)
    finally:
        cleanup(path)


@app.route("/batch-analyze", methods=["POST"])
def batch_analyze():
    """Analyze multiple tracks. Expects JSON with 'tracks': [{filepath or base64}, ...]."""
    paths = []
    try:
        if not request.is_json:
            return safe_json({"success": False, "error": "JSON body required"}, 400)
        data = request.get_json(silent=True) or {}
        tracks_data = data.get("tracks", [])
        if not tracks_data:
            return safe_json({"success": False, "error": "No tracks provided"}, 400)

        results = []
        for td in tracks_data:
            fp = td.get("filepath", "")
            tid = td.get("id", fp)
            if fp and os.path.exists(fp):
                r = run_full_analysis(fp)
                r["id"] = tid
                results.append(r)

        return safe_json({"success": True, "count": len(results), "results": results})
    except Exception as e:
        logger.error(f"Batch analysis error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)


@app.route("/bpm", methods=["POST"])
def bpm_endpoint():
    path = None
    try:
        path = handle_upload()
        if not path: return safe_json({"success": False, "error": "No valid audio file"}, 400)
        loader = AudioLoader(path)
        bpm = BpmDetector(loader.y, loader.sr).analyze()
        return safe_json({"success": True, **bpm.to_dict()})
    except Exception as e:
        logger.error(f"BPM error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)
    finally:
        cleanup(path)


@app.route("/energy", methods=["POST"])
def energy_endpoint():
    path = None
    try:
        path = handle_upload()
        if not path: return safe_json({"success": False, "error": "No valid audio file"}, 400)
        loader = AudioLoader(path)
        energy = EnergyAnalyzer(loader.y, loader.sr).analyze()
        return safe_json({"success": True, **energy.to_dict()})
    except Exception as e:
        logger.error(f"Energy error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)
    finally:
        cleanup(path)


@app.route("/harmonic", methods=["POST"])
def harmonic_endpoint():
    path = None
    try:
        path = handle_upload()
        if not path: return safe_json({"success": False, "error": "No valid audio file"}, 400)
        loader = AudioLoader(path)
        bpm = BpmDetector(loader.y, loader.sr).analyze()
        key = KeyDetector(loader.harmonic, loader.sr).analyze()
        return safe_json({"success": True, "bpm": round(bpm.bpm, 1),
                          "key": key.key, "camelot": key.camelot,
                          "beats": [round(b, 3) for b in bpm.beats],
                          "downbeats": [round(d, 3) for d in bpm.downbeats],
                          "confidence": round(key.confidence, 2)})
    except Exception as e:
        logger.error(f"Harmonic error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)
    finally:
        cleanup(path)


@app.route("/structure", methods=["POST"])
def structure_endpoint():
    path = None
    try:
        path = handle_upload()
        if not path: return safe_json({"success": False, "error": "No valid audio file"}, 400)
        loader = AudioLoader(path)
        energy = EnergyAnalyzer(loader.y, loader.sr).analyze()
        bpm = BpmDetector(loader.y, loader.sr).analyze()
        structure = StructureAnalyzer(loader.y, loader.sr, energy, bpm).analyze()
        return safe_json({"success": True, **structure.to_dict()})
    except Exception as e:
        logger.error(f"Structure error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)
    finally:
        cleanup(path)


@app.route("/genre", methods=["POST"])
def genre_endpoint():
    path = None
    try:
        path = handle_upload()
        if not path: return safe_json({"success": False, "error": "No valid audio file"}, 400)
        loader = AudioLoader(path)
        energy = EnergyAnalyzer(loader.y, loader.sr).analyze()
        bpm = BpmDetector(loader.y, loader.sr).analyze()
        genre = GenreClassifier(loader.y, loader.sr, bpm.bpm,
                                energy.mean_rms, energy.mean_bass,
                                energy.mean_centroid, energy.mean_onset).analyze()
        return safe_json({"success": True, "genre": genre.genre,
                          "confidence": genre.confidence, "bpm": round(bpm.bpm, 1)})
    except Exception as e:
        logger.error(f"Genre error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)
    finally:
        cleanup(path)


# ---------------------------------------------------------------------------
# Routes — Mixing & AI
# ---------------------------------------------------------------------------

@app.route("/compatibility", methods=["POST"])
def compatibility():
    try:
        if not request.is_json:
            return safe_json({"success": False, "error": "JSON body required"}, 400)
        data = request.get_json(silent=True) or {}
        a, b = data.get("analysisA"), data.get("analysisB")
        if not a or not b:
            return safe_json({"success": False, "error": "analysisA and analysisB required"}, 400)

        scorer = TransitionScorer(a, b)
        compat = scorer.score()

        finder = TransitionPointFinder(a, b)
        best = finder.find()
        alternatives = finder.find_all(top_n=3)

        return safe_json({
            "success": True,
            "compatibility": compat,
            "bestTransitionPoints": best,
            "alternatives": alternatives,
        })
    except Exception as e:
        logger.error(f"Compatibility error: {e}\n{traceback.format_exc()}")
        return safe_json({"success": False, "error": str(e)}, 500)


@app.route("/transition", methods=["POST"])
def transition():
    """Generate a full transition plan between two tracks."""
    try:
        if not request.is_json:
            return safe_json({"success": False, "error": "JSON body required"}, 400)
        data = request.get_json(silent=True) or {}
        a, b = data.get("analysisA"), data.get("analysisB")
        if not a or not b:
            return safe_json({"success": False, "error": "analysisA and analysisB required"}, 400)

        engine = TransitionEngine(a, b)
        plan = engine.plan()
        return safe_json({"success": True, **plan})
    except Exception as e:
        logger.error(f"Transition error: {e}\n{traceback.format_exc()}")
        return safe_json({"success": False, "error": str(e)}, 500)


@app.route("/autoplay", methods=["POST"])
def autoplay():
    """Select next track and plan transition for autoplay."""
    try:
        if not request.is_json:
            return safe_json({"success": False, "error": "JSON body required"}, 400)
        data = request.get_json(silent=True) or {}
        current = data.get("current")
        pool = data.get("pool", [])
        if not current or not pool:
            return safe_json({"success": False, "error": "current and pool required"}, 400)

        engine = AutoplayEngine(pool)
        plan = engine.plan_next(current)
        if plan is None:
            return safe_json({"success": False, "error": "No suitable next track found"}, 404)

        return safe_json({"success": True, **plan})
    except Exception as e:
        logger.error(f"Autoplay error: {e}\n{traceback.format_exc()}")
        return safe_json({"success": False, "error": str(e)}, 500)


@app.route("/queue/optimize", methods=["POST"])
def queue_optimize():
    """Optimize track queue ordering."""
    try:
        if not request.is_json:
            return safe_json({"success": False, "error": "JSON body required"}, 400)
        data = request.get_json(silent=True) or {}
        tracks = data.get("tracks", [])
        start_id = data.get("startId")
        if not tracks:
            return safe_json({"success": False, "error": "tracks required"}, 400)

        qm = QueueManager(tracks)
        optimized = qm.optimize(start_id)
        return safe_json({"success": True, "queue": optimized})
    except Exception as e:
        logger.error(f"Queue error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)


# ---------------------------------------------------------------------------
# Routes — Preferences
# ---------------------------------------------------------------------------

@app.route("/preferences", methods=["POST"])
def record_preference():
    """Record a liked or skipped transition."""
    try:
        if not request.is_json:
            return safe_json({"success": False, "error": "JSON body required"}, 400)
        data = request.get_json(silent=True) or {}
        action = data.get("action")
        transition_data = data.get("transition", {})

        learner = PreferenceLearner()
        if action == "like":
            learner.like(transition_data)
        elif action == "skip":
            learner.skip(transition_data)
        else:
            return safe_json({"success": False, "error": "action must be 'like' or 'skip'"}, 400)

        return safe_json({
            "success": True,
            "weights": learner.get_weights(),
            "stats": learner.get_stats(),
        })
    except Exception as e:
        logger.error(f"Preference error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)


@app.route("/preferences", methods=["GET"])
def get_preferences():
    """Get current learned weights and stats."""
    try:
        learner = PreferenceLearner()
        return safe_json({
            "success": True,
            "weights": learner.get_weights(),
            "stats": learner.get_stats(),
        })
    except Exception as e:
        logger.error(f"Preferences get error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)


# ---------------------------------------------------------------------------
# Routes — Cache
# ---------------------------------------------------------------------------

@app.route("/cache/clear", methods=["POST"])
def cache_clear():
    count = analysis_cache.clear_all()
    return safe_json({"success": True, "cleared": count})


@app.route("/cache/stats", methods=["GET"])
def cache_stats():
    return safe_json({"success": True, "count": analysis_cache.cache_size()})


# ---------------------------------------------------------------------------
# Routes — Stems (Demucs)
# ---------------------------------------------------------------------------

stem_logger = get_stem_logger()


@app.route("/separate", methods=["POST"])
def separate():
    """
    Separate an audio file into stems using Demucs.

    Accepts:
        - Multipart file upload: 'audio' field with mp3/wav/flac
        - JSON with 'audio_base64' and 'filename'

    Returns:
        {
            "success": true,
            "stems": {
                "vocals": "E:/.../vocals.wav",
                "drums":  "E:/.../drums.wav",
                "bass":   "E:/.../bass.wav",
                "other":  "E:/.../other.wav"
            }
        }
    """
    path = None
    try:
        path = handle_upload()
        if not path:
            return safe_json(
                {"success": False, "error": "No valid audio file"}, 400
            )

        force = request.args.get("force", "false").lower() == "true"
        timeout_str = request.args.get("timeout")
        timeout = int(timeout_str) if timeout_str else None

        stems = separate_stems(path, force=force, timeout=timeout)

        return safe_json({
            "success": True,
            "stems": stems,
        })
    except FileNotFoundError as e:
        stem_logger.error(f"File not found: {e}")
        return safe_json({"success": False, "error": str(e)}, 404)
    except ValueError as e:
        stem_logger.error(f"Validation error: {e}")
        return safe_json({"success": False, "error": str(e)}, 400)
    except subprocess.TimeoutExpired:
        stem_logger.error("Demucs timeout")
        return safe_json(
            {"success": False, "error": "Separation timed out"}, 504
        )
    except Exception as e:
        stem_logger.error(f"Separation error: {e}\n{traceback.format_exc()}")
        return safe_json({"success": False, "error": str(e)}, 500)
    finally:
        cleanup(path)


# ---------------------------------------------------------------------------
# Routes — Stem Mixing
# ---------------------------------------------------------------------------

@app.route("/generate_mix", methods=["POST"])
def generate_mix():
    """
    Offline stem mixing between two tracks.

    Accepts multipart upload with:
        - 'track_a' and 'track_b' file fields
        - 'mode' (optional): "vocal_carry" | "smooth" | "drop_switch"
        - 'bpm_a' and 'bpm_b' (optional): override BPM values
        - 'target_bpm' (optional): sync both tracks to this BPM
        - 'overlap_sec' (optional): transition duration (default 8s)
        - 'format' (optional): "wav" | "mp3" (default "wav")

    Returns:
        {
            "success": true,
            "output_path": "/absolute/path/to/final_mix.wav",
            "mode": "vocal_carry",
            "duration_sec": 120.5
        }
    """
    path_a = path_b = None
    try:
        # Support both multipart (web) and JSON base64 (React Native)
        if request.is_json:
            data = request.get_json() or {}
            import base64 as b64

            def _save_base64(b64data: str, fname: str) -> str:
                raw = b64.b64decode(b64data)
                name = secure_filename(fname)
                stem, ext = os.path.splitext(name)
                if not ext:
                    ext = ".mp3"
                path = os.path.join(
                    app.config["UPLOAD_FOLDER"],
                    f"{stem}_{int(datetime.now().timestamp())}{ext}"
                )
                with open(path, "wb") as fh:
                    fh.write(raw)
                return path

            a_b64 = data.get("track_a_base64")
            b_b64 = data.get("track_b_base64")
            if not a_b64 or not b_b64:
                return safe_json(
                    {"success": False, "error": "Both track_a_base64 and track_b_base64 required"}, 400
                )

            path_a = _save_base64(a_b64, data.get("track_a_name", "track_a.mp3"))
            path_b = _save_base64(b_b64, data.get("track_b_name", "track_b.mp3"))

            mode = data.get("mode", "vocal_carry")
            overlap_sec = float(data.get("overlap_sec", 8.0))
            bpm_a = float(data.get("bpm_a", 128.0))
            bpm_b = float(data.get("bpm_b", 128.0))
            target_bpm = float(data.get("target_bpm", bpm_a))
            fmt = data.get("format", "wav")
        else:
            # Multipart upload
            if "track_a" not in request.files or "track_b" not in request.files:
                return safe_json(
                    {"success": False, "error": "Both 'track_a' and 'track_b' required"}, 400
                )

            file_a = request.files["track_a"]
            file_b = request.files["track_b"]

            if file_a.filename == "" or file_b.filename == "":
                return safe_json({"success": False, "error": "Empty filenames"}, 400)

            def _save_file(f):
                name = secure_filename(f.filename)
                stem, ext = os.path.splitext(name)
                path = os.path.join(
                    app.config["UPLOAD_FOLDER"],
                    f"{stem}_{int(datetime.now().timestamp())}{ext}"
                )
                f.save(path)
                return path

            path_a = _save_file(file_a)
            path_b = _save_file(file_b)

            if not path_a or not path_b:
                return safe_json({"success": False, "error": "Invalid upload"}, 400)

            mode = request.form.get("mode", "vocal_carry")
            overlap_sec = float(request.form.get("overlap_sec", 8.0))
            bpm_a = float(request.form.get("bpm_a", 128.0))
            bpm_b = float(request.form.get("bpm_b", 128.0))
            target_bpm = float(request.form.get("target_bpm", bpm_a))
            fmt = request.form.get("format", "wav")

        transition_sec = float(data.get("transition_duration", 25.0) if request.is_json else request.form.get("transition_duration", 25.0))
        stem_logger.info(f"generate_mix: {mode} | transition={transition_sec:.0f}s | target_bpm={target_bpm}")

        # Step 1: Separate stems (cached if already done)
        a_stem_paths = separate_stems(path_a)
        b_stem_paths = separate_stems(path_b)

        # Step 2: Load stems
        a_stems = load_track_stems(os.path.dirname(a_stem_paths["vocals"]))
        b_stems = load_track_stems(os.path.dirname(b_stem_paths["vocals"]))
        sr = a_stems.get("_sr", 44100)

        # Step 3: BPM sync
        a_dict = {k: v for k, v in a_stems.items() if not k.startswith("_")}
        b_dict = {k: v for k, v in b_stems.items() if not k.startswith("_")}

        if abs(bpm_a - target_bpm) > 0.5:
            a_dict = stretch_stems_to_bpm(a_dict, sr, bpm_a, target_bpm)
        if abs(bpm_b - target_bpm) > 0.5:
            b_dict = stretch_stems_to_bpm(b_dict, sr, bpm_b, target_bpm)

        # Step 3b: AI Transition Analysis
        from stems.stem_loader import combine_stems as _combine
        a_mix = _combine(a_dict)
        b_mix = _combine(b_dict)

        # Use the new AI engine to analyze and plan the transition
        ai_plan = build_ai_transition_plan(
            a_mix, b_mix, sr,
            bpm_a=target_bpm,
            bpm_b=target_bpm,
        )

        # Override with user mode if explicitly provided (not "auto")
        final_mode = ai_plan.mode
        if mode != "auto":
            # Map user mode to engine mode
            mode_map = {
                "vocal_carry": "vocal_carry",
                "smooth": "smooth",
                "drop_switch": "drop_switch",
            }
            final_mode = mode_map.get(mode, ai_plan.mode)

        # User can cap duration
        final_duration = min(ai_plan.duration_sec, transition_sec)

        stem_logger.info(f"AI Plan: strategy={ai_plan.strategy.value} | mode={final_mode} | "
                          f"duration={final_duration:.1f}s | A@{ai_plan.a_start_sec:.1f}s | B@{ai_plan.b_start_sec:.1f}s")

        # Step 4: Build full DJ mix with AI-planned transition
        result, meta = build_dj_mix(
            a_dict, b_dict,
            sr=sr,
            mode=final_mode,
            transition_duration_sec=final_duration,
            a_transition_start_sec=ai_plan.a_start_sec,
            b_transition_start_sec=ai_plan.b_start_sec,
        )

        # Step 5: Export
        output_path = export_mix(result, sr, format=fmt)

        return safe_json({
            "success": True,
            "output_path": output_path,
            "mode": final_mode,
            "ai_strategy": ai_plan.strategy.value,
            "duration_sec": round(meta.total_duration_sec, 2),
            "sr": sr,
            "transition": {
                "start_sec": round(meta.transition_start_sec, 2),
                "blend_sec": round(meta.blend_start_sec, 2),
                "mashup_sec": round(meta.mashup_start_sec, 2),
                "drop_sec": round(meta.drop_sec, 2),
                "end_sec": round(meta.release_end_sec, 2),
                "phases": meta.phases,
                "bpm_a": meta.bpm_a,
                "bpm_b": meta.bpm_b,
                "ai_metadata": ai_plan.metadata,
                "ai_scores": ai_plan.scores.__dict__ if ai_plan.scores else {},
                "recommended_fx": ai_plan.recommended_fx,
            },
        })

    except ValueError as e:
        stem_logger.error(f"Mix validation error: {e}")
        return safe_json({"success": False, "error": str(e)}, 400)
    except Exception as e:
        stem_logger.error(f"Mix error: {e}\n{traceback.format_exc()}")
        return safe_json({"success": False, "error": str(e)}, 500)
    finally:
        cleanup(path_a)
        cleanup(path_b)


# ---------------------------------------------------------------------------
# Routes — Multi-Track Mix
# ---------------------------------------------------------------------------

@app.route("/generate_mix_multiple", methods=["POST"])
def generate_mix_multiple():
    """
    Generate an intelligent multi-track DJ mix from 2+ tracks.

    JSON body:
        - tracks: [{name, base64, bpm?}, ...]
        - mode: "auto" | "vocal_carry" | "smooth" | "drop_switch"
        - target_bpm: float (default = median of all tracks)
        - auto_order: bool (default = true, AI reorders tracks)
        - transition_duration: float (max duration cap)
        - format: "wav" | "mp3"

    Returns:
        JSON with output_path, timeline, energy_curve, track_order
    """
    import base64 as b64

    # Support both multipart form-data (efficient, no base64 overhead) and JSON base64 (legacy)
    if request.content_type and "multipart/form-data" in request.content_type:
        files = request.files.getlist("files")
        meta_str = request.form.get("metadata", "{}")
        meta = json.loads(meta_str) if meta_str else {}

        fmt = meta.get("format", "wav")
        mode = meta.get("mode", "auto")
        auto_order = meta.get("auto_order", True)
        target_bpm = meta.get("target_bpm")
        transition_cap = float(meta.get("transition_duration", 45.0))
        personality = meta.get("personality", "cinematic")
        energy_curve_shape = meta.get("energy_curve_shape")
        aggressiveness = meta.get("aggressiveness")
        fx_intensity = float(meta.get("fx_intensity", 0.5))
        fx_mode = meta.get("fx_mode", "normal")
        if aggressiveness is not None:
            aggressiveness = float(aggressiveness)

        track_bpms_from_meta = meta.get("bpms", [])
        track_names_from_meta = meta.get("names", [])

        track_paths = []
        track_ids = []
        track_bpms = []
        for i, f in enumerate(files):
            if not f or not allowed_file(f.filename):
                continue
            name = secure_filename(f.filename)
            stem, ext = os.path.splitext(name)
            path = os.path.join(
                app.config["UPLOAD_FOLDER"],
                f"multi_{stem}_{int(datetime.now().timestamp())}_{i}{ext}"
            )
            f.save(path)
            track_paths.append(path)
            track_ids.append(f"track_{i}_{stem}")
            bpm = float(track_bpms_from_meta[i]) if i < len(track_bpms_from_meta) else None
            track_bpms.append(bpm)
    else:
        # JSON base64 upload (legacy, less efficient, prone to 413)
        data = request.get_json(silent=True) or {}
        fmt = data.get("format", "wav")
        mode = data.get("mode", "auto")
        auto_order = data.get("auto_order", True)
        target_bpm = data.get("target_bpm")
        transition_cap = float(data.get("transition_duration", 45.0))
        personality = data.get("personality", "cinematic")
        energy_curve_shape = data.get("energy_curve_shape")
        aggressiveness = data.get("aggressiveness")
        fx_intensity = float(data.get("fx_intensity", 0.5))
        fx_mode = data.get("fx_mode", "normal")
        if aggressiveness is not None:
            aggressiveness = float(aggressiveness)

        track_list = data.get("tracks", [])
        if not track_list or len(track_list) < 2:
            return safe_json(
                {"success": False, "error": "At least 2 tracks required in 'tracks' array"}, 400
            )

        track_paths = []
        track_ids = []
        track_bpms = []
        for i, t in enumerate(track_list):
            name = secure_filename(t.get("name", f"track_{i}.mp3"))
            b64data = t.get("base64", "")
            if not b64data:
                continue
            stem, ext = os.path.splitext(name)
            if not ext:
                ext = ".mp3"
            path = os.path.join(
                app.config["UPLOAD_FOLDER"],
                f"multi_{stem}_{int(datetime.now().timestamp())}_{i}{ext}"
            )
            raw = b64.b64decode(b64data)
            with open(path, "wb") as fh:
                fh.write(raw)
            track_paths.append(path)
            track_ids.append(f"track_{i}_{stem}")
            track_bpms.append(float(t.get("bpm", 0)) or None)

    if len(track_paths) < 2:
        return safe_json(
            {"success": False, "error": "Need at least 2 valid tracks"}, 400
        )

    try:
        stem_logger.info(f"Multi-track mix: {len(track_paths)} tracks, mode={mode}, personality={personality}, auto_order={auto_order}")

        # Step 1: Separate stems for all tracks
        all_stems = []
        all_bpms = []
        sr = 44100
        for idx, path in enumerate(track_paths):
            stem_paths = separate_stems(path)
            stems = load_track_stems(os.path.dirname(stem_paths["vocals"]))
            all_stems.append(stems)
            sr = stems.get("_sr", 44100)
            # Use provided BPM or detect
            bpm = track_bpms[idx]
            if bpm is None:
                try:
                    import librosa
                    y, _ = librosa.load(path, sr=sr, duration=30)
                    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
                    bpm = float(tempo)
                except Exception:
                    bpm = 128.0
            all_bpms.append(bpm)

        # Step 2: Build MixEngine
        mix_engine = MixEngine(sr=sr)
        for track_id, stems, bpm in zip(track_ids, all_stems, all_bpms):
            stem_dict = {k: v for k, v in stems.items() if not k.startswith("_")}
            mix_engine.add_track(track_id, stem_dict, bpm=bpm)

        # Step 3: Auto-order if requested
        if auto_order:
            mix_engine.auto_order_tracks()

        # Step 4: Generate mix
        result_audio, timeline, metadata = mix_engine.generate_mix(
            mode=mode,
            target_bpm=target_bpm,
            max_duration_sec=transition_cap,
            personality_type=personality,
            energy_curve_shape=energy_curve_shape,
            user_aggressiveness=aggressiveness,
            fx_intensity=fx_intensity,
            fx_mode=fx_mode,
        )

        # Step 5: Export
        output_path = export_mix(result_audio, sr, format=fmt)

        return safe_json({
            "success": True,
            "output_path": output_path,
            "mode": mode,
            "track_order": metadata["track_order"],
            "total_duration_sec": round(metadata["total_duration_sec"], 2),
            "target_bpm": metadata["target_bpm"],
            "num_tracks": metadata["num_tracks"],
            "personality": metadata.get("personality", personality),
            "energy_curve_shape": metadata.get("energy_curve_shape", energy_curve_shape),
            "fatigue_final": metadata.get("fatigue_final", 0),
            "emotions": metadata.get("emotions", {}),
            "scenes": metadata.get("scenes", []),
            "dna_history": metadata.get("dna_history", []),
            "timeline": {
                "events": metadata["events"],
                "energy_curve": metadata["energy_curve"],
            },
        })

    except ValueError as e:
        stem_logger.error(f"Multi-mix validation error: {e}")
        return safe_json({"success": False, "error": str(e)}, 400)
    except Exception as e:
        stem_logger.error(f"Multi-mix error: {e}\n{traceback.format_exc()}")
        return safe_json({"success": False, "error": str(e)}, 500)
    finally:
        for path in track_paths:
            cleanup(path)


# ---------------------------------------------------------------------------
# Routes — Download Mix
# ---------------------------------------------------------------------------

@app.route("/download_mix/<filename>", methods=["GET"])
def download_mix(filename):
    """
    Download a generated mix file (WAV or MP3).

    Args:
        filename: Name of the file to download (e.g. final_mix.wav)

    Returns:
        The audio file with appropriate Content-Type.
    """
    from flask import send_file

    safe_name = secure_filename(filename)
    if not safe_name:
        return safe_json({"success": False, "error": "Invalid filename"}, 400)

    file_path = OUTPUT_DIR / safe_name
    if not file_path.exists():
        return safe_json({"success": False, "error": "File not found"}, 404)

    mime = "audio/wav" if safe_name.endswith(".wav") else "audio/mpeg"
    try:
        return send_file(
            str(file_path),
            mimetype=mime,
            as_attachment=True,
            download_name=safe_name,
        )
    except Exception as e:
        stem_logger.error(f"Download error: {e}")
        return safe_json({"success": False, "error": str(e)}, 500)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return safe_json({
        "status": "ok",
        "madmom": False,
        "stack": "librosa+numpy+scipy",
        "modules": ["analysis", "mixing", "ai", "cache", "providers"],
        "timestamp": datetime.utcnow().isoformat(),
    })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    logger.info(f"BeatBlend AI server starting on port {port} (debug={debug})")
    app.run(host="0.0.0.0", port=port, debug=debug)
