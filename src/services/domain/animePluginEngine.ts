import type { PluginSource } from '../../types';
import {
  log,
  normalizePluginUserVariables,
  pluginInstances,
  userVarDefsCache,
  _sandboxedPlugins,
  getPluginUserVariableValues,
} from './pluginEngineBase';
import {
  loadMusicFreeInSandbox,
  callSandboxMethod,
  setUserVarsProvider,
} from './pluginSandboxManager';
import { hostSha256Hex } from '../tauri/hostCryptoApi';

// ==================== animemusic/1 插件引擎 ====================
// 复用 musicfree 沙箱加载（__xyLoadMusicFree 已识别 instance.format === 'animemusic/1'
// 并从 instance.meta 提取元信息），调用走统一入口 call(action, params)，
// 由本模块在主线程解包信封并暴露 musicfree 兼容方法（search/getMediaSource/getLyric）。

const ANIME_FORMAT_TAG = 'animemusic/1';

export function isAnimePluginScript(script: string): boolean {
  return /["']animemusic\/1["']/.test(script);
}

interface AnimeEnvelope {
  ok?: boolean;
  action?: string;
  error?: { code?: string; message?: string; supported?: string[] };
  [key: string]: any;
}

async function animeCall(
  pluginId: string,
  action: string,
  params: Record<string, unknown>,
  timeout = 30000,
): Promise<AnimeEnvelope | null> {
  return (await callSandboxMethod(pluginId, 'call', [action, params], timeout)) as AnimeEnvelope;
}

function envelopeErrorText(env: AnimeEnvelope | null): string {
  const err = env?.error;
  if (!err) return '未知错误';
  return `${err.code || 'E_UNKNOWN'}: ${err.message || ''}`.trim();
}

// QualityKey / mf 三档(low/standard/high/super) → anime 音质键(128k/192k/320k/flac/flac24bit)
const ANIME_QUALITY_MAP: Record<string, string> = {
  mgg: '128k',
  '128k': '128k',
  '192k': '192k',
  '320k': '320k',
  flac: 'flac',
  flac24bit: 'flac24bit',
  hires: 'flac24bit',
  vinyl: 'flac24bit',
  dolby: 'flac24bit',
  atmos: 'flac24bit',
  atmos_plus: 'flac24bit',
  master: 'flac24bit',
  low: '128k',
  standard: '320k',
  high: 'flac',
  super: 'flac24bit',
};

function toAnimeQuality(quality: string): string {
  return ANIME_QUALITY_MAP[quality] || '320k';
}

// 聚合插件必须传 platform；_animePlatform 在搜索结果注入（resetMediaItem 会覆盖 platform 字段）
function resolveAnimePlatform(musicItem: any, singlePlatform: string | null): string | undefined {
  const fromItem = musicItem?._animePlatform;
  if (typeof fromItem === 'string' && fromItem && fromItem !== 'all') return fromItem;
  if (singlePlatform && singlePlatform !== 'all') return singlePlatform;
  return undefined;
}

export function createAnimeInstance(pluginId: string, metadata: any) {
  const pluginLabel = metadata.pluginName || pluginId;
  const singlePlatform: string | null = metadata.platform && metadata.platform !== 'all'
    ? String(metadata.platform)
    : null;

  const inst: any = {
    platform: metadata.platform,
    version: metadata.version,
    author: metadata.author,
    description: metadata.description,
    supportedQualities: Array.isArray(metadata.supportedQualities) ? metadata.supportedQualities : [],
    supportedSearchType: ['music'],
    defaultSearchType: 'music',
    format: 'anime',
    sources: Array.isArray(metadata.platforms) && metadata.platforms.length > 0
      ? metadata.platforms.map(String)
      : [String(metadata.platform || 'all')],

    // 返回 musicfree 风格 {isEnd, list}，extractResultList 认 list 字段
    async search(query: string, page: number, type: string) {
      if (type && type !== 'music') {
        log(`[anime] ${pluginLabel} 不支持 ${type} 搜索，返回空结果`);
        return {};
      }
      const env = await animeCall(pluginId, 'search', {
        keyword: query,
        page: page || 1,
        limit: 30,
      });
      if (!env?.ok) {
        log(`[anime] ${pluginLabel} search 失败: ${envelopeErrorText(env)}`);
        return {};
      }
      const list = Array.isArray(env.list) ? env.list : [];
      return {
        isEnd: env.hasMore === false ? true : undefined,
        list: list.map((item: any) => ({
          ...item,
          platform: item.platform || metadata.platform,
          _animePlatform: item.platform || metadata.platform,
        })),
      };
    },

    // 返回 {url, quality}；失败抛错由 pluginGetMusicInfo 统一降级重试
    async getMediaSource(musicItem: any, quality: string) {
      const params: Record<string, unknown> = {
        id: musicItem?.id,
        quality: toAnimeQuality(String(quality || '')),
      };
      const p = resolveAnimePlatform(musicItem, singlePlatform);
      if (p) params.platform = p;
      const env = await animeCall(pluginId, 'musicUrl', params);
      if (!env?.ok || !env.url) {
        throw new Error(`[anime] musicUrl 失败: ${envelopeErrorText(env)}`);
      }
      return {
        url: String(env.url),
        quality: env.quality ? String(env.quality) : undefined,
      };
    },

    // 返回 musicfree 风格 {lyric, tlyric, rlyric, lxlyric}；逐字走增强 LRC 直通 lxlyric
    async getLyric(musicItem: any) {
      const base: Record<string, unknown> = { id: musicItem?.id };
      if (musicItem?.title || musicItem?.name) base.title = musicItem.title || musicItem.name;
      if (musicItem?.artist) base.artist = musicItem.artist;
      const dur = Number(musicItem?.duration);
      if (Number.isFinite(dur) && dur > 0) {
        base.interval = dur >= 60000 ? Math.round(dur / 1000) : Math.round(dur);
      }
      const p = resolveAnimePlatform(musicItem, singlePlatform);
      if (p) base.platform = p;

      let line: any = null;
      let word: any = null;

      // 1) 逐行+逐字一次拿
      const bothEnv = await animeCall(pluginId, 'lyricBoth', base, 15000).catch(() => null);
      if (bothEnv?.ok) {
        line = bothEnv.line || null;
        word = bothEnv.word || null;
      }

      // 2) 降级逐字
      if (!line && !word) {
        const wordEnv = await animeCall(pluginId, 'lyricWord', base, 15000).catch(() => null);
        if (wordEnv?.ok) {
          word = wordEnv;
          line = {
            lrc: wordEnv.lrc || '',
            translation: wordEnv.translation || '',
            romanization: wordEnv.romanization || '',
          };
        }
      }

      // 3) 降级逐行
      if (!line?.lrc) {
        const lineEnv = await animeCall(pluginId, 'lyric', base, 15000).catch(() => null);
        if (lineEnv?.ok) line = lineEnv;
      }

      if (!line?.lrc) {
        log(`[anime] ${pluginLabel} getLyric 失败: ${envelopeErrorText(bothEnv)}`);
        return null;
      }

      return {
        lyric: String(line.lrc || ''),
        tlyric: String(line.translation || ''),
        rlyric: String(line.romanization || ''),
        lxlyric: word && word.word && word.lrc ? String(word.lrc) : '',
      };
    },
  };

  return inst;
}

export async function loadAnimePluginFromScript(
  script: string,
  uri: string,
  userVarsPluginId?: string,
): Promise<PluginSource> {
  const hash = await hostSha256Hex(script);
  setUserVarsProvider((pid: string) => getPluginUserVariableValues(pid));

  const userVars = getPluginUserVariableValues(userVarsPluginId || hash);
  const metadata = await loadMusicFreeInSandbox(hash, script, userVars);

  if (!metadata?.platform) {
    throw new Error('anime 插件缺少 meta.platform 字段');
  }

  const source: PluginSource = {
    id: hash,
    name: metadata.pluginName || metadata.platform,
    format: 'anime',
    version: metadata.version || '',
    author: metadata.author || '',
    description: metadata.description || '',
    filePath: uri,
    importedAt: Date.now(),
    enabled: true,
    sources: Array.isArray(metadata.platforms) && metadata.platforms.length > 0
      ? metadata.platforms.map(String)
      : [String(metadata.platform)],
  };

  pluginInstances.set(hash, {
    source,
    instance: createAnimeInstance(hash, metadata),
    script,
  });
  _sandboxedPlugins.add(hash);

  const userVariables = normalizePluginUserVariables(metadata.userVariables);
  if (userVariables.length > 0) {
    userVarDefsCache.set(hash, userVariables);
  }

  log(`=== anime 插件沙箱加载成功: "${source.name}" (${source.sources.join('/')}) ===`);
  return source;
}
