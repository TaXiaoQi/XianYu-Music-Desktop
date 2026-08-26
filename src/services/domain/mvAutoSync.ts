/**
 * MV 背景视频自动音画对齐
 *
 * 背景：MV 文件与播放音频是两份内容（MV 带片头/剪辑差异），按播放时间轴对齐
 * （PlayerDetailBackground.syncBackgroundVideo）只能保证"视频进度 = 音频进度"，
 * 无法修正内容级错位——用户听到副歌时画面还在前奏。
 *
 * 原理：MV 视频文件大多自带音轨（酷狗/QQ 等 MP4），把 MV 音轨与正在播放的
 * 歌曲音频分别降到 8kHz 单声道、计算 RMS 能量包络后做互相关，峰值对应的
 * 时移即内容偏移：videoTarget = audioTime + offset。
 *
 * 全程自动，无需用户设置；分析失败（视频无音轨 / 下载失败 / 置信度不足）
 * 保持 0 偏移，行为与不开启对齐时一致。
 */

/** 解码/重采样目标采样率：包络对齐用 8kHz 足够，解码内存可从 ~85MB 降到 ~2MB */
const ANALYSIS_SAMPLE_RATE = 8000;
/** 包络帧移（采样点）：64ms @ 8kHz */
const ENVELOPE_HOP = 512;
/** 包络帧窗（采样点）：128ms @ 8kHz，窗内 RMS */
const ENVELOPE_WINDOW = 1024;
/** 互相关搜索的最大时移（秒）：覆盖常见 MV 片头/剪辑错位 */
const MAX_LAG_SEC = 15;
/** 参与分析的时长上限（秒）：副歌前内容已足够定位 */
const MAX_ANALYSIS_SEC = 110;
/** 归一化互相关峰值阈值：低于此值视为不可信（不同混音/现场版） */
const MIN_CONFIDENCE = 0.2;

export interface MvSyncEstimate {
  /** 内容偏移（秒）：正值 = MV 内容滞后需画面提前（MV 有片头） */
  offsetSec: number;
  /** 峰值归一化互相关 [-1, 1] */
  confidence: number;
}

/** 计算单声道采样的 RMS 能量包络（帧移 ENVELOPE_HOP，帧窗 ENVELOPE_WINDOW） */
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

/** z-score 归一化（互相关前去除能量量纲差异） */
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
  if (std < 1e-9) return normalized; // 全静音等退化输入保持全 0
  for (let i = 0; i < envelope.length; i += 1) {
    normalized[i] = (envelope[i] - mean) / std;
  }
  return normalized;
}

/**
 * 包络互相关求最优时移：mv(t + lag) ≈ song(t)。
 * lag > 0 表示 MV 内容滞后（片头），播放时需把视频画面提前 lag 秒。
 * 内部先做 z-score 归一化（消除能量量纲与直流偏置），峰值附近抛物线插值细化到亚帧。
 */
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

  // 抛物线插值：用峰值与左右邻域分数拟合顶点，细化到亚帧
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

/** 可信度门槛过滤：低相关（不同编曲/现场版）或触边（真实错位超出搜索范围）时拒绝 */
export function isTrustworthyEstimate(estimate: MvSyncEstimate | null): estimate is MvSyncEstimate {
  if (!estimate) return false;
  if (estimate.confidence < MIN_CONFIDENCE) return false;
  if (Math.abs(estimate.offsetSec) >= MAX_LAG_SEC - 0.5) return false;
  return Number.isFinite(estimate.offsetSec);
}

/** 解码音频字节为 8kHz 单声道采样（重采样由 decodeAudioData 按上下文采样率完成） */
export async function decodeAnalysisSamples(bytes: ArrayBuffer): Promise<Float32Array | null> {
  const AudioCtx: typeof OfflineAudioContext | undefined =
    (globalThis as any).OfflineAudioContext ?? (globalThis as any).webkitOfflineAudioContext;
  if (!AudioCtx) return null;
  try {
    const context = new AudioCtx(1, 1, ANALYSIS_SAMPLE_RATE);
    const buffer = await context.decodeAudioData(bytes);
    // 多声道 → 平均混缩单声道
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
    // 无音轨（B站 DASH 纯视频流）/ 编码不受支持 / 数据损坏
    return null;
  }
}

async function envelopeFromBytes(bytes: ArrayBuffer): Promise<Float32Array | null> {
  const samples = await decodeAnalysisSamples(bytes);
  if (!samples || !samples.length) return null;
  return computeEnvelope(samples);
}

/**
 * 自动对齐分析入口。
 *
 * @param mvAssetUrl 已缓存 MV 文件的 asset 协议 URL（convertFileSrc 产物）
 * @param audioHttpUrl 正在播放歌曲的音频直链（http/https）
 * @returns 可信的偏移估计；任一环节失败返回 null（调用方保持 0 偏移）
 */
export async function analyzeMvAudioSync(
  mvAssetUrl: string,
  audioHttpUrl: string,
  audioHeaders?: Record<string, string> | null,
): Promise<MvSyncEstimate | null> {
  const { pluginApi } = await import('../tauri/pluginApi');
  const { convertFileSrc } = await import('@tauri-apps/api/core');

  // 复用视频缓存下载命令把音频拉到应用缓存（asset 协议可读），任何失败路径都要删除。
  // 需带上播放用的插件 headers（Referer/Cookie 等）：网易云等外链不带 Referer 会
  // 下载失败或落回 404 页面，导致此处拿不到音频包络、认为分析不可信而偏移恒为 0。
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
