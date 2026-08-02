export const LYRICS_SYNC_OFFSET_MIN_MS = -100;
export const LYRICS_SYNC_OFFSET_MAX_MS = 100;
export const LYRICS_SYNC_OFFSET_STEP_MS = 5;

export const normalizeLyricsSyncOffsetMs = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const stepped = Math.round(value / LYRICS_SYNC_OFFSET_STEP_MS) * LYRICS_SYNC_OFFSET_STEP_MS;
  return Math.max(LYRICS_SYNC_OFFSET_MIN_MS, Math.min(LYRICS_SYNC_OFFSET_MAX_MS, stepped));
};

export const normalizeLyricsSyncOffsetSeconds = (value: number): number => (
  normalizeLyricsSyncOffsetMs(value * 1000) / 1000
);
