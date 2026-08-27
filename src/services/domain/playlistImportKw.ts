import { decodeName } from '../../utils/musicFormat';
import type { PluginSearchResult } from '../../types';
import {
  createSearchResult,
  formatPlayTime,
  getKwListId,
  httpFetch,
  type PlaylistImportResult,
  type PlaylistInfo,
  type WyTrackMetaPatch,
} from './playlistImportBase';

/**
 * 酷我（小枸）歌单详情与曲目元数据导入。
 * 仅依赖 playlistImportBase，作为叶子模块被 playlistImport 门面消费。
 */

async function getListDetailKw(rawId: string): Promise<PlaylistImportResult> {
  const id = getKwListId(rawId);
  if (!id) return { source: 'kw', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  const url = `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}` +
    `&pn=0&rn=1000&encode=utf8&keyset=pl2012` +
    `&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`;

  const resp = await httpFetch(url, 'GET', {
    'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 9;)',
  });

  const body = resp.body;
  if (typeof body !== 'object' || body === null || body.result !== 'ok') {
    throw new Error(`酷我歌单获取失败: result=${body?.result ?? 'unknown'}`);
  }

  const musiclist = body.musiclist || [];
  const songs: PluginSearchResult[] = [];
  for (const item of musiclist) {
    const parsed = parseKwSong(item);
    if (parsed) songs.push(parsed);
  }

  const info: PlaylistInfo = {
    name: decodeName(body.title || ''),
    img: body.pic || '',
    desc: decodeName(body.info || ''),
    author: decodeName(body.uname || ''),
    playCount: String(body.playnum || 0),
  };

  return { source: 'kw', songs, total: body.total || songs.length, info };
}

function parseKwSong(item: any): PluginSearchResult | null {
  const idStr = String(item.id ?? '');
  if (!idStr) return null;

  const name = decodeName(item.name || '');
  const artist = decodeName(item.artist || '');
  const album = decodeName(item.album || '');
  const durationSec = parseInt(item.duration || '0', 10) || 0;

  const rawData = {
    songmid: idStr,
    name,
    singer: artist,
    source: 'kw',
    interval: formatPlayTime(durationSec),
  };

  return createSearchResult({
    id: idStr,
    title: name,
    artist,
    album,
    coverUrl: '',
    duration: durationSec * 1000,
    platform: '酷我',
    sourceKey: 'kw',
    rawData,
  });
}

/**
 * 酷我批量索引：优先一次拉全整页时长，未命中再逐首兜底。
 *
 * 时迁酱系酷我插件的 getMusicSheetInfo（nplserver）与 getArtistWorks（r.s artist2music）
 * 映射时丢弃了接口条目自带的 duration，且歌单/歌手页 item 不带时长。
 * 两个源接口本身稳定开放（无风控），条目自带 id/musicrid + duration（秒）：
 * - 歌单：nplserver pl.svc op=getlistinfo，一次 rn=1000 拉全
 * - 歌手：search.kuwo.cn/r.s stype=artist2music，rn=100 翻页（上限 5 页）
 * www.kuwo.cn/api musicInfo 已被风控（"The request is illegal!"），仅作最后兜底。
 */
async function buildKwSheetIndex(sheetId: string): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  if (!/^\d+$/.test(sheetId)) return index;
  try {
    const resp = await httpFetch(
      `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${sheetId}&pn=0&rn=1000` +
      `&encode=utf8&keyset=pl2012&vipver=MUSIC_9.1.1.2_BCS2&newver=1`,
      'GET',
      { Referer: 'https://www.kuwo.cn/' },
    );
    const body = resp.body as any;
    if (!body || body.result !== 'ok') return index;
    for (const track of body.musiclist || []) {
      const rid = String(track.id ?? '').replace(/^MUSIC_/i, '');
      const sec = parseInt(track.duration || '0', 10) || 0;
      if (rid && sec > 0) index.set(rid, sec * 1000);
    }
  } catch { /* 失败走逐首兜底 */ }
  return index;
}

