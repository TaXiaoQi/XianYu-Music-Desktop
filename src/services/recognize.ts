/**
 * 听歌识曲服务
 *
 * 音频采集与重采样已完全下沉到 Rust 后端（system_audio.rs + recognize.rs）：
 * 1. Rust 用 WASAPI Loopback 捕获系统音频输出（10 秒）
 * 2. 在 Rust 中线性插值降采样为 8000Hz / 16bit / 单声道 PCM
 * 3. Rust 构建酷狗 Android 签名并 POST 到指纹识别接口
 * 4. 响应体在此模块映射为带置信度的匹配结果，并转换为项目可播放的 Song
 *
 * 识别接口：gateway.kugou.com/fingerprint.service/v1/music_trackid_mulit
 * 加密方式：encryptType 'android'（见 KuGouMusicApi util/helper.js）
 */

import { tauriInvoke } from './tauri/invoke';
import type { RecognizeResponseContract } from './tauri/contracts';
import type { LxSearchResultItem } from './lxMusicSdk';
import type { Song } from '../types';

/** 单条识别匹配结果 */
export interface RecognizeMatch {
  /** 转换为项目可播放的歌曲元信息（LxSearchResultItem，source='kg'） */
  song: LxSearchResultItem;
  /** 匹配置信度（0~1，越大越准；由上游 dist 距离换算） */
  confidence: number;
  /** 原始字段，用于构建 Song 对象 */
  raw: RecognizeRawItem;
}

/** 酷狗识曲接口返回的单条原始记录（字段命名与酷狗保持一致） */
export interface RecognizeRawItem {
  songname?: string;
  filename?: string;
  name?: string;
  songNameSuffix?: string;
  singername?: string;
  author_name?: string;
  singer?: string;
  authors?: Array<{ author_id?: string | number; author_name?: string; singerid?: string | number; singername?: string }>;
  album?: Array<{ albumname?: string; album_id?: string | number; albumid?: string | number; sizable_cover?: string }>;
  album_name?: string;
  albumname?: string;
  album_id?: string | number;
  albumid?: string | number;
  album_audio_id?: string | number;
  mixsongid?: string | number;
  audio_id?: string | number;
  songid?: string | number;
  song_id?: string | number;
  hash?: string;
  hash_128?: string;
  FileHash?: string;
  hash_320?: string;
  hash_flac?: string;
  hash_high?: string;
  union_cover?: string;
  album_sizable_cover?: string;
  cover?: string;
  timelength?: number;
  timelength_128?: number;
  timelength_320?: number;
  duration?: number;
  dist?: number | string;
  [key: string]: unknown;
}

/** 识别接口响应 */
interface RecognizeResponseBody {
  status?: number;
  data?: RecognizeRawItem[] | null;
  err_code?: number;
  error_code?: number;
  msg?: string;
  [key: string]: unknown;
}

/** 识别音频最大时长（秒），与 Rust 后端 capture_system_audio_pcm 参数一致 */
export const RECOGNIZE_MAX_SECONDS = 10;

/** 识别被取消时抛出的错误标识 */
export const RECOGNIZE_CANCELLED = '识别已取消';

/**
 * 一键无感识别：直接捕获系统音频并识别
 *
 * 后端用 WASAPI Loopback 捕获系统音频输出（10 秒），
 * 重采样为 8000Hz/16bit/单声道 PCM 后直接调用酷狗指纹识别接口。
 * 无需用户选屏幕或勾选"分享音频"，整个过程对用户完全透明。
 *
 * 调用 cancelRecognizeSystemAudio() 可中途取消识别。
 *
 * @returns 按置信度降序排列的匹配结果
 * @throws {Error} 当识别被取消时，error.message === RECOGNIZE_CANCELLED
 */
export async function recognizeSystemAudio(): Promise<RecognizeMatch[]> {
  const response = await tauriInvoke('recognize_system_audio');
  return parseRecognizeResponse(response);
}

