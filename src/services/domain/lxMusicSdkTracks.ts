import {
  firstValue,
  formatPlayTime,
  httpGetJson,
  httpGetText,
  httpPostJson,
  zzcSign,
  type LxSearchResultItem,
} from './lxMusicSdkBase';
import {
  txHandleResult,
} from './lxSearchPlatform';
import { buildKugouCoverUrl } from './lxSearchKg';
import { decodeName, formatSingerName } from '../../utils/musicFormat';
import { dispatchFallbackModule } from '../fallbackModules/registry';
import type { LxSourceId } from './lxMusicSdkTypes';

function buildSimpleLxItem(
  source: LxSourceId,
  songmid: string,
  name: string,
  singer: string,
  albumName: string,
  albumId: string | number,
  interval: string,
  img: string | null,
  extra?: Partial<LxSearchResultItem>,
): LxSearchResultItem {
  return {
    name: decodeName(name),
    singer: decodeName(singer),
    albumName: decodeName(albumName),
    albumId,
    songmid,
    source,
    interval,
    img,
    types: [],
    _types: {},
    ...extra,
  };
}

function isValidAlbumId(source: LxSourceId, albumId: string): boolean {
  if (!albumId) return false;
  if (source === 'tx') {
    return /^[A-Za-z0-9]{6,}$/.test(albumId);
  }
  return /^\d+$/.test(albumId);
}

export async function lxGetAlbumSongs(
  source: LxSourceId,
  albumRawData: any,
  page = 1,
  limit = 30,
): Promise<LxSearchResultItem[]> {
  return dispatchFallbackModule('lx_album', 'getAlbumSongs', { source, albumRawData, page, limit },
    () => lxGetAlbumSongsBuiltin(source, albumRawData, page, limit));
}

// ==================== 专辑全量分页（移植 QQ/酷我插件加载逻辑） ====================
// 宿主详情页对专辑只请求一次，单页接口会把大专辑截断；各平台改为内部翻页取全。

const ALBUM_MAX_PAGES = 100;

// QQ 专辑：上游单次最多稳定返回 999 首，按 begin 继续取全（与 QQ 插件一致）
const TX_ALBUM_PAGE_SIZE = 999;

async function txAlbumAllSongs(albumId: string): Promise<LxSearchResultItem[]> {
  const songList: any[] = [];
  const pageSignatures = new Set<string>();
  let total: number | null = null;

  for (let begin = 0, pageIndex = 0; ; begin += TX_ALBUM_PAGE_SIZE, ++pageIndex) {
    if (pageIndex >= ALBUM_MAX_PAGES) throw new Error('QQ专辑分页超出合理范围，请重试');
    const requestData = {
      comm: { ct: '19', cv: '1859' },
      albumSonglist: {
        method: 'GetAlbumSongList',
        param: { albumMid: albumId, albumID: 0, begin, num: TX_ALBUM_PAGE_SIZE, order: 2 },
        module: 'music.musichallAlbum.AlbumSongList',
      },
    };
    const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&data=${encodeURIComponent(JSON.stringify(requestData))}`;
    const res = await httpGetJson(url, {
      referer: 'https://y.qq.com',
      Cookie: 'uin=',
    });
    const data = res?.albumSonglist?.data;
    const code = res?.albumSonglist?.code;
    if (!data || !Array.isArray(data.songList) || (code != null && code !== 0)) {
      throw new Error('QQ专辑歌曲获取失败，请稍后重试');
    }
    const reported = Number(data.totalNum ?? data.songNum);
    if (Number.isFinite(reported) && reported > 0) {
      total = Math.max(total || 0, reported);
    }
    const entries = data.songList;
    const signature = JSON.stringify(entries.map((item: any) => item?.songInfo?.id ?? item?.songInfo?.mid));
    if (entries.length && pageSignatures.has(signature)) throw new Error('QQ专辑接口重复返回同一页，请重试');
    pageSignatures.add(signature);
    if (!entries.length && total !== null && begin < total) throw new Error('QQ专辑分页提前结束，请重试');
    for (const entry of entries) {
      const song = entry?.songInfo;
      if (!song || song.id == null) continue;
      songList.push(song);
    }
    if (total !== null ? begin + TX_ALBUM_PAGE_SIZE >= total : entries.length < TX_ALBUM_PAGE_SIZE) break;
  }
  if (songList.length === 0) console.warn(`[LxMusicSdk] TX album ${albumId}: empty songList`);
  return txHandleResult(songList);
}

async function kwAlbumAllSongs(albumId: string, albumName: string): Promise<LxSearchResultItem[]> {
  const rn = 100;
  const out: LxSearchResultItem[] = [];
  for (let pn = 0; pn < ALBUM_MAX_PAGES; pn++) {
    const url = `http://www.kuwo.cn/api/www/album/albumInfo?albumid=${albumId}&pn=${pn}&rn=${rn}`;
    const data = await httpGetJson(url, {
      csrf: 'ABCDEF',
      Cookie: 'kw_token=ABCDEF',
      Referer: 'http://www.kuwo.cn/',
    });
    const musicList: any[] = data?.data?.musicList || [];
    out.push(...musicList.map((m: any) => buildSimpleLxItem(
      'kw', String(m.rid || m.id), m.name || '', m.artist || '',
      m.album || albumName, m.albumid || albumId,
      formatPlayTime(parseInt(m.duration) || 0), m.pic || null,
    )));
    if (musicList.length < rn) break;
  }
  if (out.length === 0) console.warn(`[LxMusicSdk] KW album ${albumId}: empty musicList`);
  return out;
}

