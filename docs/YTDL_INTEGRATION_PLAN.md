# Plan Technique — Intégration YouTube-DL (yt-dlp)

## Objectif
Permettre à l'utilisateur de coller une URL playlist YouTube. L'app télécharge les morceaux **un par un en cache**, les analyse via le server existant, les joue, puis les supprime automatiquement.

---

## Architecture

```
┌─────────────┐     URL playlist      ┌──────────────┐
│   React     │ ────────────────────> │  Flask       │
│   Native    │                       │  server.py   │
│   (App)     │ <── JSON metadata ─── │              │
└─────────────┘                       └──────────────┘
       │                                     │
       │  POST /download?index=0             │ yt-dlp download
       │ ────────────────────────────────>  │ + ffmpeg MP3
       │                                     │
       │ <── {uri: "file://..."} ─────────  │
       │                                     │
       │  POST /analyze (existant)           │
       │ ────────────────────────────────>  │
       │                                     │
       │  POST /download?index=1             │ (précharge next)
       │ ────────────────────────────────>  │
       │                                     │
       │  POST /cleanup?index=0              │ suppression MP3
       │ ────────────────────────────────>  │
```

---

## 1. Server Python (server.py) — Nouveaux endpoints

### `GET /playlist-info?url=<playlist_url>`
Retourne la liste des vidéos sans télécharger.

```json
{
  "title": "My Mix",
  "entries": [
    { "index": 0, "title": "Track A", "duration": 195, "id": "abc123" },
    { "index": 1, "title": "Track B", "duration": 240, "id": "def456" }
  ]
}
```

**Implémentation :**
```python
@app.route("/playlist-info")
def playlist_info():
    url = request.args.get("url")
    opts = {"quiet": True, "extract_flat": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return jsonify({
        "title": info.get("title"),
        "entries": [{"index": i, "title": e["title"], "duration": e.get("duration"), "id": e["id"]} for i, e in enumerate(info["entries"])]
    })
```

---

### `POST /download`
Télécharge une seule vidéo en MP3.

**Body :**
```json
{ "url": "https://youtube.com/...", "index": 0 }
```

**Retour :**
```json
{ "uri": "file://192.168.1.x/cache/0_track_a.mp3", "title": "Track A", "duration": 195 }
```

**Implémentation :**
```python
import os, yt_dlp

CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

@app.route("/download", methods=["POST"])
def download_track():
    data = request.json
    url = data["url"]
    index = data["index"]

    out_template = os.path.join(CACHE_DIR, f"{index}_%(title)s.%(ext)s")
    opts = {
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "quiet": True,
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filepath = ydl.prepare_filename(info).replace(".webm", ".mp3").replace(".m4a", ".mp3")

    # Retourne l'URL accessible depuis le réseau local
    local_ip = get_local_ip()
    file_url = f"http://{local_ip}:5000/cache/{os.path.basename(filepath)}"

    return jsonify({"uri": file_url, "title": info["title"], "duration": info.get("duration", 0)})
```

---

### `POST /cleanup`
Supprime le MP3 du cache.

**Body :**
```json
{ "filename": "0_track_a.mp3" }
```

**Implémentation :**
```python
@app.route("/cleanup", methods=["POST"])
def cleanup():
    filename = request.json["filename"]
    path = os.path.join(CACHE_DIR, filename)
    if os.path.exists(path):
        os.remove(path)
    return jsonify({"ok": True})
```

---

