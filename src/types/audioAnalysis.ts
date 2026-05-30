export interface BeatDetectionResult {
  beats: number[]; // Timestamps des beats en secondes
  bpm: number;
  confidence: number;
}

export interface BarDetectionResult {
  bars: number[]; // Timestamps des débuts de mesures en secondes
  beatsPerBar: number; // Généralement 4
}

export interface EnergyAnalysisResult {
  rms: number[]; // Énergie RMS par segment
  spectralCentroid: number[]; // Centroïde spectral par segment
  timestamps: number[]; // Timestamps des segments
  sections: EnergySection[];
}

export interface EnergySection {
  startTime: number;
  endTime: number;
  energyLevel: 'low' | 'medium' | 'high' | 'explosive';
  type: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' | 'break' | 'buildup' | 'drop' | 'unknown';
}

export interface DropDetectionResult {
  drops: DropPoint[];
  buildups: DropPoint[];
}

export interface DropPoint {
  timestamp: number;
  energyBefore: number;
  energyAfter: number;
  type: 'drop' | 'buildup';
}

export interface HarmonicAnalysisResult {
  key: string; // Ex: "C", "Cm", "F#"
  camelotWheel: string; // Ex: "1A", "8B"
  scale: 'major' | 'minor';
}

export interface TrackAnalysis {
  beatDetection: BeatDetectionResult;
  barDetection: BarDetectionResult;
  energyAnalysis: EnergyAnalysisResult;
  dropDetection: DropDetectionResult;
  harmonicAnalysis?: HarmonicAnalysisResult;
  duration: number;
}

export interface TransitionPoint {
  timestamp: number;
  energyLevel: 'low' | 'medium' | 'high' | 'explosive';
  sectionType: string;
  isBarStart: boolean;
  confidence: number;
}

export interface TransitionPlan {
  trackAOutPoint: number;
  trackBInPoint: number;
  transitionDuration: number;
  energyMatch: number;
  harmonicMatch: number;
  confidence: number;
}