async function kgAlbumAllSongs(albumId: string): Promise<LxSearchResultItem[]> {
  const pagesize = 100;
  const out: LxSearchResultItem[] = [];
  for (let page = 1; page <= ALBUM_MAX_PAGES; page++) {
    const url = `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${albumId}&page=${page}&pagesize=${pagesize}`;
    const data = await httpGetJson(url, KG_V3_HEADERS);
    const infoList: any[] = data?.data?.info || [];
    out.push(...infoList
      .map((item: any) => kgItemToLx(item))
      .filter((item): item is LxSearchResultItem => item !== null));
    if (infoList.length < pagesize) break;
  }
  if (out.length === 0) console.warn(`[LxMusicSdk] KG album ${albumId}: empty info list`);
  return out;
}

// 咪咕专辑接口单页上限较小，压低 pageSize 保证能完整翻页
async function mgAlbumAllSongs(albumId: string, albumName: string): Promise<LxSearchResultItem[]> {
  const pageSize = 30;
  const out: LxSearchResultItem[] = [];
  for (let pageNo = 1; pageNo <= ALBUM_MAX_PAGES * 3; pageNo++) {
    const url = `https://m.music.migu.cn/migu/remoting/cms_album_song_list_tag?albumId=${albumId}&pageNo=${pageNo}&pageSize=${pageSize}`;
    const data = await httpGetJson(url);
    const list: any[] = data?.resultList || data?.list || [];
    out.push(...list.map((item: any) => buildSimpleLxItem(
      'mg', String(item.songId || item.id), item.name || item.songName || '',
      formatSingerName(item.singerList || item.singers),
      item.album || item.albumName || albumName, item.albumId || albumId,
      formatPlayTime(item.duration || 0), item.img3 || item.img2 || item.img1 || null,
      { copyrightId: item.copyrightId },
    )));
    if (list.length < pageSize) break;
  }
  if (out.length === 0) console.warn(`[LxMusicSdk] MG album ${albumId}: empty list`);
  return out;
}

// ==================== KG 歌单/专辑条目（v9 歌单页全量 + v3 兜底） ====================
// v3 special/getSongList 对无 Referer 请求返回纯文本 "Access Deny"（非 JSON），
// 且其条目为小写字段（hash/audio_id/filename），旧映射 kgFilterData 是 search_v2 的大写字段，对不上。
// 歌单主路径改走 v9 歌单页单次全量（对齐 Rust playlist_fetcher/kg.rs 的 v9 逻辑）。

const KG_V3_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://www.kugou.com/',
};

