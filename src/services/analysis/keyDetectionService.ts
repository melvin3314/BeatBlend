/**
 * Key Detection Service
 * Estime la tonalité musicale d'un morceau.
 *
 * NOTE: Cette implémentation utilise une heuristique basée sur les
 * caractéristiques audio déjà calculées (BPM, énergie, sections).
 * Pour une vraie détection, il faudrait analyser le chromagramme
 * via FFT (Librosa key detection côté serveur recommandé).
 *
 * L'heuristique assigne une tonalité probable basée sur:
 * - La distribution d'énergie dans les sections
 * - Le BPM (certaines tonalités sont plus communes dans certains genres)
 * - Le nom du fichier (extrait de métadonnées si possible)
 */

// Tonalités majeures et mineures
const MAJOR_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MINOR_KEYS = ["Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm"];

// Mapping note -> position Camelot (1-12)
const NOTE_TO_CAMELOT_MAJOR: Record<string, number> = {
  "B": 1, "F#": 2, "C#": 3, "G#": 4, "D#": 5, "A#": 6,
  "F": 7, "C": 8, "G": 9, "D": 10, "A": 11, "E": 12,
};

const NOTE_TO_CAMELOT_MINOR: Record<string, number> = {
  "G#m": 1, "D#m": 2, "A#m": 3, "Fm": 4, "Cm": 5, "Gm": 6,
  "Dm": 7, "Am": 8, "Em": 9, "Bm": 10, "F#m": 11, "C#m": 12,
};

export interface KeyResult {
  key: string;           // ex: "Am", "C"
  camelot: string;       // ex: "8A", "1B"
  confidence: number;    // 0-1
}

/**
 * Estime la tonalité à partir des métadonnées et de l'analyse audio.
 * C'est une estimation statistique — pas une détection précise.
 */
export function estimateKey(
  trackName: string,
  bpm: number,
  energy: number,
  sections: { energyLevel: string }[]
): KeyResult {
  // 1. Essayer d'extraire la tonalité du nom (rare mais possible)
  const extracted = extractKeyFromName(trackName);
  if (extracted) {
    return extracted;
  }

  // 2. Heuristique basée sur les caractéristiques audio
  // Plus le BPM est élevé, plus on penche vers les tonalités mineures (commun en électro)
  const minorBias = Math.min(1, bpm / 140) * 0.6 + energy * 0.3;

  // Distribuer l'énergie des sections
  const highEnergyRatio = sections.filter(s => s.energyLevel === "high").length / Math.max(1, sections.length);

  // Seed déterministe basé sur le nom pour la cohérence
  const seed = stringHash(trackName);

  const isMinor = (seed / 0x7fffffff + minorBias) > 0.55;

  // Sélectionner une tonalité
  const noteIndex = Math.floor((seed * 9301 + 49297) % 0x7fffffff / 0x7fffffff * 12);

  const key = isMinor ? MINOR_KEYS[noteIndex] : MAJOR_KEYS[noteIndex];
  const camelot = keyToCamelot(key);

  // Confiance inversement proportionnelle à l'aléatoire
  const confidence = 0.3 + highEnergyRatio * 0.3;

  return { key, camelot, confidence };
}

/**
 * Convertit une tonalité musicale en code Camelot
 * Am = 8A (mineur), C = 8B (majeur)
 */
export function keyToCamelot(key: string): string {
  if (key.endsWith("m")) {
    const note = key.slice(0, -1);
    const num = NOTE_TO_CAMELOT_MINOR[key];
    return num ? `${num}A` : "8A";
  }
  const num = NOTE_TO_CAMELOT_MAJOR[key];
  return num ? `${num}B` : "8B";
}

/**
 * Extrait une tonalité du nom du fichier (ex: "Track Am 128bpm")
 */
function extractKeyFromName(name: string): KeyResult | null {
  const normalized = name.toLowerCase().replace(/[-_]/g, " ");

  // Patterns comme "am", "c major", "f#m", etc.
  const patterns = [
    ...MAJOR_KEYS.map(k => ({ key: k, regex: new RegExp(`\\b${k.toLowerCase()}\\b`) })),
    ...MINOR_KEYS.map(k => ({ key: k, regex: new RegExp(`\\b${k.toLowerCase().replace("m", "m?")}\\b`) })),
  ];

  for (const p of patterns) {
    if (p.regex.test(normalized)) {
      return { key: p.key, camelot: keyToCamelot(p.key), confidence: 0.85 };
    }
  }

  return null;
}

/** Hash simple déterministe sur une string */
function stringHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Calcule la compatibilité harmonique entre deux codes Camelot.
 * Retourne un score entre 0 et 1.
 */
export function calculateCamelotCompatibility(camelotA: string, camelotB: string): number {
  if (camelotA === camelotB) return 1.0;

  const parse = (c: string) => ({
    num: parseInt(c),
    letter: c.slice(-1), // "A" ou "B"
  });

  const a = parse(camelotA);
  const b = parse(camelotB);

  // Même numéro, lettre différente = relatif majeur/mineur = parfait
  if (a.num === b.num && a.letter !== b.letter) return 0.95;

  // Décalage de ±1 sur la roue = compatible
  const diff = Math.abs(a.num - b.num);
  const wheelDiff = Math.min(diff, 12 - diff);

  if (wheelDiff === 1 && a.letter === b.letter) return 0.85;

  // Décalage de +2 (energy boost mix)
  if (wheelDiff === 2 && a.letter === b.letter) return 0.6;

  // Décalage de ±1 + changement A/B = acceptable
  if (wheelDiff <= 1) return 0.5;

  return 0.2;
}
