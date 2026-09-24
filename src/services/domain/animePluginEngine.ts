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
  '24bit': 'flac24bit',
  hifi: 'flac24bit',
  low: '128k',
  standard: '320k',
  high: 'flac',
  super: 'flac24bit',
};

function toAnimeQuality(quality: string): string {
  return ANIME_QUALITY_MAP[quality] || '320k';
}

// MV 画质：宿主档位(4K/1080P/720P/480P/360P) → anime videoQuality(240p~1080p)
const ANIME_VIDEO_QUALITY_MAP: Record<string, string> = {
  '4k': '1080p',
  '2160p': '1080p',
  '1080p': '1080p',
  '1080': '1080p',
  '720p': '720p',
  '720': '720p',
  '480p': '480p',
  '480': '480p',
  '360p': '360p',
  '360': '360p',
  '240p': '360p',
  '240': '360p',
};

function toAnimeVideoQuality(quality?: string): string {
  return ANIME_VIDEO_QUALITY_MAP[String(quality || '').toLowerCase()] || '1080p';
}

// 合法平台码（目录条目 platform 兜底识别用，防止宿主展示名误当平台）
const ANIME_PLATFORM_KEYS = ['kg', 'kw', 'wy', 'tx', 'mg', 'bilibili'];

// 聚合插件必须传 platform；_animePlatform 在搜索/目录结果注入（resetMediaItem
// 会覆盖 platform 字段），兜底识别 rawData/顶层 platform（仅接受合法平台码）
function resolveAnimePlatform(musicItem: any, singlePlatform: string | null): string | undefined {
  const fromItem = musicItem?._animePlatform;
  if (typeof fromItem === 'string' && fromItem && fromItem !== 'all') return fromItem;
  const raw = musicItem?.rawData;
  const fromRaw = raw?._animePlatform;
  if (typeof fromRaw === 'string' && fromRaw && fromRaw !== 'all') return fromRaw;
  const top = musicItem?.platform;
  if (typeof top === 'string' && ANIME_PLATFORM_KEYS.includes(top)) return top;
  const rawPlatform = raw?.platform;
  if (typeof rawPlatform === 'string' && ANIME_PLATFORM_KEYS.includes(rawPlatform)) return rawPlatform;
  if (singlePlatform && singlePlatform !== 'all') return singlePlatform;
  return undefined;
}

// 目录条目 id：桌面端可能传 PluginSearchResult（id 在顶层/rawData/platformId）
function pickAnimeId(item: any): string {
  if (!item) return '';
  if (item.id != null && item.id !== '') return item.id;
  if (item.rawData?.id != null && item.rawData.id !== '') return item.rawData.id;
  if (item.platformId != null && item.platformId !== '') return item.platformId;
  return '';
}

function injectAnimePlatform(item: any, singlePlatform: string | null): any {
  const p = item?.platform || singlePlatform;
  return p && p !== 'all' ? { ...item, _animePlatform: p } : { ...item };
}

// am 列表信封 → musicfree 风格 {isEnd, list}
function envToList(env: AnimeEnvelope | null, singlePlatform: string | null) {
  const list = Array.isArray(env?.list) ? env!.list : [];
  return {
    isEnd: env?.hasMore === false ? true : undefined,
    list: list.map((item: any) => injectAnimePlatform(item, singlePlatform)),
  };
}