function kgItemToLx(item: any, opts: { durationMs?: boolean } = {}): LxSearchResultItem | null {
  const hash = String(item?.hash || '');
  const songmid = String(item?.audio_id ?? item?.album_audio_id ?? item?.mixsongid ?? '') || hash;
  if (!hash && !songmid) return null;
  let name = decodeName(item?.songname || '');
  let singer = decodeName(item?.singername || '');
  if (!name) {
    const filename = String(item?.filename || '');
    const sep = filename.indexOf(' - ');
    if (sep > 0) {
      if (!singer) singer = decodeName(filename.slice(0, sep));
      name = decodeName(filename.slice(sep + 3));
    } else {
      name = decodeName(filename);
    }
  }
  // v3 接口 duration 单位为秒；v9 歌单页为毫秒
  const durationSec = (Number(item?.duration) || 0) / (opts.durationMs ? 1000 : 1);
  return {
    ...buildSimpleLxItem(
      'kg', songmid, name, singer,
      decodeName(item?.album_name || ''), item?.album_id ?? '',
      formatPlayTime(durationSec),
      buildKugouCoverUrl(item?.ori_img_url || item?.trans_param?.union_cover || item?.imgurl || null),
    ),
    hash: hash || undefined,
    types: hash ? [{ type: '128k', size: '', hash }] : [],
    _types: hash ? { '128k': { size: '', hash } } : {},
  };
}

async function kgSheetTracksV9(playlistId: string): Promise<LxSearchResultItem[]> {
  // 注意：该域名的 HTTPS 证书 CN 不匹配（reqwest 严格校验会失败），走明文 http
  const html = await httpGetText(
    `http://www2.kugou.kugou.com/yueku/v9/special/single/${encodeURIComponent(playlistId)}-5-9999.html`,
    KG_V3_HEADERS,
  );
  const match = html.match(/global\.data\s*=\s*(\[[\s\S]+]);/);
  if (!match) throw new Error('v9 页面未找到 global.data');
  const arr = JSON.parse(match[1]) as any[];
  if (!Array.isArray(arr)) throw new Error('v9 页面 global.data 不是数组');
  const list = arr
    .map((item) => kgItemToLx(item, { durationMs: true }))
    .filter((item): item is LxSearchResultItem => item !== null);
  if (!list.length) throw new Error('v9 页面歌曲列表为空');
  return list;
}

