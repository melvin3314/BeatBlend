# Mise à jour du Backend Python pour Auto-DJ Intelligent

Ce document contient les instructions pour mettre à jour le backend Python afin de supporter les nouvelles fonctionnalités d'analyse avancée pour le système Auto-DJ.

## Nouveaux endpoints nécessaires

### 1. Endpoint BPM amélioré (existant à mettre à jour)

**Endpoint actuel:** `POST /bpm`

**Nouveau format de réponse:**
```json
{
  "success": true,
  "bpm": 120.5,
  "duration": 180.0,
  "beats": [0.0, 0.5, 1.0, 1.5, ...],  // Timestamps des beats en secondes
  "confidence": 0.95
}
```

**Implémentation Python:**
```python
@app.route('/bpm', methods=['POST'])
def analyze_bpm():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file provided"}), 400
    
    file = request.files['file']
    
    # Sauvegarder temporairement
    temp_path = f"temp_{file.filename}"
    file.save(temp_path)
    
    try:
        # Charger l'audio
        y, sr = librosa.load(temp_path)
        
        # Détection des beats
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        
        # Obtenir la durée
        duration = librosa.get_duration(y=y, sr=sr)
        
        # Calculer la confiance
        confidence = librosa.beat.beat_track(y=y, sr=sr)[1]
        
        return jsonify({
            "success": True,
            "bpm": float(tempo),
            "duration": duration,
            "beats": beat_times.tolist(),
            "confidence": float(confidence)
        })
    finally:
        os.remove(temp_path)
```

### 2. Nouvel endpoint Energy Analysis

**Endpoint:** `POST /energy`

**Format de réponse:**
```json
{
  "success": true,
  "rms": [0.1, 0.2, 0.3, ...],  // Énergie RMS par segment
  "spectralCentroid": [1000, 1200, ...],  // Centroïde spectral par segment
  "timestamps": [0.0, 1.0, 2.0, ...],  // Timestamps des segments
  "sections": [
    {
      "startTime": 0.0,
      "endTime": 10.0,
      "energyLevel": "low",
      "type": "intro"
    },
    ...
  ]
}
```

**Implémentation Python:**
```python
@app.route('/energy', methods=['POST'])
def analyze_energy():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file provided"}), 400
    
    file = request.files['file']
    
    # Sauvegarder temporairement
    temp_path = f"temp_{file.filename}"
    file.save(temp_path)
    
    try:
        # Charger l'audio
        y, sr = librosa.load(temp_path)
        
        # Calculer RMS par segments de 1 seconde
        segment_duration = 1.0
        rms = []
        spectral_centroids = []
        timestamps = []
        
        for i in range(0, int(librosa.get_duration(y=y, sr=sr)), int(segment_duration)):
            start = i * sr
            end = (i + 1) * sr
            segment = y[start:end]
            
            # RMS
            rms_value = librosa.feature.rms(y=segment)[0][0]
            rms.append(float(rms_value))
            
            # Centroïde spectral
            spec_cent = librosa.feature.spectral_centroid(y=segment, sr=sr)[0][0]
            spectral_centroids.append(float(spec_cent))
            
            timestamps.append(float(i * segment_duration))
        
        # Détecter les sections
        sections = detect_sections(rms, timestamps)
        
        return jsonify({
            "success": True,
            "rms": rms,
            "spectralCentroid": spectral_centroids,
            "timestamps": timestamps,
            "sections": sections
        })
    finally:
        os.remove(temp_path)

def detect_sections(rms, timestamps):
    threshold_low = 0.3
    threshold_high = 0.7
    
    sections = []
    current_section = {
        "startTime": timestamps[0],
        "endTime": timestamps[0],
        "energyLevel": "medium",
        "type": "unknown"
    }
    
    for i, (energy, time) in enumerate(zip(rms, timestamps)):
        if energy < threshold_low:
            energy_level = "low"
        elif energy < threshold_high:
            energy_level = "medium"
        else:
            energy_level = "high"
        
        if current_section["energyLevel"] != energy_level:
            sections.append(current_section.copy())
            current_section = {
                "startTime": time,
                "endTime": time,
                "energyLevel": energy_level,
                "type": "unknown"
            }
        else:
            current_section["endTime"] = time
    
    sections.append(current_section)
    
    # Classifier les sections
    if sections:
        sections[0]["type"] = "intro"
        sections[-1]["type"] = "outro"
        for i in range(1, len(sections) - 1):
            if sections[i]["energyLevel"] == "high":
                sections[i]["type"] = "chorus"
            else:
                sections[i]["type"] = "verse"
    
    return sections
```

### 3. Endpoint Harmonic Analysis (Bonus)

**Endpoint:** `POST /harmonic`

**Format de réponse:**
```json
{
  "success": true,
  "key": "C",
  "camelotWheel": "1A",
  "scale": "major"
}
```

**Implémentation Python:**
```python
@app.route('/harmonic', methods=['POST'])
def analyze_harmonic():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file provided"}), 400
    
    file = request.files['file']
    
    # Sauvegarder temporairement
    temp_path = f"temp_{file.filename}"
    file.save(temp_path)
    
    try:
        # Charger l'audio
        y, sr = librosa.load(temp_path)
        
        # Détecter la tonalité
        chroma = librosa.feature.chroma_stft(y=y, sr=sr)
        key = estimate_key(chroma)
        
        # Convertir en Camelot wheel
        camelot = key_to_camelot(key)
        
        return jsonify({
            "success": True,
            "key": key,
            "camelotWheel": camelot,
            "scale": "major" if camelot.endswith("A") else "minor"
        })
    finally:
        os.remove(temp_path)

def estimate_key(chroma):
    # Implémentation simplifiée de la détection de tonalité
    # Utiliser librosa.key ou une implémentation personnalisée
    chroma_mean = np.mean(chroma, axis=1)
    key_indices = np.argsort(chroma_mean)[-2:]  # Top 2
    keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    return keys[key_indices[0]]

def key_to_camelot(key):
    # Mapping simplifié vers Camelot wheel
    camelot_map = {
        'C': '1A', 'C#': '2A', 'D': '3A', 'D#': '4A', 'E': '5A',
        'F': '6A', 'F#': '7A', 'G': '8A', 'G#': '9A', 'A': '10A',
        'A#': '11A', 'B': '12A'
    }
    return camelot_map.get(key, '1A')
```

## Dépendances Python nécessaires

Ajoutez ces dépendances à votre `requirements.txt`:

```txt
librosa>=0.10.0
numpy>=1.24.0
flask>=2.3.0
werkzeug>=2.3.0
soundfile>=0.12.0
```

## Structure du serveur

```python
from flask import Flask, request, jsonify
import librosa
import numpy as np
import os

app = Flask(__name__)

# Endpoints ici...

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
```

## Instructions de déploiement

1. Mettre à jour le code du serveur avec les nouveaux endpoints
2. Installer les dépendances: `pip install -r requirements.txt`
3. Redémarrer le serveur: `python server.py`
4. Tester les endpoints avec Postman ou curl

## Tests

### Test BPM endpoint:
```bash
curl -X POST -F "file=@test.mp3" http://localhost:5000/bpm
```

### Test Energy endpoint:
```bash
curl -X POST -F "file=@test.mp3" http://localhost:5000/energy
```

### Test Harmonic endpoint:
```bash
curl -X POST -F "file=@test.mp3" http://localhost:5000/harmonic
```