/**
 * 取消正在进行的音频识别
 *
 * 通知 Rust 后端将全局取消标志置为 true，
 * 正在进行的 WASAPI 捕获循环会在下一次迭代时退出。
 */
export async function cancelRecognizeSystemAudio(): Promise<void> {
  await tauriInvoke('cancel_recognize_system_audio');
}

/**
 * 使用自定义 PCM 数据识别歌曲
 *
 * 接收 8000Hz / 16bit / 单声道 PCM 字节数组，直接调用酷狗指纹识别接口。
 * 可用于从文件或其他来源提取的音频识别，不依赖 WASAPI 系统音频捕获。
 *
 * @param pcm 8000Hz / 16bit / 单声道 PCM 字节数组
 * @returns 按置信度降序排列的匹配结果
 */
export async function recognizeWithPcm(pcm: number[]): Promise<RecognizeMatch[]> {
  const response = await tauriInvoke('recognize_with_pcm', { pcm });
  return parseRecognizeResponse(response);
}

/** 解析酷狗识别接口的响应 */
function parseRecognizeResponse(response: RecognizeResponseContract): Promise<RecognizeMatch[]> {
  if (response.status !== 200) {
    return Promise.reject(new Error(`识别请求失败 (HTTP ${response.status})`));
  }

  let body: RecognizeResponseBody;
  try {
    body = JSON.parse(response.body);
  } catch {
    return Promise.reject(new Error('识别响应解析失败'));
  }

  // 酷狗成功状态：status === 1
  if (body.status !== 1) {
    return Promise.resolve([]);
  }

  return Promise.resolve(mapRecognizeMatches(body.data));
}

/**
 * 将识别结果原始记录映射为带置信度的匹配结果
 *
 * 上游 dist 为"距离"（0~1，越小越匹配），换算为置信度 confidence = 1 - dist
 * 与 qwemusic mappers/recognize.ts::mapRecognizeMatches 一致
 */
function mapRecognizeMatches(list: RecognizeRawItem[] | null | undefined): RecognizeMatch[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const distRaw = parseFloat(String(item.dist ?? 0));
      const dist = Number.isFinite(distRaw) ? Math.min(Math.max(distRaw, 0), 1) : 1;
      return {
        song: mapRecognizeToLxSong(item),
        confidence: 1 - dist,
        raw: item,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

/** 安全读取字符串值，支持多别名取值 */
function pickString(...values: unknown[]): string {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v) !== '') {
      return String(v);
    }
  }
  return '';
}

/**
 * 格式化酷狗封面 URL
 *
 * 复现 qwemusic formatPic + normalizeCoverUrl：
 * 1. 替换 {size} 占位符为实际尺寸（400px）
 * 2. 补全协议相对 URL（// → https://）
 * 3. 统一用 https
 * 4. 替换旧域名 c1.kgimg.com → imge.kugou.com
 */
function formatCoverUrl(...values: unknown[]): string {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v) !== '') {
      let url = String(v).trim();
      if (!url) continue;
      // 替换 {size} 占位符
      url = url.replace(/\{size\}/g, '400');
      // 补全协议相对 URL
      if (url.startsWith('//')) {
        url = `https:${url}`;
      }
      // 统一用 https
      url = url.replace('http://', 'https://');
      // 替换旧域名
      url = url.replace('c1.kgimg.com', 'imge.kugou.com');
      return url;
    }
  }
  return '';
}