async function lxGetAlbumSongsBuiltin(
  source: LxSourceId,
  albumRawData: any,
  page = 1,
  limit = 30,
): Promise<LxSearchResultItem[]> {
  const albumId = String(albumRawData?.id ?? '');
  const albumName = String(albumRawData?.name ?? '');

  if (!isValidAlbumId(source, albumId)) {
    console.warn(`[LxMusicSdk] lxGetAlbumSongs: invalid albumId "${albumId}" for source ${source}, falling back to search`);
    return [];
  }

  try {
    switch (source) {
      case 'kw':
        return await kwAlbumAllSongs(albumId, albumName);
      case 'kg':
        return await kgAlbumAllSongs(albumId);
      case 'tx': {
        // 主路径：GetAlbumSongList 按 999/页翻页取全（QQ 插件专辑同款逻辑）
        try {
          return await txAlbumAllSongs(albumId);
        } catch (e: any) {
          console.warn(`[LxMusicSdk] TX album ${albumId}: 全量翻页失败(${e?.message || e})，回退单页接口`);
        }
        // 兜底：原单页请求
        const requestData = {
          comm: { ct: '24', cv: '0' },
          req: {
            module: 'music.musichallAlbum.AlbumSongList',
            method: 'GetAlbumSongList',
            param: { albumMid: albumId, albumID: 0, begin: (page - 1) * limit, num: limit, order: 2 },
          },
        };
        const sign = await zzcSign(JSON.stringify(requestData));
        const resp = await httpPostJson(
          `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
          JSON.stringify(requestData),
          { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; EBG-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.5304.141 Mobile Safari/537.36', 'Content-Type': 'application/json', 'Referer': 'https://y.qq.com/' },
        );
        const songList: any[] = resp?.req?.data?.songList || [];
        if (songList.length === 0) console.warn(`[LxMusicSdk] TX album ${albumId}: empty songList`);
        return txHandleResult(songList.map((s: any) => s.songInfo || s));
      }
      case 'wy': {
        const url = `https://music.163.com/api/album/${albumId}`;
        const data = await httpGetJson(url, {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com', Cookie: 'MUSIC_A=1',
        });
        const songs: any[] = data?.songs || [];
        if (songs.length === 0) console.warn(`[LxMusicSdk] WY album ${albumId}: empty songs`);
        return songs.map((song: any) => {
          const al = song.album || {};
          const ar = song.artists || [];
          return buildSimpleLxItem(
            'wy', String(song.id), song.name || '',
            ar.map((s: any) => s.name).join('、'),
            al.name || albumName, al.id || albumId,
            formatPlayTime((song.duration || 0) / 1000),
            al.picUrl || null,
          );
        });
      }
      case 'mg':
        return await mgAlbumAllSongs(albumId, albumName);
    }
  } catch (e) {
    console.warn(`[LxMusicSdk] lxGetAlbumSongs failed for source ${source}, albumId ${albumId}:`, e);
    return [];
  }
  return [];
}

async function txSheetTracksWebFallback(
  playlistId: string,
  page: number,
  limit: number,
): Promise<LxSearchResultItem[]> {
  const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${encodeURIComponent(playlistId)}&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=jq&needNewCode=0`;
  const result = await httpGetJson(url, {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://y.qq.com/',
  });
  const cdlist: any[] = result?.data?.cdlist || [];
  const first: any = cdlist[0] || {};
  const songAll: any[] = first.songlist || [];
  const start = (page - 1) * limit;
  const songlist = songAll.slice(start, start + limit);
  if (songlist.length === 0) console.warn(`[LxMusicSdk] TX playlist web fallback ${playlistId}: empty songlist`);
  return txHandleResult(songlist);
}

// ==================== 歌单全量加载（移植 QQ/酷我插件加载逻辑） ====================

// TX 歌单：qzone 接口单次返回完整 songlist（QQ 插件 importMusicSheet 同款，大歌单可完整加载）
async function txSheetTracksFullFetch(playlistId: string): Promise<LxSearchResultItem[]> {
  const url = `https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&utf8=1&disstid=${encodeURIComponent(playlistId)}&loginUin=0&format=json`;
  const text = await httpGetText(url, {
    Referer: 'https://y.qq.com/n/yqq/playlist',
    Cookie: 'uin=0',
  });
  const result = JSON.parse(text.replace(/callback\(|MusicJsonCallback\(|jsonCallback\(|\)$/g, ''));
  const cdlist: any[] = result?.cdlist || result?.data?.cdlist || [];
  const songAll: any[] = cdlist[0]?.songlist || [];
  if (!songAll.length) throw new Error('empty songlist');
  return txHandleResult(songAll);
}

// ==================== KW 歌单整单分页（移植酷我插件 pl3_getlist 导入逻辑） ====================

const KW_SHEET_PAGE_SIZE = 80;
const KW_SHEET_MAX_PAGES = 200;

async function kwSheetPageNewApi(playlistId: string, pn: number, rn: number): Promise<any> {
  const rand = () => Math.floor(Math.random() * 100000000);
  const data = await httpGetJson(
    `http://nplserver.kuwo.cn/pl.svc?op=pl3_getlist&pid=${playlistId}&pn=${pn}&rn=${rn}` +
    `&encode=utf-8&plat=pc&corp=kuwo&uid=${rand()}&sid=${rand()}&devid=${rand()}` +
    `&prod=MUSIC_9.6.0.0_W1&ttime=${Math.floor(Date.now() / 1000)}` +
    `&sig=${Math.floor(Math.random() * 2000000000)}&source=kwmusic_web_1.exe`,
    { Referer: 'https://www.kuwo.cn/' },
  );
  if (!data || data.errcode !== 0 || !Array.isArray(data?.info?.musiclist)) {
    throw new Error(`pl3_getlist errcode=${data?.errcode}`);
  }
  return data;
}

async function kwSheetPageOldApi(playlistId: string, pn: number, rn: number): Promise<any> {
  const data = await httpGetJson(
    `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${playlistId}&pn=${pn}&rn=${rn}` +
    `&encode=utf8&keyset=pl2012&vipver=MUSIC_9.1.1.2_BCS2&newver=1`,
    { Referer: 'https://www.kuwo.cn/' },
  );
  if (!data || data.result !== 'ok' || !Array.isArray(data?.musiclist)) {
    throw new Error(`getlistinfo result=${data?.result}`);
  }
  return data;
}

function kwSheetItemToLx(m: any): LxSearchResultItem {
  const albumpic = typeof m.albumpic === 'string' ? m.albumpic.replace('/120/', '/500/') : '';
  return buildSimpleLxItem(
    'kw', String(m.id ?? '').replace(/^MUSIC_/i, ''), m.name || '', m.artist || '',
    m.album || m.albummName || '', m.albumid || '',
    formatPlayTime(parseInt(m.duration) || 0), albumpic || m.pic || null,
  );
}