### `GET /cache/<filename>`
Sert les fichiers MP3 téléchargés (pour que l'app puisse les lire via `expo-av`).

**Implémentation :**
```python
from flask import send_from_directory

@app.route("/cache/<path:filename>")
def serve_cache(filename):
    return send_from_directory(CACHE_DIR, filename)
```

---

## 2. App React Native — Nouveaux hooks/composants

### `useYouTubePlaylist.ts` — Hook de gestion

```typescript
export const useYouTubePlaylist = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [playlist, setPlaylist] = useState<YTTrack[]>([]);

  const loadPlaylist = async (url: string) => {
    setIsLoading(true);
    const res = await fetch(`${SERVER_URL}/playlist-info?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    setPlaylist(data.entries);
    setIsLoading(false);
    return data.entries;
  };

  const downloadTrack = async (index: number) => {
    // Récupère l'URL de la vidéo via l'index de la playlist
    const entry = playlist[index];
    const videoUrl = `https://youtube.com/watch?v=${entry.id}`;

    const res = await fetch(`${SERVER_URL}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl, index }),
    });
    const data = await res.json();
    return data; // { uri, title, duration }
  };

  const cleanupTrack = async (filename: string) => {
    await fetch(`${SERVER_URL}/cleanup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
  };

  return { loadPlaylist, downloadTrack, cleanupTrack, playlist, isLoading };
};
```

---

### `YouTubeImport.tsx` — UI

```tsx
export const YouTubeImport: React.FC<{ onTracksReady: (tracks: SelectedTrack[]) => void }> = ({
  onTracksReady,
}) => {
  const [url, setUrl] = useState("");
  const { loadPlaylist, downloadTrack, playlist } = useYouTubePlaylist();

  const handleImport = async () => {
    const entries = await loadPlaylist(url);

    // Télécharge les 2 premiers morceaux
    const track0 = await downloadTrack(0);
    const track1 = await downloadTrack(1);

    const tracks: SelectedTrack[] = [
      { name: track0.title, uri: track0.uri },
      { name: track1.title, uri: track1.uri },
    ];

    onTracksReady(tracks);
  };

  return (
    <View>
      <TextInput
        placeholder="URL playlist YouTube..."
        value={url}
        onChangeText={setUrl}
      />
      <Button title="Importer" onPress={handleImport} />
    </View>
  );
};
```

---

## 3. Flow de lecture avec préchargement intelligent

```
1. User colle URL → loadPlaylist() → liste des vidéos
2. Télécharge index 0 → analyse → start playback
3. En parallèle : télécharge index 1 (précharge)
4. Quand on passe au morceau 2 :
   - Joue index 1 (déjà en cache)
   - Télécharge index 2
   - Supprime index 0 (cleanup)
5. Répète...
```

---

## 4. Dépendances à installer

### Server
```bash
pip install yt-dlp flask
# + ffmpeg installé sur la machine (yt-dlp l'utilise pour conversion MP3)
```

### App
- `expo-file-system` (si besoin de cache local côté app, mais ici le cache est server-side)
- Rien d'autre — le server sert les fichiers via HTTP

---

## 5. Pièges et limitations

| Problème | Solution |
|----------|----------|
| **Latence initiale** | Précharger 2 morceaux avant start playback |
| **Timeout réseau** | yt-dlp peut être lent ; augmenter timeout fetch à 60s |
| **Espace disque** | Cleanup automatique après lecture + limiter à 3 fichiers en cache |
| **YouTube bloque l'IP** | Rotation de User-Agent possible mais grey area |
| **Titres avec caractères spéciaux** | Sanitizer les filenames dans `outtmpl` yt-dlp |
| **Playlist > 50 morceaux** | Pagination : charger les metadata par batch de 20 |
| **Pas de réseau** | Fallback sur les morceaux déjà en cache |

---

## 6. Estimation de charge

| Tâche | Lignes | Complexité |
|-------|--------|------------|
| Endpoints server (3) | ~80 | Moyenne |
| Hook `useYouTubePlaylist` | ~60 | Moyenne |
| UI paste URL + progress | ~40 | Faible |
| Intégration dans `useAutoDJ` (préchargement) | ~30 | Moyenne |
| Gestion erreurs / retry | ~40 | Moyenne |
| **Total** | **~250 lignes** | **Moyenne** |

---

## Verdict

**Réalisable en ~2-3 heures** si :
- `ffmpeg` est déjà installé sur ta machine
- Tu as une IP locale stable (même réseau WiFi)
- Tu acceptes la latence de ~10-20s au premier lancement

**Non recommandé si :**
- Tu veux de l'instantané (les MP3 locaux sont instantanés)
- Tu veux rester 100% offline
- Tu veux éviter les dépendances Python supplémentaires
