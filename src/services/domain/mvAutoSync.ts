
const ANALYSIS_SAMPLE_RATE = 8000;
const ENVELOPE_HOP = 512;
const ENVELOPE_WINDOW = 1024;
const MAX_LAG_SEC = 15;
const MAX_ANALYSIS_SEC = 110;
const MIN_CONFIDENCE = 0.2;
// 局部滑动匹配（容忍 MV 片头/花絮）参数，对齐移动端 Rust 实现
const LOCAL_MIN_CONFIDENCE = 0.5;
const LOCAL_DEFAULT_WINDOW_SEC = 15;
const LOCAL_MIN_OVERLAP_FRAMES = 48;
// 时间轴模糊匹配的最小半带宽（秒），对齐移动端 mv_sync.rs 的 LOCAL_BAND_MIN_SEC
const LOCAL_BAND_MIN_SEC = 60;

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

/**
 * 局部滑动匹配：取歌曲在 [songPosSec, songPosSec+windowSec] 的一小段窗，在整个 MV
 * 包络上逐帧滑窗求 Pearson 相关，返回最佳对齐。比全局互相关对「MV 加了片头/花絮」
 * 更鲁棒——只要这段歌在 MV 里出现过就能对准，不会像全局那样被整段不匹配的开头带偏。
 *
 * 时间轴模糊匹配（与移动端 mv_sync.rs 对齐）：搜索带按「歌曲相对位置 ↔ MV 相对位置」
 * 收窄——带心 = f×MV 时长（f = 歌曲位置/歌曲时长），半带宽 = max(0.25×MV 时长, 60s)。
 * 歌曲时长未知（≤0）时退化为全轴搜索。
 *
 * 语义与全局一致：`offsetSec = mvPosSec - songPosSecActual`，即 `videoPos = audioPos + offset`。
 */
export function estimateEnvelopeLagLocal(
  mvEnvelope: Float32Array,
  songEnvelope: Float32Array,
  songPosSec: number,
  windowSec = LOCAL_DEFAULT_WINDOW_SEC,
  songDurSec = 0,
): MvSyncEstimate | null {
  const hopSec = ENVELOPE_HOP / ANALYSIS_SAMPLE_RATE;
  const winFrames = Math.max(LOCAL_MIN_OVERLAP_FRAMES, Math.round(windowSec / hopSec));
  if (songEnvelope.length <= winFrames || mvEnvelope.length < winFrames) return null;

  const songStartFrame = Math.max(0, Math.round(songPosSec / hopSec));
  const songStart = Math.min(songStartFrame, songEnvelope.length - winFrames);
  const songWin = zNormalize(songEnvelope.subarray(songStart, songStart + winFrames));

  // —— 时间轴模糊匹配（前/中/后对应带）——
  // 全轴滑窗的根因缺陷：相似段落（副歌）在时间轴上可以任意远，歌曲开头会
  // 误配到 MV 尾部高潮。约束锚点只能落在模糊带内搜索。
  const mvLastStart = Math.max(0, mvEnvelope.length - winFrames);
  let searchLo = 0;
  let searchHi = mvLastStart;
  if (Number.isFinite(songDurSec) && songDurSec > 0) {
    const f = Math.min(1, Math.max(0, songPosSec / songDurSec));
    const mvTotalSec = mvEnvelope.length * hopSec;
    const halfBand = Math.max(mvTotalSec * 0.25, LOCAL_BAND_MIN_SEC);
    const center = f * mvTotalSec;
    searchLo = Math.max(0, Math.floor((center - halfBand) / hopSec));
    searchHi = Math.min(mvLastStart, Math.ceil((center + halfBand) / hopSec));
    if (searchHi < searchLo) {
      searchLo = 0;
      searchHi = mvLastStart;
    }
  }

  let bestStart = 0;
  let bestScore = -Infinity;
  let hasFinite = false;
  for (let start = searchLo; start <= searchHi; start += 1) {
    const slice = zNormalize(mvEnvelope.subarray(start, start + winFrames));
    let dot = 0;
    for (let i = 0; i < winFrames; i += 1) dot += songWin[i] * slice[i];
    const score = dot / winFrames;
    if (Number.isFinite(score) && score > bestScore) {
      bestScore = score;
      bestStart = start;
      hasFinite = true;
    }
  }
  if (!hasFinite) return null;
  return { offsetSec: bestStart * hopSec - songStart * hopSec, confidence: bestScore };
}

/** 局部匹配是否可信：置信度达标即可，不限制偏移大小——片头造成的偏移可远超全局 ±15s。 */
export function isTrustworthyEstimateLocal(estimate: MvSyncEstimate | null): estimate is MvSyncEstimate {
  if (!estimate) return false;
  return Number.isFinite(estimate.offsetSec) && estimate.confidence >= LOCAL_MIN_CONFIDENCE;
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

/**
 * 局部频谱对齐：以歌曲当前位置 [songPosSec] 为锚下载歌曲音频 + 读取 MV 缓存，
 * 在搜索带内滑窗匹配。用于 MV 开启时对齐（容忍片头/花絮）。
 * [songDurSec] 为歌曲时长（秒），用于时间轴模糊带收窄搜索范围；未知传 0。
 * 返回失败或低置信度时返回 null。
 */
export async function analyzeMvAudioSyncLocal(
  mvAssetUrl: string,
  audioHttpUrl: string,
  songPosSec: number,
  audioHeaders?: Record<string, string> | null,
  windowSec = LOCAL_DEFAULT_WINDOW_SEC,
  songDurSec = 0,
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

    const estimate = estimateEnvelopeLagLocal(mvEnvelope, songEnvelope, songPosSec, windowSec, songDurSec);
    return isTrustworthyEstimateLocal(estimate) ? estimate : null;
  } finally {
    if (audioCachePath) {
      void pluginApi.removeCachedBackgroundVideo(audioCachePath).catch(() => {});
    }
  }
}
