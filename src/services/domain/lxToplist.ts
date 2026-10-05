import {
  formatPlayTime,
  httpGetJson,
  httpGetText,
  sizeFormate,
  type LxSearchResultItem,
} from './lxMusicSdkBase';
import { dispatchFallbackModule } from '../fallbackModules/registry';

// ==================== lx_toplist 兜底模块（落雪音源榜单） ====================
// 上游协议与移动端 rust lx_search 输出同构：歌曲条目为 snake_case LxSearchItem；
// http:// 上游保持原样不升级 https。

const LIST_TIMEOUT_MS = 6000;
const DETAIL_TIMEOUT_MS = 8000;

// tx 无列表接口，固定榜单 ID 并发探测：单请求 4s、整批 4.5s 总上限，超时丢弃
const PROBE_TIMEOUT_MS = 4000;
const PROBE_BATCH_CAP_MS = 4500;
const TX_TOPLIST_IDS = [26, 4, 27, 62, 60, 63, 58, 65, 66, 6, 3, 17];

const WY_UA = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36';

export interface LxToplistEntry {
  id: string;
  title: string;
  coverImg: string;
  description: string;
  source: string;
}

export interface LxToplistGroup {
  title: string;
  data: LxToplistEntry[];
}

export interface LxToplistSongItem {
  name: string;
  singer: string;
  album_name: string;
  album_id: string | number | null;
  songmid: string;
  source: string;
  interval: string;
  img: string | null;
  hash: string | null;
  str_media_mid: string | null;
  song_id: string | number | null;
  album_mid: string | null;
  copyright_id: string | null;
  types: { type: string; size: string | null; hash?: string | null }[];
  lx_types: Record<string, { size?: string | null; hash?: string }> | null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const str = (v: unknown): string => (v == null ? '' : String(v));

// 榜单接口无音质字段（wy/kw）：与搜索一致乐观声明全档，由播放时音质回退链
// 实测过滤，避免可选音质只剩 128k 一档。kg/tx 接口带各档真实数据，
// 分别见 kgDeclaredTypes / txDeclaredTypes。
const DECLARED_QUALITIES: Record<string, string[]> = {
  wy: ['128k', '320k', 'flac', 'flac24bit', 'master'],
  kw: ['128k', '320k', 'flac', 'flac24bit'],
};

const declaredTypes = (source: string, hash?: string | null) => {
  const qualities = DECLARED_QUALITIES[source] ?? ['128k'];
  const types = qualities.map((type) => ({ type, size: null as string | null, hash: hash ?? null }));
  const lxTypes: Record<string, { size?: string | null; hash?: string }> = {};
  for (const type of qualities) {
    lxTypes[type] = { hash: hash ?? undefined };
  }
  return { types, lxTypes };
};

// kg 榜单接口各档位 hash 独立（320hash/sqhash/hash_high/hash_super），高档位
// 解析必须用对应档位的 hash，主 hash 平摊会导致高档位探测全部失败被过滤。
// hash 或体积缺失的档位不声明（与搜索接口按 filesize 过滤一致）。
const kgDeclaredTypes = (item: any) => {
  const tiers = [
    { type: '128k', hash: str(item?.hash), bytes: Number(item?.filesize) || 0 },
    { type: '320k', hash: str(item?.['320hash']), bytes: Number(item?.['320filesize']) || 0 },
    { type: 'flac', hash: str(item?.sqhash), bytes: Number(item?.sqfilesize) || 0 },
    { type: 'flac24bit', hash: str(item?.hash_high), bytes: Number(item?.filesize_high) || 0 },
    { type: 'master', hash: str(item?.hash_super), bytes: Number(item?.filesize_super) || 0 },
  ].filter((t) => t.hash && t.bytes > 0);
  const types = tiers.map((t) => ({ type: t.type, size: sizeFormate(t.bytes), hash: t.hash }));
  const lxTypes: Record<string, { size?: string | null; hash?: string }> = {};
  for (const t of tiers) {
    lxTypes[t.type] = { size: sizeFormate(t.bytes), hash: t.hash };
  }
  return { types, lxTypes };
};

// ==================== WY（网易云） ====================

async function wyToplists(): Promise<LxToplistEntry[]> {
  const data = await httpGetJson('http://music.163.com/api/toplist', {
    'User-Agent': WY_UA,
    'Referer': 'http://music.163.com/',
  });
  const list: any[] = Array.isArray(data?.list) ? data.list : [];
  return list
    .map((item): LxToplistEntry => ({
      id: str(item?.id),
      title: str(item?.name),
      coverImg: str(item?.coverImgUrl),
      description: str(item?.updateFrequency),
      source: 'wy',
    }))
    .filter((e) => e.id && e.title);
}

async function wyToplistDetail(id: string, page: number, limit: number): Promise<{ list: LxToplistSongItem[]; isEnd: boolean }> {
  // n 为预取条数：覆盖到当前页末尾，本地切片分页
  const n = Math.min(1000, Math.max(limit, page * limit));
  const data = await httpGetJson(
    `http://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=${n}&s=0`,
    { 'User-Agent': WY_UA, 'Referer': 'http://music.163.com/' },
  );
  const tracks: any[] = data?.playlist?.tracks || [];
  const trackCount = Number(data?.playlist?.trackCount ?? data?.playlist?.track_count ?? tracks.length) || tracks.length;
  const list = tracks
    .slice((page - 1) * limit, page * limit)
    .map((song): LxToplistSongItem => {
      const ar: any[] = Array.isArray(song?.ar) ? song.ar : [];
      const al = song?.al || {};
      const { types, lxTypes } = declaredTypes('wy');
      return {
        name: str(song?.name),
        singer: ar.map((s) => str(s?.name)).filter(Boolean).join('、'),
        album_name: str(al?.name),
        album_id: al?.id ?? null,
        songmid: str(song?.id),
        source: 'wy',
        interval: formatPlayTime((Number(song?.dt) || 0) / 1000),
        img: al?.picUrl ? str(al.picUrl) : null,
        hash: null,
        str_media_mid: null,
        song_id: song?.id != null ? str(song.id) : null,
        album_mid: null,
        copyright_id: null,
        types,
        lx_types: lxTypes,
      };
    })
    .filter((it) => it.songmid && it.name);
  return { list, isEnd: page * limit >= trackCount };
}

// ==================== KG（酷狗） ====================

// kg 封面带 {size} 占位，必须替换成 480；上游 http 保持原样
const kgCoverUrl = (url: unknown): string | null => {
  const s = str(url).trim();
  return s ? s.replace('{size}', '480') : null;
};

async function kgToplists(): Promise<LxToplistEntry[]> {
  const data = await httpGetJson('http://mobilecdn.kugou.com/api/v3/rank/list?version=9108&plat=0&showtype=2&parentid=0&apiver=6');
  const info: any[] = data?.data?.info || [];
  return info
    .map((item): LxToplistEntry => ({
      id: str(item?.rankid),
      title: str(item?.rankname),
      coverImg: kgCoverUrl(item?.imgurl) ?? '',
      description: item?.songcount != null ? `${item.songcount} 首` : '',
      source: 'kg',
    }))
    .filter((e) => e.id && e.title);
}

async function kgToplistDetail(id: string, page: number, limit: number): Promise<{ list: LxToplistSongItem[]; isEnd: boolean }> {
  const data = await httpGetJson(
    `http://mobilecdn.kugou.com/api/v3/rank/song?version=9108&rankid=${encodeURIComponent(id)}&page=${page}&pagesize=${limit}`,
  );
  const info: any[] = data?.data?.info || [];
  const total = Number(data?.data?.total ?? 0) || 0;
  const list = info
    .map((item): LxToplistSongItem => {
      const authors: string = (Array.isArray(item?.authors) ? item.authors : [])
        .map((a: any) => str(a?.author_name)).filter(Boolean).join('/');
      const hash = str(item?.hash) || null;
      const { types, lxTypes } = kgDeclaredTypes(item);
      return {
        name: str(item?.songname),
        singer: authors || str(item?.filename),
        album_name: str(item?.remark),
        album_id: item?.album_id ?? null,
        // kg 榜单接口仅提供 hash 作为歌曲标识，songmid 与 url_resolver 的 hash 回退一致
        songmid: hash ?? '',
        source: 'kg',
        interval: formatPlayTime(Number(item?.duration) || 0),
        img: kgCoverUrl(item?.trans_param?.union_cover ?? item?.album_sizable_cover),
        hash,
        str_media_mid: null,
        song_id: null,
        album_mid: null,
        copyright_id: null,
        types,
        lx_types: lxTypes,
      };
    })
    .filter((it) => it.songmid && it.name);
  return { list, isEnd: total > 0 ? total <= page * limit : info.length < limit };
}

// ==================== KW（酷我） ====================

// pn 从 0 计；旧 p 参数被上游忽略（永远返回第一页），会导致榜单翻页失效
const kwBangUrl = (id: string | number, page: number, limit: number): string =>
  `http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&type=bang&data=content&id=${id}&pn=${page - 1}&rn=${limit}&isbang=1`;

// ksong.s 不带封面字段，且酷我封面路径为哈希分段无法由 albumid 拼出；
// 与 LX 插件 getPicByRid 同款按歌曲 rid 换取封面 URL（纯文本响应）
const kwPicUrl = (rid: string): string =>
  `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${rid}`;

// 单首歌换封面：5s 超时，响应非 http 开头视为无封面
async function kwSongCover(rid: string): Promise<string | null> {
  try {
    const text = (await withTimeout(httpGetText(kwPicUrl(rid)), 5000)).trim();
    return text.startsWith('http') ? text : null;
  } catch {
    return null;
  }
}

// 固定 ID 并发探测，收集已完成结果；总上限触发时未完成的条目丢弃
async function probeToplists<T>(
  ids: number[],
  probe: (id: number) => Promise<T | null>,
): Promise<T[]> {
  const out: (T | null)[] = new Array(ids.length).fill(null);
  await new Promise<void>((resolve) => {
    let pending = ids.length;
    const timer = setTimeout(resolve, PROBE_BATCH_CAP_MS);
    for (let i = 0; i < ids.length; i++) {
      const idx = i;
      withTimeout(probe(ids[idx]), PROBE_TIMEOUT_MS)
        .then((res) => { out[idx] = res; })
        .catch(() => { /* 超时/失败丢弃 */ })
        .finally(() => {
          pending -= 1;
          if (pending <= 0) {
            clearTimeout(timer);
            resolve();
          }
        });
    }
  });
  return out.filter((v): v is T => v !== null);
}

async function kwToplists(): Promise<LxToplistEntry[]> {
  const data = await httpGetJson('http://wapi.kuwo.cn/api/pc/bang/list');
  const groups: any[] = Array.isArray(data?.child) ? data.child : [];
  return groups
    .flatMap((g) => (Array.isArray(g?.child) ? g.child : []))
    .map((b): LxToplistEntry => ({
      id: str(b?.sourceid),
      title: str(b?.name).trim(),
      coverImg: str(b?.pic5) || str(b?.pic2) || str(b?.pic),
      description: str(b?.intro),
      source: 'kw',
    }))
    .filter((e) => e.id && e.title);
}

async function kwToplistDetail(id: string, page: number, limit: number): Promise<{ list: LxToplistSongItem[]; isEnd: boolean }> {
  const data = await httpGetJson(kwBangUrl(id, page, limit));
  const musiclist: any[] = data?.musiclist || [];
  const list = musiclist
    .map((m): LxToplistSongItem => {
      const { types, lxTypes } = declaredTypes('kw');
      return {
        name: str(m?.name),
        singer: str(m?.artist),
        album_name: str(m?.album),
        album_id: null,
        songmid: str(m?.id).replace(/^MUSIC_/i, ''),
        source: 'kw',
        interval: formatPlayTime(Number(m?.song_duration || m?.duration) || 0),
        img: null,
        hash: null,
        str_media_mid: null,
        song_id: m?.id != null ? str(m.id).replace(/^MUSIC_/i, '') : null,
        album_mid: null,
        copyright_id: null,
        types,
        lx_types: lxTypes,
      };
    })
    .filter((it) => it.songmid && it.name);
  // 并发换封面（rid → URL 一歌一请求）：单个失败留空不阻塞整页；
  // 逐项直接写 it.img + 3s 兜底放行页面（对齐 lxMusicSdkCover 非阻塞模式），
  // 超时前已完成者保留，未完成者本次留空不再等
  const coverTasks = list.map(async (it) => {
    it.img = await kwSongCover(it.songmid);
  });
  await Promise.race([
    Promise.allSettled(coverTasks),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  const total = Number(data?.num) || 0;
  return { list, isEnd: total > 0 ? total <= page * limit : musiclist.length < limit };
}

// ==================== TX（QQ音乐） ====================

const txToplistUrl = (id: string | number, songBegin: number, songNum: number): string =>
  `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=${id}&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq&needNewCode=0&song_begin=${songBegin}&song_num=${songNum}`;

const TX_HEADERS = { Referer: 'https://y.qq.com/' };

async function txToplists(): Promise<LxToplistEntry[]> {
  const entries = await probeToplists(TX_TOPLIST_IDS, async (id) => {
    const data = await httpGetJson(txToplistUrl(id, 0, 1), TX_HEADERS);
    const title = str(data?.topinfo?.ListName).trim();
    if (!title) return null;
    // pic_v12 是榜单真实封面（photo_new T003 标准格式）；headPic_v12/MacListPicUrl
    // 是运营配置图，冷门榜单会配成纯色占位图。gtimg 支持 https，统一升级。
    const coverImg = str(
      data?.topinfo?.pic_v12 || data?.topinfo?.headPic_v12 || data?.topinfo?.MacListPicUrl,
    ).replace('http://y.gtimg.cn', 'https://y.gtimg.cn');
    return {
      id: String(id),
      title,
      coverImg,
      description: '',
      source: 'tx',
    } as LxToplistEntry;
  });
  return entries;
}

async function txToplistDetail(id: string, page: number, limit: number): Promise<{ list: LxToplistSongItem[]; isEnd: boolean }> {
  const data = await httpGetJson(txToplistUrl(id, (page - 1) * limit, limit), TX_HEADERS);
  const songlist: any[] = data?.songlist || [];
  const list = songlist
    .map((entry): LxToplistSongItem => {
      const d = entry?.data || {};
      const { types, lxTypes } = txDeclaredTypes(d);
      return {
        name: str(d?.songname),
        singer: (Array.isArray(d?.singer) ? d.singer : []).map((s: any) => str(s?.name)).filter(Boolean).join('/'),
        album_name: str(d?.albumname),
        album_id: d?.albumid ?? null,
        songmid: str(d?.songmid),
        source: 'tx',
        interval: formatPlayTime(Number(d?.interval) || 0),
        img: d?.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${d.albummid}.jpg` : null,
        hash: null,
        str_media_mid: null,
        song_id: null,
        album_mid: d?.albummid ? str(d.albummid) : null,
        copyright_id: d?.copyrightId != null ? str(d.copyrightId) : null,
        types,
        lx_types: lxTypes,
      };
    })
    .filter((it) => it.songmid && it.name);
  return { list, isEnd: songlist.length < limit };
}

// tx 榜单接口自带各档位体积（size128/size320/sizeflac），映射进声明供菜单在
// 真实体积探测关闭时显示；flac24bit 无体积字段，档位仍乐观声明
const TX_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'];
const txDeclaredTypes = (item: any) => {
  const sizeOf = (v: unknown): string | null => {
    const bytes = Number(v);
    return bytes > 0 ? sizeFormate(bytes) : null;
  };
  const sizes: Record<string, string | null> = {
    '128k': sizeOf(item?.size128),
    '320k': sizeOf(item?.size320),
    flac: sizeOf(item?.sizeflac),
    flac24bit: null,
  };
  const types = TX_QUALITIES.map((type) => ({ type, size: sizes[type] ?? null, hash: null }));
  const lxTypes: Record<string, { size?: string | null; hash?: string }> = {};
  for (const type of TX_QUALITIES) {
    lxTypes[type] = { size: sizes[type] ?? undefined };
  }
  return { types, lxTypes };
};

// ==================== builtin 导出 ====================

const TOPLIST_FETCHERS: Record<string, () => Promise<LxToplistEntry[]>> = {
  wy: wyToplists,
  kg: kgToplists,
  kw: kwToplists,
  tx: txToplists,
};

const TOPLIST_DETAIL_FETCHERS: Record<string, (id: string, page: number, limit: number) => Promise<{ list: LxToplistSongItem[]; isEnd: boolean }>> = {
  wy: wyToplistDetail,
  kg: kgToplistDetail,
  kw: kwToplistDetail,
  tx: txToplistDetail,
};

export async function lxToplistGetTopLists(sources: string[]): Promise<LxToplistGroup[]> {
  const buckets = await Promise.all((sources ?? []).map(async (s) => {
    const fn = TOPLIST_FETCHERS[s];
    if (!fn) return [];
    try {
      return await withTimeout(fn(), LIST_TIMEOUT_MS);
    } catch (e: any) {
      console.warn(`[lxToplist] ${s} 榜单列表获取失败: ${e?.message || e}`);
      return [];
    }
  }));
  const entries = buckets.flat();
  return entries.length > 0 ? [{ title: '音源榜单', data: entries }] : [];
}

export async function lxToplistGetTopListDetail(
  source: string,
  id: string,
  page = 1,
  limit = 30,
): Promise<{ list: LxToplistSongItem[]; isEnd: boolean }> {
  const fn = TOPLIST_DETAIL_FETCHERS[source];
  if (!fn) throw new Error(`Unknown LX toplist source: ${source}`);
  return withTimeout(fn(id, page, limit), DETAIL_TIMEOUT_MS);
}

// ==================== dispatch 封装（优先 Rust QuickJS 宿主下发 JS） ====================

export async function lxToplistFetchTopLists(sources: string[]): Promise<LxToplistGroup[]> {
  return dispatchFallbackModule('lx_toplist', 'getTopLists', { sources },
    () => lxToplistGetTopLists(sources));
}

// snake_case LxSearchItem → 与 lx_search 结果同构的 LxSearchResultItem
function lxToplistItemToSearchItem(item: any): LxSearchResultItem {
  const types = (Array.isArray(item?.types) ? item.types : [])
    .map((t: any) => ({
      type: str(t?.type),
      size: t?.size ?? null,
      hash: t?.hash ?? undefined,
    }))
    .filter((t: any) => t.type);
  return {
    name: str(item?.name),
    singer: str(item?.singer),
    albumName: str(item?.album_name),
    albumId: item?.album_id ?? '',
    songmid: str(item?.songmid),
    source: item?.source as LxSearchResultItem['source'],
    interval: str(item?.interval) || '00:00',
    img: item?.img ?? null,
    hash: item?.hash ?? undefined,
    strMediaMid: item?.str_media_mid ?? undefined,
    songId: item?.song_id ?? undefined,
    albumMid: item?.album_mid ?? undefined,
    copyrightId: item?.copyright_id ?? undefined,
    types,
    _types: (item?.lx_types && typeof item.lx_types === 'object') ? item.lx_types : {},
  };
}

export async function lxToplistFetchTracks(
  source: string,
  id: string,
  page = 1,
  limit = 30,
): Promise<{ list: LxSearchResultItem[]; isEnd: boolean }> {
  const result = await dispatchFallbackModule('lx_toplist', 'getTopListDetail', { source, id, page, limit },
    () => lxToplistGetTopListDetail(source, id, page, limit));
  const list = Array.isArray(result?.list) ? result.list : [];
  return {
    list: list.map(lxToplistItemToSearchItem).filter((it) => it.songmid && it.name),
    isEnd: result?.isEnd === true,
  };
}