/** 安全解析整数 */
function pickInt(...values: unknown[]): number {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') {
      const n = parseInt(String(v), 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

/** 格式化时长（秒 → mm:ss） */
function formatPlayTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 将酷狗识曲结果映射为项目可播放的 LxSearchResultItem（source='kg'）
 *
 * 播放时通过 `lx://kg/${hash}` 协议，playerPlayback 会调用 lxGetMusicUrl
 * 用 hash 作为酷狗歌曲标识获取播放链接。
 */
function mapRecognizeToLxSong(item: RecognizeRawItem): LxSearchResultItem {
  // 歌名（支持 songname / filename / name 别名）
  const name = pickString(item.songname, item.filename, item.name, '未知歌曲');

  // 歌手（支持 singername / author_name / singer 别名）
  const singer = pickString(item.singername, item.author_name, item.singer, '未知歌手');

  // 专辑（album 数组优先，回退到顶层字段）
  const albumRecord = Array.isArray(item.album) && item.album.length > 0 ? item.album[0] : {};
  const albumName = pickString(
    (albumRecord as any).albumname,
    item.album_name,
    item.albumname,
    '',
  );
  const albumId = pickString(
    (albumRecord as any).albumid,
    (albumRecord as any).album_id,
    item.album_id,
    item.albumid,
    '',
  );

  // 封面（union_cover 优先，回退到 album.sizable_cover / cover）
  // 使用 formatCoverUrl 格式化：替换 {size}、补全协议、替换旧域名
  const cover = formatCoverUrl(
    item.union_cover,
    (albumRecord as any).sizable_cover,
    item.album_sizable_cover,
    item.cover,
  );

  // hash（酷狗歌曲标识，播放必需）
  const hash = pickString(item.hash, item.hash_128, item.FileHash, item.hash_320, item.hash_flac, '');

  // songmid 用 album_audio_id（酷狗内部歌曲标识），回退到 mixsongid / audio_id / hash
  const songmid = pickString(
    String(item.album_audio_id ?? ''),
    String(item.mixsongid ?? ''),
    String(item.audio_id ?? ''),
    String(item.songid ?? ''),
    hash,
  );

  // 时长（毫秒 → 秒）
  const timeLengthMs = pickInt(item.timelength, item.timelength_128, item.timelength_320, item.duration, 0);
  const durationSec = timeLengthMs > 1000 ? Math.floor(timeLengthMs / 1000) : timeLengthMs;

  // 构建音质列表（用 hash 作为 128k 档位）
  const types: LxSearchResultItem['types'] = [];
  const _types: LxSearchResultItem['_types'] = {};
  if (hash) {
    types.push({ type: '128k', size: '', hash });
    _types['128k'] = { size: '', hash };
  }
  if (item.hash_320) {
    types.push({ type: '320k', size: '', hash: item.hash_320 });
    _types['320k'] = { size: '', hash: item.hash_320 };
  }
  if (item.hash_flac) {
    types.push({ type: 'flac', size: '', hash: item.hash_flac });
    _types.flac = { size: '', hash: item.hash_flac };
  }

  return {
    name,
    singer,
    albumName,
    albumId: albumId || songmid,
    songmid,
    source: 'kg',
    interval: formatPlayTime(durationSec),
    img: cover || null,
    hash,
    types,
    _types,
  };
}

/**
 * 将识别结果构建为可播放的 Song 对象
 *
 * path 使用 `lx://kg/${hash}` 协议，与 Search.vue::handlePlaySong 的酷狗歌曲构建方式一致。
 */
export function buildRecognizeSong(match: RecognizeMatch): Song {
  const item = match.song;
  const artistNames = item.singer ? item.singer.split(/[、,&/]/).map(s => s.trim()).filter(Boolean) : ['未知歌手'];
  const song: Song = {
    name: item.name,
    title: item.name,
    path: `lx://kg/${item.hash || item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.albumName || '未知专辑',
    album_artist: item.singer || '未知歌手',
    album_key: `${item.albumName || '未知专辑'}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: 0,
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://kg/${item.hash || item.songmid}`,
  } as Song;
  // 附加 LX 解析所需的元信息（与 Search.vue 一致）
  (song as any)._hash = item.hash;
  (song as any)._types = item._types;
  (song as any)._songmid = item.songmid;
  (song as any)._source = item.source;
  return song;
}
