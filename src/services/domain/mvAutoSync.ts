
const ANALYSIS_SAMPLE_RATE = 8000;
const ENVELOPE_HOP = 512;
const ENVELOPE_WINDOW = 1024;
const MAX_LAG_SEC = 15;
const MAX_ANALYSIS_SEC = 110;
const MIN_CONFIDENCE = 0.2;

export interface MvSyncEstimate {
  offsetSec: number;
  confidence: number;
}

export function computeEnvelope(samples: Float32Array): Float32Array {
  const frameCount = Math.max(0, Math.floor((samples.length - ENVELOPE_WINDOW) / ENVELOPE_HOP) + 1);
  const envelope = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * ENVELOPE_HOP;
    let sum = 0;
    for (let i = start; i < start + ENVELOPE_WINDOW; i += 1) {
      const v = samples[i];
      sum += v * v;
    }
    envelope[frame] = Math.sqrt(sum / ENVELOPE_WINDOW);
  }
  return envelope;
}

export function zNormalize(envelope: Float32Array): Float32Array {
  const normalized = new Float32Array(envelope.length);
  if (!envelope.length) return normalized;
  let mean = 0;
  for (let i = 0; i < envelope.length; i += 1) mean += envelope[i];
  mean /= envelope.length;
  let variance = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    const d = envelope[i] - mean;
    variance += d * d;
  }
  variance /= envelope.length;
  const std = Math.sqrt(variance);
  if (std < 1e-9) return normalized;
  for (let i = 0; i < envelope.length; i += 1) {
    normalized[i] = (envelope[i] - mean) / std;
  }
  return normalized;
}

export function estimateEnvelopeLag(
  mvEnvelope: Float32Array,
  songEnvelope: Float32Array,
): MvSyncEstimate | null {
  if (mvEnvelope.length < 4 || songEnvelope.length < 4) return null;

  const hopSec = ENVELOPE_HOP / ANALYSIS_SAMPLE_RATE;
  const maxLag = Math.floor(MAX_LAG_SEC / hopSec);
  const maxFrames = Math.floor(MAX_ANALYSIS_SEC / hopSec);
  const mvRaw = mvEnvelope.length > maxFrames ? mvEnvelope.subarray(0, maxFrames) : mvEnvelope;
  const songRaw = songEnvelope.length > maxFrames ? songEnvelope.subarray(0, maxFrames) : songEnvelope;
  const mv = zNormalize(mvRaw);
  const song = zNormalize(songRaw);

  let bestLag = 0;
  let bestScore = -Infinity;
  const scores = new Float32Array(2 * maxLag + 1);

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const mvStart = Math.max(0, lag);
    const songStart = Math.max(0, -lag);
    const overlap = Math.min(mv.length - mvStart, song.length - songStart);
    if (overlap < 16) {
      scores[lag + maxLag] = -Infinity;
      continue;
    }
    let dot = 0;
    let mvNorm = 0;
    let songNorm = 0;
    for (let i = 0; i < overlap; i += 1) {
      const a = mv[mvStart + i];
      const b = song[songStart + i];
      dot += a * b;
      mvNorm += a * a;
      songNorm += b * b;
    }
    const denom = Math.sqrt(mvNorm * songNorm);
    const score = denom > 1e-9 ? dot / denom : -Infinity;
    scores[lag + maxLag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (!Number.isFinite(bestScore)) return null;

  let refined = bestLag;
  const idx = bestLag + maxLag;
  const left = idx > 0 ? scores[idx - 1] : -Infinity;
  const right = idx < scores.length - 1 ? scores[idx + 1] : -Infinity;
  if (Number.isFinite(left) && Number.isFinite(right)) {
    const denom = left - 2 * bestScore + right;
    if (Math.abs(denom) > 1e-9) {
      const delta = (0.5 * (left - right)) / denom;
      if (Math.abs(delta) <= 1) refined = bestLag + delta;
    }
  }

  return { offsetSec: refined * hopSec, confidence: bestScore };
}

export function isTrustworthyEstimate(estimate: MvSyncEstimate | null): estimate is MvSyncEstimate {
  if (!estimate) return false;
  if (estimate.confidence < MIN_CONFIDENCE) return false;
  if (Math.abs(estimate.offsetSec) >= MAX_LAG_SEC - 0.5) return false;
  return Number.isFinite(estimate.offsetSec);
}

export async function decodeAnalysisSamples(bytes: ArrayBuffer): Promise<Float32Array | null> {
  const AudioCtx: typeof OfflineAudioContext | undefined =
    (globalThis as any).OfflineAudioContext ?? (globalThis as any).webkitOfflineAudioContext;
  if (!AudioCtx) return null;
  try {
    const context = new AudioCtx(1, 1, ANALYSIS_SAMPLE_RATE);
    const buffer = await context.decodeAudioData(bytes);
    const channels = buffer.numberOfChannels;
    if (channels === 1) return buffer.getChannelData(0).slice();
    const length = buffer.length;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < channels; ch += 1) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i += 1) mono[i] += data[i] / channels;
    }
    return mono;
  } catch {
    return null;
  }
}

async function envelopeFromBytes(bytes: ArrayBuffer): Promise<Float32Array | null> {
  const samples = await decodeAnalysisSamples(bytes);
  if (!samples || !samples.length) return null;
  return computeEnvelope(samples);
}

export async function analyzeMvAudioSync(
  mvAssetUrl: string,
  audioHttpUrl: string,
  audioHeaders?: Record<string, string> | null,
): Promise<MvSyncEstimate | null> {
  const { pluginApi } = await import('../tauri/pluginApi');
  const { convertFileSrc } = await import('@tauri-apps/api/core');

  let audioCachePath = '';
  try {
    audioCachePath = await pluginApi.downloadVideoToCache(
      audioHttpUrl,
      audioHeaders ?? undefined,
    );
    const [mvBytes, songBytes] = await Promise.all([
      fetch(mvAssetUrl).then(response => {
        if (!response.ok) throw new Error(`MV cache fetch HTTP ${response.status}`);
        return response.arrayBuffer();
      }),
      fetch(convertFileSrc(audioCachePath)).then(response => {
        if (!response.ok) throw new Error(`audio fetch HTTP ${response.status}`);
        return response.arrayBuffer();
      }),
    ]);

    const [mvEnvelope, songEnvelope] = await Promise.all([
      envelopeFromBytes(mvBytes),
      envelopeFromBytes(songBytes),
    ]);
    if (!mvEnvelope || !songEnvelope) return null;

    const estimate = estimateEnvelopeLag(mvEnvelope, songEnvelope);
    return isTrustworthyEstimate(estimate) ? estimate : null;
  } finally {
    if (audioCachePath) {
      void pluginApi.removeCachedBackgroundVideo(audioCachePath).catch(() => {});
    }
  }
}
