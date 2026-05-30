export type TempoSyncResult = {
  targetBpm: number;
  playbackRateA: number;
  playbackRateB: number;
};

const clampPlaybackRate = (rate: number): number => {
  const min = 0.85;
  const max = 1.15;
  return Math.min(max, Math.max(min, rate));
};

export const computeTempoSync = (bpmA: number, bpmB: number): TempoSyncResult => {
  const targetBpm = Math.round((bpmA + bpmB) / 2);

  const rawRateA = targetBpm / bpmA;
  const rawRateB = targetBpm / bpmB;

  return {
    targetBpm,
    playbackRateA: clampPlaybackRate(rawRateA),
    playbackRateB: clampPlaybackRate(rawRateB),
  };
};