async function buildKwArtistIndex(artistId: string): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  if (!/^\d+$/.test(artistId)) return index;
  for (let pn = 0; pn < 5; pn++) {
    try {
      const resp = await httpFetch(
        `http://search.kuwo.cn/r.s?pn=${pn}&rn=100&artistid=${artistId}&stype=artist2music` +
        `&sortby=0&alflac=1&show_copyright_off=1&pcmp4=1&encoding=utf8&plat=pc` +
        `&thost=search.kuwo.cn&vipver=MUSIC_9.1.1.2_BCS2&devid=38668888&newver=1&pcjson=1`,
        'GET',
        { Referer: 'https://www.kuwo.cn/' },
      );
      const text = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
      const body = JSON.parse(String(text).replace(/'/g, '"'));
      const list = body?.musiclist || [];
      for (const track of list) {
        const rid = String(track.musicrid ?? '').replace(/^MUSIC_/i, '');
        const sec = parseInt(track.duration || '0', 10) || 0;
        if (rid && sec > 0) index.set(rid, sec * 1000);
      }
      const total = Number(body?.total) || 0;
      if ((pn + 1) * 100 >= total || list.length === 0) break;
    } catch { break; }
  }
  return index;
}

export async function fetchKwTrackMetaByIds(
  items: { id: string; title?: string; artist?: string }[],
  opts?: {
    sheetId?: string;
    artistId?: string;
    /** 增量回调：批量索引/逐首兜底每个阶段就绪即回调，调用方立即落盘，无需等慢速兜底全部跑完 */
    onPatches?: (patches: ReadonlyMap<string, WyTrackMetaPatch>) => void;
  },
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  const validItems = items.filter(item => /^\d+$/.test(item.id));
  if (validItems.length === 0) return patches;

  // 批量索引优先：歌单页/歌手页一次拉全（快且不受 musicInfo 风控影响）
  const batchIndex = new Map<string, number>();
  if (opts?.sheetId) {
    for (const [rid, ms] of await buildKwSheetIndex(opts.sheetId)) batchIndex.set(rid, ms);
  }
  if (opts?.artistId) {
    for (const [rid, ms] of await buildKwArtistIndex(opts.artistId)) batchIndex.set(rid, ms);
  }
  for (const item of validItems) {
    const ms = batchIndex.get(item.id);
    if (ms) patches.set(item.id, { coverUrl: '', durationMs: ms });
  }
  // 批量命中立即通知落盘（不等下方逐首兜底）
  opts?.onPatches?.(patches);

  const CONCURRENCY = 3;
  const fetchOne = async (rid: string): Promise<WyTrackMetaPatch | null> => {
    try {
      const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const resp = await httpFetch(
        `https://www.kuwo.cn/api/www/music/musicInfo?mid=${rid}&httpsStatus=1&reqId=${reqId}`,
        'GET',
        {
          csrf: 'ABCDEF',
          Cookie: 'kw_token=ABCDEF',
          Referer: 'https://www.kuwo.cn/',
        },
      );
      const data = (resp.body as any)?.data;
      if (!data) return null;
      const durationSec = Number(data.duration) || 0;
      const pic = String(data.pic || data.albumpic || '');
      return {
        coverUrl: pic ? pic.replace(/^http:\/\//i, 'https://') : '',
        durationMs: durationSec > 0 ? durationSec * 1000 : 0,
      };
    } catch {
      return null;
    }
  };

  // 逐首 musicInfo 只处理批量索引未命中的零星条目（全命中时立即返回，不等慢队列）。
  // www 域被风控时每首都要等超时，若全量跑会拖住整个补全的落盘时间
  const leftover = validItems.filter(item => !patches.get(item.id)?.durationMs).slice(0, 40);
  let cursor = 0;
  const worker = async () => {
    while (cursor < leftover.length) {
      const item = leftover[cursor++];
      const patch = await fetchOne(item.id);
      if (patch) patches.set(item.id, patch);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, leftover.length) }, () => worker()),
  );
  if (leftover.length > 0) opts?.onPatches?.(patches);

  // musicInfo 仍缺时长时回退：r.s 开放接口按歌名搜索（返回 Python 风格单引号 JSON），
  // rid 全局唯一，精确匹配 MUSICRID 后取 DURATION（秒）。限量防刷，小并发缩短串行尾巴
  const missing = validItems.filter(item => {
    const p = patches.get(item.id);
    return !p || !p.durationMs;
  }).filter(item => item.title).slice(0, 40);
  if (missing.length > 0) {
    let rsCursor = 0;
    const rsWorker = async () => {
      while (rsCursor < missing.length) {
        const item = missing[rsCursor++];
        try {
          const url =
            `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(item.title!)}` +
            `&pn=0&rn=30&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1` +
            `&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
          const resp = await httpFetch(url, 'GET', { Referer: 'https://www.kuwo.cn/' });
          const text = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
          const abslist = JSON.parse(String(text).replace(/'/g, '"'))?.abslist || [];
          const hit = abslist.find(
            (entry: any) => String(entry.MUSICRID || '').replace('MUSIC_', '') === item.id,
          );
          if (hit) {
            const durationSec = parseInt(hit.DURATION) || 0;
            if (durationSec > 0) {
              patches.set(item.id, { coverUrl: '', durationMs: durationSec * 1000 });
            }
          }
        } catch { /* 逐首失败忽略 */ }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, missing.length) }, () => rsWorker()),
    );
    opts?.onPatches?.(patches);
  }

  return patches;
}

export { getListDetailKw };