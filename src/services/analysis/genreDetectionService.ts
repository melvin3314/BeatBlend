/**
 * Genre Detection Service
 * Détecte le genre musical d'un morceau via heuristiques sur le nom,
 * le BPM, l'énergie et les caractéristiques audio.
 *
 * Genres reconnus :
 * rap, trap, rage, phonk, drill, house, techno, hard_techno,
 * edm, reggae, afro, hyperpop, lofi, pop
 */

export type Genre =
  | "rap"
  | "trap"
  | "rage"
  | "phonk"
  | "drill"
  | "house"
  | "techno"
  | "hard_techno"
  | "edm"
  | "reggae"
  | "afro"
  | "hyperpop"
  | "lofi"
  | "pop"
  | "unknown";

export interface GenreDetectionResult {
  genre: Genre;
  confidence: number; // 0-1
  candidates: { genre: Genre; score: number }[];
}

// Mots-clés par genre (ordre = priorité, plus spécifique en premier)
const GENRE_KEYWORDS: Record<Genre, string[]> = {
  phonk: ["phonk", "drift phonk", "memphis phonk", "cowbell"],
  rage: ["rage", "rg", "rage edit"],
  drill: ["drill", "uk drill", "ny drill", "chicago drill"],
  trap: ["trap", "latino trap", "emotional trap", "melodic trap"],
  rap: ["rap", "hip hop", "hiphop", "freestyle", "boom bap", "mumble"],
  hard_techno: ["hard techno", "hardtechno", "schranz", "industrial techno", "raw techno"],
  techno: ["techno", "acid techno", "minimal techno", "dub techno", "tech house"],
  house: ["house", "deep house", "progressive house", "future house", "electro house"],
  edm: ["edm", "electro", "dubstep", "future bass", "big room", "trance", "hardstyle"],
  hyperpop: ["hyperpop", "digicore", "glitchcore", "nightcore"],
  lofi: ["lofi", "lo-fi", "chillhop", "chill beat", "study beat", "ambient"],
  reggae: ["reggae", "dancehall", "dub", "raggamuffin", "ragga", "roots"],
  afro: ["afro", "afrobeat", "amapiano", "afro house", "afropop"],
  pop: ["pop", "synth pop", "indie pop", "kpop", "electropop"],
  unknown: [],
};

// Plages BPM caractéristiques par genre (min, max, optimal)
const GENRE_BPM_RANGES: Record<Genre, { min: number; max: number; optimal: number }> = {
  phonk: { min: 120, max: 150, optimal: 140 },
  rage: { min: 140, max: 180, optimal: 150 },
  drill: { min: 130, max: 160, optimal: 144 },
  trap: { min: 120, max: 180, optimal: 140 },
  rap: { min: 70, max: 110, optimal: 90 },
  hard_techno: { min: 145, max: 180, optimal: 160 },
  techno: { min: 120, max: 150, optimal: 128 },
  house: { min: 118, max: 135, optimal: 128 },
  edm: { min: 120, max: 150, optimal: 128 },
  hyperpop: { min: 140, max: 180, optimal: 160 },
  lofi: { min: 60, max: 95, optimal: 72 },
  reggae: { min: 65, max: 105, optimal: 90 },
  afro: { min: 100, max: 130, optimal: 118 },
  pop: { min: 90, max: 130, optimal: 120 },
  unknown: { min: 0, max: 999, optimal: 128 },
};

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\.mp3|\.wav|\.flac|\.m4a/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreKeywordMatch(title: string, keywords: string[]): number {
  const norm = normalizeTitle(title);
  let score = 0;
  for (const kw of keywords) {
    const kwNorm = kw.toLowerCase();
    if (norm.includes(kwNorm)) {
      // Plus le mot-clé est long/précis, plus il pèse
      score += kwNorm.length * 0.5 + 1;
      // Bonus si c'est au début du titre
      if (norm.startsWith(kwNorm)) score += 2;
    }
  }
  return score;
}

function scoreBpmMatch(genre: Genre, bpm: number): number {
  const range = GENRE_BPM_RANGES[genre];
  if (bpm < range.min || bpm > range.max) return 0;
  const dist = Math.abs(bpm - range.optimal);
  const rangeSpan = range.max - range.min;
  return Math.max(0, 1 - dist / (rangeSpan * 0.6));
}

/**
 * Détecte le genre d'un morceau à partir de son titre et BPM.
 * Heuristique rapide, pas besoin d'analyse audio lourde.
 */
export function detectGenre(
  title: string,
  bpm?: number,
  energy?: number
): GenreDetectionResult {
  const candidates: { genre: Genre; score: number }[] = [];

  const genresToCheck: Genre[] = [
    "phonk", "rage", "drill", "trap", "rap",
    "hard_techno", "techno", "house", "edm",
    "hyperpop", "lofi", "reggae", "afro", "pop",
  ];

  for (const genre of genresToCheck) {
    let score = scoreKeywordMatch(title, GENRE_KEYWORDS[genre]);

    if (bpm && bpm > 0) {
      const bpmScore = scoreBpmMatch(genre, bpm);
      score += bpmScore * 3; // Le BPM a beaucoup de poids
    }

    if (energy !== undefined) {
      // Ajustements énergie
      if (genre === "lofi" && energy > 0.6) score -= 2;
      if (genre === "hard_techno" && energy < 0.7) score -= 2;
      if (genre === "rage" && energy < 0.8) score -= 2;
    }

    if (score > 0) {
      candidates.push({ genre, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    // Fallback BPM-based si pas de match textuel
    if (bpm) {
      if (bpm >= 145) return { genre: "techno", confidence: 0.4, candidates: [] };
      if (bpm >= 130) return { genre: "trap", confidence: 0.4, candidates: [] };
      if (bpm >= 118) return { genre: "house", confidence: 0.4, candidates: [] };
      if (bpm <= 95) return { genre: "lofi", confidence: 0.4, candidates: [] };
    }
    return { genre: "unknown", confidence: 0, candidates: [] };
  }

  const best = candidates[0];
  const totalScore = candidates.reduce((s, c) => s + c.score, 0);
  const confidence = Math.min(1, best.score / (totalScore * 0.6 + 1));

  return {
    genre: best.genre,
    confidence,
    candidates: candidates.slice(0, 3),
  };
}

/**
 * Renvoie la plage BPM typique pour un genre.
 */
export function getGenreBpmRange(genre: Genre): { min: number; max: number; optimal: number } {
  return GENRE_BPM_RANGES[genre] ?? GENRE_BPM_RANGES.unknown;
}
