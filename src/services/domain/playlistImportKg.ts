import { hostKugouRequestKey, hostKugouSign } from '../tauri/hostCryptoApi';
import { decodeName } from '../../utils/musicFormat';
import type { PluginSearchResult } from '../../types';
import {
  createSearchResult,
  formatPlayTime,
  getKgListId,
  httpFetch,
  log,
  type PlaylistImportResult,
  type PlaylistInfo,
  type WyTrackMetaPatch,
} from './playlistImportBase';

/**
 * 酷狗（小蜗）歌单详情与曲目元数据导入。
 * 仅依赖 playlistImportBase，作为叶子模块被 playlistImport 门面消费。
 */

// ==================== 酷狗签名（Rust host_crypto 计算） ====================

/**
 * 酷狗签名参数（与 LxSdkSongList.signatureParamsKg 一致）
 * sign = md5(keyparam + sortedParams + body + keyparam)
 */
function signatureParamsKg(params: string, platform: string, body: string): Promise<string> {
  return hostKugouSign(params, platform, body);
}

// ==================== 歌单详情 ====================

async function getListDetailKg(rawId: string): Promise<PlaylistImportResult> {
  // 分支 1：gcid_ 分享链接
  if (rawId.includes('gcid_')) {
    return getKgListDetailByGcid(rawId);
  }
  // 分支 2：包含 global_collection_id 参数
  if (rawId.includes('global_collection_id')) {
    const m = rawId.match(/global_collection_id=(\w+)/);
    if (m && m[1]) {
      return getKgUserListDetail2(m[1]);
    }
  }
  // 分支 3：先尝试本地正则提取 specialid
  let id = getKgListId(rawId);
  if (!id && (rawId.startsWith('http://') || rawId.startsWith('https://'))) {
    const gcid = await resolveKgShareUrl(rawId);
    if (gcid) return getKgUserListDetail2(gcid);
  }
  if (!id) return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  // 通过 specialid 获取歌单详情（HTML 解析）
  const url = `https://www2.kugou.kugou.com/yueku/v9/special/single/${id}-5-9999.html`;
  const resp = await httpFetch(url, 'GET');
  const body = typeof resp.body === 'string' ? resp.body : '';

  const listDataMatch = body.match(/global\.data\s*=\s*(\[.+]);/s);
  if (!listDataMatch) {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  let listArr: any[];
  try {
    listArr = JSON.parse(listDataMatch[1]);
  } catch {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  const songs: PluginSearchResult[] = [];
  for (const item of listArr) {
    const parsed = parseKgSong(item);
    if (parsed) songs.push(parsed);
  }

  const listInfoMatch = body.match(/global\s*=\s*\{[\s\S]+?name:\s*"(.+?)"[\s\S]+?pic:\s*"(.+?)"[\s\S]+?};/);
  const info: PlaylistInfo = {
    name: listInfoMatch ? decodeName(listInfoMatch[1]) : '',
    img: listInfoMatch ? listInfoMatch[2] : '',
    desc: '',
    author: '',
    playCount: '',
  };

  return { source: 'kg', songs, total: songs.length, info };
}

function parseKgSong(item: any): PluginSearchResult | null {
  const hash = item.hash || '';
  const audioId = String(item.audio_id ?? '');
  if (!hash && !audioId) return null;

  const singerName = decodeName(item.singername || '');
  const songname = decodeName(item.songname || '');
  const albumName = decodeName(item.album_name || '');
  const durationMs = item.duration || 0;

  const songIdStr = audioId || hash;
  const rawData: any = {
    songmid: songIdStr,
    name: songname,
    singer: singerName,
    source: 'kg',
    interval: formatPlayTime(Math.floor(durationMs / 1000)),
  };
  if (hash) rawData.hash = hash;

  return createSearchResult({
    id: songIdStr,
    title: songname,
    artist: singerName,
    album: albumName,
    coverUrl: '',
    duration: durationMs,
    platform: '酷狗',
    sourceKey: 'kg',
    rawData,
  });
}

/** 处理 gcid_ 分享链接 */
async function getKgListDetailByGcid(rawId: string): Promise<PlaylistImportResult> {
  const gcidMatch = rawId.match(/gcid_(\w+)/);
  let globalCollectionId: string | null = null;

  if (gcidMatch) {
    const gcid = 'gcid_' + gcidMatch[1];
    try {
      globalCollectionId = await decodeGcid(gcid);
    } catch (e: any) {
      log(`getKgListDetailByGcid: decodeGcid failed: ${e?.message}`);
    }
  }

  // 回退：fetch 分享链接 HTML
  if (!globalCollectionId && (rawId.startsWith('http://') || rawId.startsWith('https://'))) {
    globalCollectionId = await resolveKgShareUrl(rawId);
  }

  if (!globalCollectionId) {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  return getKgUserListDetail2(globalCollectionId);
}

/** 从分享 URL HTML 中提取 global_collection_id */
async function resolveKgShareUrl(url: string): Promise<string | null> {
  try {
    const resp = await httpFetch(url, 'GET', {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1',
      'Referer': url,
    });
    const body = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
    if (!body) return null;

    // 1. 直接提取 global_collection_id
    let m = body.match(/global_collection_id["']?\s*[:=]\s*["']?(\w+)/);
    if (m && m[1]) return m[1];

    // 2. 提取 encode_gic / encode_src_gid → decodeGcid
    const gcid = body.match(/"encode_gic"\s*:\s*"(\w+)"/)?.[1]
      || body.match(/"encode_src_gid"\s*:\s*"(\w+)"/)?.[1]
      || body.match(/encode_gic["']?\s*[:=]\s*["']?(\w+)/)?.[1]
      || body.match(/encode_src_gid["']?\s*[:=]\s*["']?(\w+)/)?.[1];

    if (gcid) {
      try {
        return await decodeGcid('gcid_' + gcid);
      } catch (e: any) {
        log(`resolveKgShareUrl: decodeGcid(${gcid}) failed: ${e?.message}`);
      }
    }

    return null;
  } catch (e: any) {
    log(`resolveKgShareUrl failed: ${e?.message}`);
    return null;
  }
}

/** 酷狗 decodeGcid（与 kg/songList.js decodeGcid 一致） */
async function decodeGcid(gcid: string): Promise<string> {
  const params = 'dfid=-&appid=1005&mid=0&clientver=20109&clienttime=640612895&uuid=-';
  const bodyStr = `{"ret_info":1,"data":[{"id":"${gcid}","id_type":2}]}`;
  const signature = await signatureParamsKg(params, 'android', bodyStr);
  const url = `https://t.kugou.com/v1/songlist/batch_decode?${params}&signature=${signature}`;

  const resp = await httpFetch(url, 'POST', {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; HUAWEI HMA-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36',
    'Referer': 'https://m.kugou.com/',
    'Content-Type': 'application/json',
  }, bodyStr);

  const body = resp.body;
  if (typeof body !== 'object' || body === null) {
    throw new Error('decodeGcid: response not JSON');
  }

  const errCode = body.error_code ?? body.errcode ?? body.err_code ?? -1;
  if (errCode !== 0) {
    throw new Error(`decodeGcid failed: errcode=${errCode}`);
  }

  const list = body.data?.list || body.list || body.info?.list || body.data?.info;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('decodeGcid: missing or empty list');
  }

  const globalCollectionId = list[0].global_collection_id || list[0].global_specialid;
  if (!globalCollectionId) {
    throw new Error('decodeGcid: missing global_collection_id');
  }

  return globalCollectionId;
}

/** 酷狗 getUserListDetail2（与 kg/songList.js 一致） */
async function getKgUserListDetail2(globalCollectionId: string): Promise<PlaylistImportResult> {
  if (globalCollectionId.length > 1000) {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  const id = globalCollectionId;
  const commonHeaders: Record<string, string> = {
    'mid': '1586163242519',
    'Referer': 'https://m3ws.kugou.com/share/index.php',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
    'dfid': '-',
    'clienttime': '1586163242519',
  };

  // 1. 获取歌单元信息
  const infoParams = `appid=1058&specialid=0&global_specialid=${id}&format=jsonp&srcappid=2919&clientver=20000&clienttime=1586163242519&mid=1586163242519&uuid=1586163242519&dfid=-`;
  const infoSig = await signatureParamsKg(infoParams, 'web', '');
  const infoUrl = `https://mobiles.kugou.com/api/v5/special/info_v2?${infoParams}&signature=${infoSig}`;
  const infoResp = await httpFetch(infoUrl, 'GET', commonHeaders);
  const infoBody = infoResp.body;
  if (typeof infoBody !== 'object' || infoBody === null) {
    throw new Error('kg info_v2: response not JSON');
  }

  const errCode = infoBody.error_code ?? infoBody.errcode ?? infoBody.err_code ?? -1;
  if (errCode !== 0) {
    throw new Error(`kg info_v2 failed: errcode=${errCode}`);
  }

  const info = infoBody.data || infoBody;
  const songCount = info.songcount || 0;
  const playlistName = decodeName(info.specialname || '');
  const playlistImg = (info.imgurl || '').replace('{size}', '240');
  const playlistDesc = decodeName(info.intro || '');
  const playlistAuthor = decodeName(info.nickname || '');

  // 2. 分页获取歌曲 hash 列表
  const hashList: any[] = [];
  let total = songCount;
  let p = 0;
  while (total > 0) {
    const limit = Math.min(total, 300);
    total -= limit;
    p++;
    const songParams = `appid=1058&global_specialid=${id}&specialid=0&plat=0&version=8000&page=${p}&pagesize=${limit}&srcappid=2919&clientver=20000&clienttime=1586163263991&mid=1586163263991&uuid=1586163263991&dfid=-`;
    const songSig = await signatureParamsKg(songParams, 'web', '');
    const songUrl = `https://mobiles.kugou.com/api/v5/special/song_v2?${songParams}&signature=${songSig}`;
    const songResp = await httpFetch(songUrl, 'GET', commonHeaders);
    const songBody = songResp.body;
    if (typeof songBody !== 'object' || songBody === null) break;

    const sErr = songBody.error_code ?? songBody.errcode ?? songBody.err_code ?? -1;
    if (sErr !== 0) break;

    const infoArr = songBody.data?.info || songBody.info || [];
    for (const item of infoArr) {
      hashList.push(item);
    }
  }

  // 3. 批量获取完整歌曲信息
  const songs = await getKgMusicInfos(hashList);

  const infoObj: PlaylistInfo = {
    name: playlistName,
    img: playlistImg,
    desc: playlistDesc,
    author: playlistAuthor,
    playCount: '',
  };

  return { source: 'kg', songs, total: songs.length, info: infoObj };
}

/** 酷狗批量获取歌曲信息 */
async function getKgMusicInfos(list: any[]): Promise<PluginSearchResult[]> {
  if (list.length === 0) return [];

  // 去重（按 hash）
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const item of list) {
    const hash = item.hash || '';
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    deduped.push(item);
  }

  // 分批（每批 100 个）
  const batches: any[][] = [];
  for (let i = 0; i < deduped.length; i += 100) {
    batches.push(deduped.slice(i, i + 100));
  }

  const results = await Promise.all(batches.map(async (batch) => {
    try {
      const key = await hostKugouRequestKey();
      const dataObj = {
        area_code: '1',
        show_privilege: 1,
        show_album_info: 1,
        is_publish: '',
        appid: 1005,
        clientver: 11451,
        mid: '1',
        dfid: '-',
        clienttime: Date.now(),
        key,
        fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname',
        data: batch,
      };

      const resp = await httpFetch(
        'http://gateway.kugou.com/v2/album_audio/audio',
        'POST',
        {
          'KG-THash': '13a3164',
          'KG-RC': '1',
          'KG-Fake': '0',
          'KG-RF': '00869891',
          'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
          'x-router': 'kmr.service.kugou.com',
          'Content-Type': 'application/json',
        },
        JSON.stringify(dataObj),
      );

      const body = resp.body;
      if (typeof body !== 'object' || body === null) return [];

      const errCode = body.error_code ?? body.errcode ?? body.err_code ?? -1;
      if (errCode !== 0) return [];

      const dataArr = body.data || [];
      const songs: PluginSearchResult[] = [];
      for (const item of dataArr) {
        // 每个元素是数组，取 [0]
        const first = Array.isArray(item) ? item[0] : item;
        if (first) {
          const parsed = parseKgSongDetailV2(first);
          if (parsed) songs.push(parsed);
        }
      }
      return songs;
    } catch (e: any) {
      log(`getKgMusicInfos batch failed: ${e?.message}`);
      return [];
    }
  }));

  return results.flat();
}

function parseKgSongDetailV2(item: any): PluginSearchResult | null {
  const audioInfo = item.audio_info || {};
  const albumInfo = item.album_info || {};
  const hash = audioInfo.hash || '';
  const audioId = String(audioInfo.audio_id ?? '');
  if (!hash && !audioId) return null;

  const singerName = decodeName(item.author_name || '');
  const songname = decodeName(item.songname || '');
  const albumName = decodeName(albumInfo.album_name || '');
  const durationMs = audioInfo.timelength || 0;

  const songIdStr = audioId || hash;
  const rawData: any = {
    songmid: songIdStr,
    name: songname,
    singer: singerName,
    source: 'kg',
    interval: formatPlayTime(Math.floor(durationMs / 1000)),
  };
  if (hash) rawData.hash = hash;

  return createSearchResult({
    id: songIdStr,
    title: songname,
    artist: singerName,
    album: albumName,
    coverUrl: '',
    duration: durationMs,
    platform: '酷狗',
    sourceKey: 'kg',
    rawData,
  });
}

/**
 * 按酷狗歌曲标识补全时长（专辑页优先整张专辑一次拉全，精确 hash 匹配）。
 *
 * 时迁酱系酷狗插件的 getAlbumInfo 结果不带时长。mobilecdn v3 album/song 按专辑 ID
 * 返回全量曲目（字段小写：hash/duration 秒/filename），一次请求即可补完整页；
 * 无专辑 ID（歌手页等）或未命中时回退 song_search_v2 按歌名搜索，hash 精确匹配。
 */
export async function fetchKgTrackMetaByIds(
  items: { id: string; title?: string; artist?: string }[],
  albumId?: string,
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  if (items.length === 0) return patches;

  // hash 小写索引 + 数字 ID（audio_id/mixsongid）索引，同一曲目双键登记
  const hashIndex = new Map<string, { durationMs: number; coverUrl: string }>();
  const numIndex = new Map<string, { durationMs: number; coverUrl: string }>();
  const register = (hash: any, nums: any[], durationSec: number, coverUrl: string) => {
    if (durationSec <= 0) return;
    const entry = { durationMs: durationSec * 1000, coverUrl: coverUrl || '' };
    const h = String(hash || '').trim().toLowerCase();
    if (h) hashIndex.set(h, entry);
    for (const n of nums) {
      const key = String(n ?? '').trim();
      if (key && /^\d+$/.test(key)) numIndex.set(key, entry);
    }
  };
  const lookup = (id: string): { durationMs: number; coverUrl: string } | undefined =>
    hashIndex.get(id.toLowerCase()) || numIndex.get(id);

  // 专辑页：一次拉全量曲目
  if (albumId && /^\d+$/.test(albumId)) {
    try {
      const resp = await httpFetch(
        `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${albumId}&page=1&pagesize=-1`,
        'GET',
        { Referer: 'https://www.kugou.com/' },
      );
      const info = ((resp.body as any)?.data?.info || []) as any[];
      for (const track of info) {
        register(track.hash, [track.audio_id, track.album_audio_id, track.mixsongid], Number(track.duration) || 0, '');
      }
    } catch { /* 专辑接口失败走搜索兜底 */ }
  }

  let searched = 0;
  for (const item of items) {
    const hit = lookup(item.id);
    if (hit) {
      patches.set(item.id, hit);
      continue;
    }
    // 搜索兜底：按歌名搜索，hash/数字 ID 精确匹配（限量防刷）
    if (!item.title || searched >= 40) continue;
    searched++;
    try {
      const resp = await httpFetch(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(item.title)}` +
        `&page=1&pagesize=30&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`,
        'GET',
        { Referer: 'https://www.kugou.com/' },
      );
      const lists = ((resp.body as any)?.data?.lists || []) as any[];
      for (const track of lists) {
        register(track.FileHash, [track.MixSongID, track.Audioid, track.AudioId], Number(track.Duration) || 0, '');
        const m = lookup(item.id);
        if (m) {
          patches.set(item.id, m);
          break;
        }
      }
    } catch { /* 逐首失败忽略 */ }
  }

  return patches;
}

export { getListDetailKg };