// 整单分页取全：新接口 pl3_getlist 任意一页失败时整单回退老接口重取（与酷我插件导入逻辑一致）
async function kwSheetAllTracks(playlistId: string): Promise<LxSearchResultItem[]> {
  for (const useNewApi of [true, false]) {
    const musicList: LxSearchResultItem[] = [];
    const pageSignatures = new Set<string>();
    let page = 1;
    let totalPage = Infinity;
    let failed = false;
    while (page <= totalPage) {
      if (page > KW_SHEET_MAX_PAGES) throw new Error('酷我歌单分页超出合理范围，请重试');
      try {
        const data = useNewApi
          ? await kwSheetPageNewApi(playlistId, page - 1, KW_SHEET_PAGE_SIZE)
          : await kwSheetPageOldApi(playlistId, page - 1, KW_SHEET_PAGE_SIZE);
        const body = useNewApi ? data.info : data;
        const songs: any[] = body.musiclist;
        const total = Number(body.total);
        totalPage = Number.isFinite(total) && total >= 0 ? Math.ceil(total / KW_SHEET_PAGE_SIZE) : Infinity;
        const signature = JSON.stringify(songs.map((s: any) => s.id ?? s.musicrid));
        if (songs.length && pageSignatures.has(signature)) throw new Error('酷我歌单分页重复，请重试');
        pageSignatures.add(signature);
        if (!songs.length && totalPage !== Infinity && page <= totalPage) {
          throw new Error('酷我歌单分页提前结束，请重试');
        }
        if (totalPage === Infinity && songs.length < KW_SHEET_PAGE_SIZE) totalPage = page;
        musicList.push(...songs.map(kwSheetItemToLx));
      } catch (e) {
        if (!useNewApi) throw e;
        failed = true;
        break;
      }
      // 翻页间隔，降低上游风控阈值触发概率（与酷我插件一致）
      await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 100));
      ++page;
    }
    if (!failed) {
      if (musicList.length === 0) console.warn(`[LxMusicSdk] KW playlist ${playlistId}: empty musicList`);
      return musicList;
    }
  }
  return [];
}