// am 评论条目 → musicfree/Baka 风格（user→nickName、content→comment、
// likes→like、time 字符串→createAt 毫秒、floors→replies 楼中楼）
function normalizeAnimeComment(c: any): any {
  if (!c || typeof c !== 'object') return { nickName: '', comment: '' };
  const out: any = {
    nickName: String(c.user || c.nickname || c.userName || ''),
    avatar: c.avatar || undefined,
    comment: String(c.content || c.text || ''),
    like: typeof c.likes === 'number' ? c.likes : (typeof c.like === 'number' ? c.like : undefined),
    location: c.location || undefined,
  };
  const t = c.time;
  if (typeof t === 'number') {
    out.createAt = t;
  } else if (typeof t === 'string' && t) {
    const ms = Date.parse(t.includes('T') ? t : t.replace(' ', 'T'));
    if (Number.isFinite(ms)) out.createAt = ms;
  }
  if (Array.isArray(c.floors) && c.floors.length) {
    out.replies = c.floors.map(normalizeAnimeComment);
  }
  return out;
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
        console.warn(`[anime] ${pluginLabel} search 失败: ${envelopeErrorText(env)}`);
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

      const wordHasTiming = (lrc: unknown): boolean => (
        typeof lrc === 'string' && /<\d{1,3}:\d{2}(?:\.\d{1,3})?>/.test(lrc)
      );

      // 1) 逐行+逐字一次拿
      const bothEnv = await animeCall(pluginId, 'lyricBoth', base, 15000).catch(() => null);
      if (bothEnv?.ok) {
        line = bothEnv.line || null;
        word = bothEnv.word || null;
      }

      // 2) lyricBoth 部分成功（line 有、word 缺/逐行）时单独补次 lyricWord 争取逐字
      if (line?.lrc && !wordHasTiming(word?.lrc)) {
        const wordEnv = await animeCall(pluginId, 'lyricWord', base, 15000).catch(() => null);
        if (wordEnv?.ok && wordHasTiming(wordEnv.lrc)) word = wordEnv;
      }

      // 3) 双空降级逐字（用逐字当逐行兜底）
      if (!line?.lrc && !word?.lrc) {
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

      // 4) 降级逐行
      if (!line?.lrc) {
        const lineEnv = await animeCall(pluginId, 'lyric', base, 15000).catch(() => null);
        if (lineEnv?.ok) line = lineEnv;
      }

      if (!line?.lrc && !word?.lrc) {
        log(`[anime] ${pluginLabel} getLyric 失败: ${envelopeErrorText(bothEnv)}`);
        return null;
      }

      // 逐字内容按词级时间戳判定（与三端 host_shim 同规则）：
      // kw/wy 服务端返回的逐字 Enhanced LRC 常把 format 标成 lrc 而非 lrc-a2，
      // 不能信任插件自述；word 逐字失败回退逐行时（fallback）lrc 无尖括号，
      // 检测不通过自动落回逐行 lyric，避免把纯文本误当逐字
      const wordLrc = word?.lrc ? String(word.lrc) : '';
      const hasWordTiming = /<\d{1,3}:\d{2}(?:\.\d{1,3})?>/.test(wordLrc);
      return {
        lyric: String(line.lrc || ''),
        tlyric: String(line.translation || ''),
        rlyric: String(line.romanization || ''),
        lxlyric: wordLrc && hasWordTiming ? wordLrc : '',
      };
    },

    // ==================== animemusic 发现类/评论/MV（v1.1.0+ 能力） ====================

    // 榜单列表（am toplist 仅 wy/kg/kw 支持；聚合插件并发合并）
    async getTopLists() {
      const supported = ['wy', 'kg', 'kw'];
      const targets = singlePlatform
        ? [singlePlatform]
        : (Array.isArray(metadata.platforms) ? metadata.platforms : []).filter((p: string) => supported.includes(p));
      const queryPlatforms = targets.length ? targets : supported;
      const groups = await Promise.all(queryPlatforms.map(async (p: string) => {
        try {
          const env = await animeCall(pluginId, 'toplist', queryPlatforms.length > 1 ? { platform: p } : {});
          const list = Array.isArray(env?.list) ? env!.list : [];
          return list.map((item: any) => injectAnimePlatform(item, singlePlatform));
        } catch {
          return [] as any[];
        }
      }));
      return groups.flat();
    },

    async getTopListDetail(topListItem: any, page: number = 1) {
      const params: Record<string, unknown> = { id: pickAnimeId(topListItem), page: page || 1, limit: 30 };
      const p = resolveAnimePlatform(topListItem, singlePlatform);
      if (p) params.platform = p;
      const env = await animeCall(pluginId, 'toplistSongs', params);
      if (!env?.ok) {
        throw new Error(`[anime] toplistSongs 失败: ${envelopeErrorText(env)}`);
      }
      return envToList(env, singlePlatform);
    },

    // 歌单详情+歌曲
    async getMusicSheetInfo(sheetItem: any, page: number = 1) {
      const params: Record<string, unknown> = { id: pickAnimeId(sheetItem), page: page || 1, limit: 30 };
      const p = resolveAnimePlatform(sheetItem, singlePlatform);
      if (p) params.platform = p;
      const env = await animeCall(pluginId, 'playlistDetail', params);
      if (!env?.ok) {
        throw new Error(`[anime] playlistDetail 失败: ${envelopeErrorText(env)}`);
      }
      return envToList(env, singlePlatform);
    },

    // 歌手热门歌曲（music）/ 歌手专辑列表（album）
    async getArtistWorks(artistItem: any, page: number = 1, type: string = 'music') {
      const params: Record<string, unknown> = { id: pickAnimeId(artistItem), page: page || 1, limit: 30 };
      const p = resolveAnimePlatform(artistItem, singlePlatform);
      if (p) params.platform = p;
      const action = type === 'album' ? 'artistAlbums' : 'artist';
      const env = await animeCall(pluginId, action, params);
      if (!env?.ok) {
        throw new Error(`[anime] ${action} 失败: ${envelopeErrorText(env)}`);
      }
      const out = envToList(env, singlePlatform);
      if (type === 'album') {
        // 桌面端专辑卡片取 title 字段，am 专辑卡只有 name，这里补别名
        out.list = out.list.map((item: any) => (!item.title && item.name ? { ...item, title: item.name } : item));
      }
      return out;
    },

    // 歌手简介：artist 动作 desc 常为空，空时补一发 artistDesc
    async getArtistInfo(artistItem: any) {
      const params: Record<string, unknown> = { id: pickAnimeId(artistItem) };
      const p = resolveAnimePlatform(artistItem, singlePlatform);
      if (p) params.platform = p;
      const env = await animeCall(pluginId, 'artist', params);
      if (!env?.ok) {
        throw new Error(`[anime] artist 失败: ${envelopeErrorText(env)}`);
      }
      const base = (desc: string) => ({ name: env.name || '', avatar: env.avatar || '', desc, description: desc });
      if (env.desc) return base(env.desc);
      const descParams: Record<string, unknown> = { id: params.id };
      if (p) descParams.platform = p;
      try {
        const dEnv = await animeCall(pluginId, 'artistDesc', descParams);
        return base(dEnv?.intro || dEnv?.desc || '');
      } catch {
        return base('');
      }
    },

    // 专辑详情+歌曲（kw 平台上游无歌曲列表，空 list 由宿主 search 兜底）
    async getAlbumInfo(albumItem: any, page: number = 1) {
      const params: Record<string, unknown> = { id: pickAnimeId(albumItem), page: page || 1, limit: 30 };
      const p = resolveAnimePlatform(albumItem, singlePlatform);
      if (p) params.platform = p;
      const env = await animeCall(pluginId, 'album', params);
      if (!env?.ok) {
        throw new Error(`[anime] album 失败: ${envelopeErrorText(env)}`);
      }
      return envToList(env, singlePlatform);
    },

    // 歌曲评论（am 仅 wy/bilibili 有真实评论，其余平台空结果不报错）
    async getMusicComments(musicItem: any, page: number = 1) {
      const pageNum = page || 1;
      const params: Record<string, unknown> = { id: pickAnimeId(musicItem), page: pageNum, limit: 20 };
      const p = resolveAnimePlatform(musicItem, singlePlatform);
      if (p) params.platform = p;
      const env = await animeCall(pluginId, 'comment', params);
      if (!env?.ok) {
        throw new Error(`[anime] comment 失败: ${envelopeErrorText(env)}`);
      }
      const hot = pageNum === 1 && Array.isArray(env.hot) ? env.hot : [];
      const list = Array.isArray(env.list) ? env.list : [];
      return {
        isEnd: list.length < 20,
        data: hot.concat(list).map(normalizeAnimeComment),
      };
    },

    // MV：mvSearch 按歌名匹配 → mvUrl 取直链。宿主把空结果视为「无 MV」
    // （非异常），因此搜索无命中时返回 null 而非抛错，避免探测误判存疑
    async getMvSource(musicItem: any, quality?: string) {
      const title = String(musicItem?.title || musicItem?.name || '').trim();
      if (!title) return null;
      const params: Record<string, unknown> = { keyword: title, limit: 10 };
      const p = resolveAnimePlatform(musicItem, singlePlatform);
      if (p) params.platform = p;
      const env = await animeCall(pluginId, 'mvSearch', params);
      if (!env?.ok) {
        throw new Error(`[anime] mvSearch 失败: ${envelopeErrorText(env)}`);
      }
      const list = Array.isArray(env.list) ? env.list : [];
      const t = title.toLowerCase();
      const artist = musicItem?.artist ? String(musicItem.artist).toLowerCase() : '';
      let best: any = null;
      let bestScore = 0;
      for (const it of list) {
        const itTitle = String(it.title || '').toLowerCase();
        let score = 0;
        if (itTitle === t) score = 4;
        else if (itTitle && (itTitle.includes(t) || t.includes(itTitle))) score = 3;
        else if (itTitle.length >= 8 && t.slice(0, 8) === itTitle.slice(0, 8)) score = 2;
        if (score <= 0) continue;
        const itArtist = String(it.artist || '').toLowerCase();
        if (artist && itArtist && (itArtist.includes(artist) || artist.includes(itArtist))) score += 1;
        score += Math.min((Number(it.playCount) || 0) / 1e8, 0.5);
        if (score > bestScore) {
          bestScore = score;
          best = it;
        }
      }
      if (!best) return null;
      const urlParams: Record<string, unknown> = { id: best.id, videoQuality: toAnimeVideoQuality(quality) };
      const mp = best.platform || p;
      if (mp) urlParams.platform = mp;
      const uEnv = await animeCall(pluginId, 'mvUrl', urlParams);
      if (!uEnv?.ok || !uEnv.url) {
        throw new Error(`[anime] mvUrl 失败: ${envelopeErrorText(uEnv)}`);
      }
      return { url: String(uEnv.url), quality: toAnimeVideoQuality(quality) };
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
    const keys = metadata ? Object.keys(metadata).join(',') : String(metadata);
    log(`[anime] 加载失败: metadata 缺 platform (metadata=${keys})`);
    console.warn(`[anime] 加载失败: metadata 缺 platform (metadata=${keys})`);
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
