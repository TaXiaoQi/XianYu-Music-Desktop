/**
 * LX 协议 SDK · 专辑/歌单曲目获取。
 *
 * 按源调用专辑歌曲列表与歌单曲目接口，把各平台原始响应统一映射为
 * LxSearchResultItem（简化项：不返回音质信息，播放时由 lxUrlResolver 统一解析）。
 * TX 源走签名(Mobile)接口，被风控/降级时回退到经典 Web 兜底。
 */
import {
  firstValue,
  formatPlayTime,
  httpGetJson,
  httpPostJson,
  zzcSign,
  type LxSearchResultItem,
} from './lxMusicSdkBase';
import {
  kgFilterData,
  txHandleResult,
} from './lxSearchPlatform';
import { decodeName, formatSingerName } from '../../utils/musicFormat';
import { dispatchFallbackModule } from '../fallbackModules/registry';
import type { LxSourceId } from './lxMusicSdkTypes';

/**
 * 从简化数据构造 LxSearchResultItem（用于专辑/歌单接口返回数据，
 * 这些接口通常不返回音质类型信息，types 留空，播放时由 lxUrlResolver 统一解析）
 */
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

/**
 * 检测 albumId 是否为有效的专辑 ID（而非回退的专辑名称）。
 * deriveLxAlbumResults 在 albumId/albumMid 均为空时回退到专辑名，
 * 此时直接调 API 会失败，需由调用方走搜索回退。
 */
function isValidAlbumId(source: LxSourceId, albumId: string): boolean {
  if (!albumId) return false;
  // 专辑名通常含中文/空格/标点，且非纯数字/字母
  // TX 的 mid 格式为字母+数字组合（如 "001abc..."），其余源为纯数字
  if (source === 'tx') {
    // TX albumMid: 字母数字组合，通常以 "00" 开头
    return /^[A-Za-z0-9]{6,}$/.test(albumId);
  }
  // kw/kg/wy/mg: 纯数字 ID
  return /^\d+$/.test(albumId);
}

/**
 * 获取落雪音源专辑歌曲列表
 * @param albumRawData 来自 deriveLxAlbumResults 的 rawData: { source, id, name, artist }
 * @returns 歌曲列表；若 albumId 无效或 API 失败则返回空数组（由调用方走搜索回退）
 */
export async function lxGetAlbumSongs(
  source: LxSourceId,
  albumRawData: any,
  page = 1,
  limit = 30,
): Promise<LxSearchResultItem[]> {
  return dispatchFallbackModule('lx_album', 'getAlbumSongs', { source, albumRawData, page, limit },
    () => lxGetAlbumSongsBuiltin(source, albumRawData, page, limit));
}