export async function lxGetPlaylistTracks(
  source: LxSourceId,
  playlistRawData: any,
  page = 1,
  limit = 100,
): Promise<{ list: LxSearchResultItem[]; isEnd: boolean }> {
  const playlistId = String(
    firstValue(playlistRawData, ['id', 'ID', 'playlistId', 'playlistid', 'specialid', 'dissid', 'disstid', 'songListId', 'songlistId', 'musicListId', 'rid']) ?? ''
  );

  if (!playlistId) {
    console.warn(`[LxMusicSdk] lxGetPlaylistTracks: empty playlistId for source ${source}`);
    return { list: [], isEnd: true };
  }

  try {
    switch (source) {
      case 'kw': {
        // 整单分页取全（酷我插件 pl3_getlist 逻辑）；首页直接返回全量，
        // page>1 走全量切片（仅遗留安全路径会触达）
        const all = await kwSheetAllTracks(playlistId);
        if (page === 1) return { list: all, isEnd: true };
        const start = (page - 1) * limit;
        const slice = all.slice(start, start + limit);
        return { list: slice, isEnd: start + slice.length >= all.length };
      }
      case 'kg': {
        // 主路径：v9 歌单页单次全量（对齐 Rust kg 歌单导入），失败回退 v3 分页
        try {
          const all = await kgSheetTracksV9(playlistId);
          if (page === 1) return { list: all, isEnd: true };
          const start = (page - 1) * limit;
          const slice = all.slice(start, start + limit);
          return { list: slice, isEnd: start + slice.length >= all.length };
        } catch (e: any) {
          console.warn(`[LxMusicSdk] KG playlist ${playlistId}: v9 页面全量失败(${e?.message || e})，回退 v3 分页`);
        }
        const url = `http://mobilecdn.kugou.com/api/v3/song/special/getSongList?specialid=${playlistId}&page=${page}&pagesize=${limit}`;
        const data = await httpGetJson(url, KG_V3_HEADERS);
        const infoList: any[] = data?.data?.info || [];
        if (infoList.length === 0) console.warn(`[LxMusicSdk] KG playlist ${playlistId}: empty info list`);
        const list = infoList
          .map((item: any) => kgItemToLx(item))
          .filter((item): item is LxSearchResultItem => item !== null);
        // 优先按上游 total 判定结尾，避免单页上限小于请求 pagesize 时提前截断
        const total = Number(data?.data?.total);
        const isEnd = Number.isFinite(total) && total > 0
          ? (page - 1) * limit + list.length >= total
          : list.length < limit;
        return { list, isEnd };
      }
      case 'tx': {
        // 主路径：qzone 接口单次全量返回（QQ 插件导入同款，大歌单可完整加载）
        try {
          const all = await txSheetTracksFullFetch(playlistId);
          if (page === 1) return { list: all, isEnd: true };
          const start = (page - 1) * limit;
          const slice = all.slice(start, start + limit);
          return { list: slice, isEnd: start + slice.length >= all.length };
        } catch (e: any) {
          console.warn(`[LxMusicSdk] TX playlist ${playlistId}: qzone 全量接口异常(${e?.message || e})，回退 Mobile 分页`);
        }
        const requestData = {
          comm: { ct: '24', cv: '0' },
          req: {
            module: 'music.srfDissInfo.aiDissInfo',
            method: 'uniform_get_Dissinfo',
            param: {
              disstid: playlistId,
              song_num: limit,
              song_begin: (page - 1) * limit,
              userinfo: 0, tag: 1, is_pull_album_info: 1,
            },
          },
        };
        const fallback = async (reason: string) => {
          console.warn(`[LxMusicSdk] TX playlist ${playlistId}: ${reason}，尝试 Web 兜底`);
          const list = await txSheetTracksWebFallback(playlistId, page, limit);
          return { list, isEnd: list.length < limit };
        };
        let resp: any;
        try {
          const sign = await zzcSign(JSON.stringify(requestData));
          resp = await httpPostJson(
            `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
            JSON.stringify(requestData),
            { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; EBG-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.5304.141 Mobile Safari/537.36', 'Content-Type': 'application/json', 'Referer': 'https://y.qq.com/' },
          );
        } catch (e: any) {
          return fallback(`Mobile 接口异常(${e?.message || e})`);
        }
        const songlist: any[] = resp?.req?.data?.songlist || [];
        if (songlist.length === 0) return fallback('empty songlist');
        const list = txHandleResult(songlist);
        return { list, isEnd: list.length < limit };
      }
      case 'wy': {
        const offset = (page - 1) * limit;
        const url = `https://music.163.com/api/v6/playlist/detail?id=${playlistId}&n=${limit}&offset=${offset}`;
        const data = await httpGetJson(url, {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://music.163.com', Cookie: 'MUSIC_A=1',
        });
        const tracks: any[] = data?.playlist?.tracks || [];
        if (tracks.length === 0) console.warn(`[LxMusicSdk] WY playlist ${playlistId}: empty tracks`);
        const list = tracks.map((song: any) => {
          const al = song.album || song.al || {};
          const ar = song.artists || song.ar || [];
          return buildSimpleLxItem(
            'wy', String(song.id), song.name || '',
            ar.map((s: any) => s.name).join('、'),
            al.name || '', al.id || '',
            formatPlayTime((song.duration || song.dt || 0) / 1000),
            al.picUrl || null,
          );
        });
        return { list, isEnd: list.length < limit };
      }
      case 'mg': {
        // 该接口单页上限较小，压低 pageSize 保证能完整翻页
        const mgPageSize = Math.min(limit, 30);
        const url = `https://m.music.migu.cn/migu/remoting/playlist_callback?playlistId=${playlistId}&pageNo=${page}&pageSize=${mgPageSize}`;
        const data = await httpGetJson(url);
        const rawList: any[] = data?.list || data?.resultList || [];
        if (rawList.length === 0) console.warn(`[LxMusicSdk] MG playlist ${playlistId}: empty list`);
        const list = rawList.map((item: any) => buildSimpleLxItem(
          'mg', String(item.songId || item.id), item.name || item.songName || '',
          formatSingerName(item.singerList || item.singers),
          item.album || item.albumName || '', item.albumId || '',
          formatPlayTime(item.duration || 0), item.img3 || item.img2 || item.img1 || null,
          { copyrightId: item.copyrightId },
        ));
        return { list, isEnd: list.length < mgPageSize };
      }
    }
  } catch (e) {
    console.warn(`[LxMusicSdk] lxGetPlaylistTracks failed for source ${source}, playlistId ${playlistId}:`, e);
    return { list: [], isEnd: true };
  }
  return { list: [], isEnd: true };
}