import {
  firstValue,
  formatPlayTime,
  httpFetch,
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
        const kwResp = await httpFetch(
          `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${playlistId}&pn=0&rn=1000` +
          `&encode=utf8&keyset=pl2012&vipver=MUSIC_9.1.1.2_BCS2&newver=1`,
          { method: 'GET', headers: { Referer: 'https://www.kuwo.cn/' } },
        );
        const kwBody = typeof kwResp.body === 'string' ? JSON.parse(kwResp.body) : kwResp.body;
        if (!kwBody || kwBody.result !== 'ok') {
          console.warn(`[LxMusicSdk] KW playlist ${playlistId}: nplserver returned ${kwBody?.result}`);
          return { list: [], isEnd: true };
        }
        const musiclist: any[] = kwBody.musiclist || [];
        if (musiclist.length === 0) console.warn(`[LxMusicSdk] KW playlist ${playlistId}: empty musicList`);
        const list = musiclist.map((m: any) => {
          const rid = String(m.id ?? '').replace(/^MUSIC_/i, '');
          return buildSimpleLxItem(
            'kw', rid, m.name || '', m.artist || '',
            m.album || m.albummName || '', m.albumid || '',
            formatPlayTime(parseInt(m.duration) || 0), m.albumpic || m.pic || null,
          );
        });
        return { list, isEnd: true };
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