async function lxGetAlbumSongsBuiltin(
  source: LxSourceId,
  albumRawData: any,
  page = 1,
  limit = 30,
): Promise<LxSearchResultItem[]> {
  const albumId = String(albumRawData?.id ?? '');
  const albumName = String(albumRawData?.name ?? '');

  // albumId 无效（可能是专辑名回退），直接返回空触发搜索回退
  if (!isValidAlbumId(source, albumId)) {
    console.warn(`[LxMusicSdk] lxGetAlbumSongs: invalid albumId "${albumId}" for source ${source}, falling back to search`);
    return [];
  }

  try {
    switch (source) {
      case 'kw': {
        const url = `http://www.kuwo.cn/api/www/album/albumInfo?albumid=${albumId}&pn=${page}&rn=${limit}`;
        const data = await httpGetJson(url, {
          csrf: 'ABCDEF',
          Cookie: 'kw_token=ABCDEF',
          Referer: 'http://www.kuwo.cn/',
        });
        const musicList: any[] = data?.data?.musicList || [];
        if (musicList.length === 0) console.warn(`[LxMusicSdk] KW album ${albumId}: empty musicList`);
        return musicList.map((m: any) => buildSimpleLxItem(
          'kw', String(m.rid || m.id), m.name || '', m.artist || '',
          m.album || albumName, m.albumid || albumId,
          formatPlayTime(parseInt(m.duration) || 0), m.pic || null,
        ));
      }
      case 'kg': {
        const url = `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${albumId}&page=${page}&pagesize=${limit}`;
        const data = await httpGetJson(url);
        const infoList: any[] = data?.data?.info || [];
        if (infoList.length === 0) console.warn(`[LxMusicSdk] KG album ${albumId}: empty info list`);
        return infoList.map((item: any) => kgFilterData(item));
      }
      case 'tx': {
        // 模块必须用 music.musichallAlbum.AlbumSongList（PlaySingerSongs 是歌手歌曲接口，
        // 组合 GetAlbumSongList 会返回 500003）。已实测该签名请求稳定可用。
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
        // songList 每项可能包在 songInfo 里
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
      case 'mg': {
        const url = `https://m.music.migu.cn/migu/remoting/cms_album_song_list_tag?albumId=${albumId}&pageNo=${page}&pageSize=${limit}`;
        const data = await httpGetJson(url);
        const list: any[] = data?.resultList || data?.list || [];
        if (list.length === 0) console.warn(`[LxMusicSdk] MG album ${albumId}: empty list`);
        return list.map((item: any) => buildSimpleLxItem(
          'mg', String(item.songId || item.id), item.name || item.songName || '',
          formatSingerName(item.singerList || item.singers),
          item.album || item.albumName || albumName, item.albumId || albumId,
          formatPlayTime(item.duration || 0), item.img3 || item.img2 || item.img1 || null,
          { copyrightId: item.copyrightId },
        ));
      }
    }
  } catch (e) {
    console.warn(`[LxMusicSdk] lxGetAlbumSongs failed for source ${source}, albumId ${albumId}:`, e);
    return [];
  }
  return [];
}

/**
 * 经典 Web 歌单详情兜底：不依赖新签名(musics.fcg)风控体系。
 * Mobile 歌单详情被风控/降级返回空时使用，避免小秋/QQ 歌单页空白。
 */
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

/**
 * 获取落雪音源歌单曲目列表
 * @param playlistRawData 来自 normalizeLxPlaylistResults 的 rawData（原始 API 响应项）
 */
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
        const url = `http://www.kuwo.cn/api/www/playlist/playListInfo?pid=${playlistId}&pn=${page}&rn=${limit}`;
        const data = await httpGetJson(url, {
          csrf: 'ABCDEF',
          Cookie: 'kw_token=ABCDEF',
          Referer: 'http://www.kuwo.cn/',
        });
        const musicList: any[] = data?.data?.musicList || [];
        if (musicList.length === 0) console.warn(`[LxMusicSdk] KW playlist ${playlistId}: empty musicList`);
        const list = musicList.map((m: any) => buildSimpleLxItem(
          'kw', String(m.rid || m.id), m.name || '', m.artist || '',
          m.album || '', m.albumid || '',
          formatPlayTime(parseInt(m.duration) || 0), m.pic || null,
        ));
        return { list, isEnd: list.length < limit };
      }
      case 'kg': {
        const url = `http://mobilecdn.kugou.com/api/v3/song/special/getSongList?specialid=${playlistId}&page=${page}&pagesize=${limit}`;
        const data = await httpGetJson(url);
        const infoList: any[] = data?.data?.info || [];
        if (infoList.length === 0) console.warn(`[LxMusicSdk] KG playlist ${playlistId}: empty info list`);
        const list = infoList.map((item: any) => kgFilterData(item));
        return { list, isEnd: list.length < limit };
      }
      case 'tx': {
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
        // 该接口与 searchTx 同属新签名(Mobile)风控体系：被风控(reqCode 2001)或降级时返回空 songlist，
        // 无结果时走经典 Web 接口兜底（不依赖这套风控），否则用户在歌单页一直空白。
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
        const url = `https://m.music.migu.cn/migu/remoting/playlist_callback?playlistId=${playlistId}&pageNo=${page}&pageSize=${limit}`;
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
        return { list, isEnd: list.length < limit };
      }
    }
  } catch (e) {
    console.warn(`[LxMusicSdk] lxGetPlaylistTracks failed for source ${source}, playlistId ${playlistId}:`, e);
    return { list: [], isEnd: true };
  }
  return { list: [], isEnd: true };
}