# Mise à jour du backend Python pour le crossfade DJ

## Modification requise

Le backend Python doit être modifié pour retourner la durée des fichiers audio en plus du BPM.

## Changement dans la réponse

Actuellement, le backend retourne:
```json
{
  "success": true,
  "bpm": 120
}
```

Il doit retourner:
```json
{
  "success": true,
  "bpm": 120,
  "duration": 180.5
}
```

## Exemple d'implémentation avec librosa

```python
import librosa

# Charger le fichier audio
y, sr = librosa.load(audio_file)

# Détecter le BPM
tempo, _ = librosa.beat.beat_track(y=y, sr=sr)

# Obtenir la durée en secondes
duration = librosa.get_duration(y=y, sr=sr)

# Retourner les résultats
return {
    "success": True,
    "bpm": float(tempo),
    "duration": duration
}
```

## Exemple d'implémentation avec pydub

```python
from pydub import AudioSegment

# Charger le fichier audio
audio = AudioSegment.from_file(audio_file)

# Obtenir la durée en secondes
duration = len(audio) / 1000.0  # pydub retourne des millisecondes

# Détecter le BPM (votre méthode actuelle)
bpm = ... # votre méthode de détection BPM

# Retourner les résultats
return {
    "success": True,
    "bpm": bpm,
    "duration": duration
}
```

## Point de terminaison

Le point de terminaison `/bpm` doit être modifié pour inclure la durée dans la réponse JSON.
