/**
 * LX 协议 SDK · 目录搜索（歌手/专辑/歌单）。
 *
 * 跨模块编排：genres/artist/album 由搜索结果派生（derive*），歌单走各源原生歌单接口，
 * 命中源缺封面字段时调用封面模块补齐。搜索实现在 lxMusicSdkSearch，封面补获在
 * lxMusicSdkCover，本模块仅做组合与协调，并保持原有 public 导出面。
 */
import { firstValue, httpGetJson, httpGetLooseJson, httpPostJson, zzcSign } from './lxMusicSdkBase';
import type { LxSearchResultItem } from './lxMusicSdkBase';
import { mgCreateSignature, txSheetSearchDesktopFallback } from './lxSearchPlatform';
import { decodeName } from '../../utils/musicFormat';
import { lxSearch } from './lxMusicSdkSearch';
import {
  fillKwArtistAvatars,
  fillWyArtistAvatars,
  fillKwAlbumCovers,
  fillWyAlbumCovers,
} from './lxMusicSdkCover';
import type { LxSourceId, LxAlbumSearchResult, LxArtistSearchResult, LxPlaylistSearchResult } from './lxMusicSdkTypes';

function splitLxArtists(value: string): string[] {
  return value
    .split(/[、,/&]/)
    .map(name => name.trim())
    .filter(Boolean);
}

export function deriveLxArtistResults(list: LxSearchResultItem[]): LxArtistSearchResult[] {
  const artists = new Map<string, LxArtistSearchResult>();

  for (const song of list) {
    for (const name of splitLxArtists(song.singer)) {
      const key = name.toLocaleLowerCase();
      // 优先使用歌手头像（singerAvatars），其次回退到歌曲封面（song.img）
      const singerAvatar = song.singerAvatars?.[name];
      const avatarUrl = singerAvatar || song.img || '';
      const existing = artists.get(key);
      if (existing) {
        existing.songCount = (existing.songCount ?? 0) + 1;
        if (!existing.avatarUrl && avatarUrl) existing.avatarUrl = avatarUrl;
        continue;
      }
      artists.set(key, {
        id: `${song.source}:artist:${name}`,
        name,
        avatarUrl,
        songCount: 1,
        // 保存 source/songmid/artistId 供 lxCatalogSearch 异步补充头像
        // （kw 源无图片字段用 songmid；wy 源 img1v1Url 是占位头像，用 artistId 调艺人接口）
        rawData: {
          source: song.source,
          name,
          songmid: song.songmid,
          artistId: song.singerIds?.[name] ?? '',
        },
      });
    }
  }

  return [...artists.values()];
}

export function deriveLxAlbumResults(list: LxSearchResultItem[]): LxAlbumSearchResult[] {
  const albums = new Map<string, LxAlbumSearchResult>();

  for (const song of list) {
    const name = song.albumName?.trim();
    if (!name) continue;
    const id = String(song.albumId || song.albumMid || name);
    const key = `${song.source}:${id}`;
    const existing = albums.get(key);
    if (existing) {
      existing.songCount = (existing.songCount ?? 0) + 1;
      if (!existing.coverUrl && song.img) existing.coverUrl = song.img;
      continue;
    }
    albums.set(key, {
      id: `${song.source}:album:${id}`,
      name,
      artist: song.singer,
      coverUrl: song.img || '',
      songCount: 1,
      rawData: { source: song.source, id, name, artist: song.singer, songmid: song.songmid },
    });
  }

  return [...albums.values()];
}

export function normalizeLxPlaylistResults(source: LxSourceId, rawItems: any[]): LxPlaylistSearchResult[] {
  const results: LxPlaylistSearchResult[] = [];
  const seen = new Set<string>();

  for (const raw of rawItems.flat(2)) {
    if (!raw || typeof raw !== 'object') continue;
    const idValue = firstValue(raw, ['id', 'ID', 'playlistId', 'playlistid', 'specialid', 'dissid', 'disstid', 'songListId', 'songlistId', 'musicListId', 'rid']);
    const titleValue = firstValue(raw, ['title', 'name', 'playlistName', 'specialname', 'dissname', 'songListName', 'songlistName', 'NAME']);
    if (idValue === undefined || !titleValue) continue;
    const id = String(idValue);
    const dedupeKey = `${source}:${id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const creator = raw.creator;
    let coverUrl = String(firstValue(raw, ['coverUrl', 'coverImgUrl', 'img', 'imgurl', 'pic', 'picUrl', 'pic_url', 'PIC', 'album_pic_url', 'hts_pic']) || '');
    if (coverUrl.startsWith('//')) coverUrl = `https:${coverUrl}`;
    else if (coverUrl.startsWith('http://')) coverUrl = coverUrl.replace('http://', 'https://');
    results.push({
      id: `${source}:playlist:${id}`,
      title: decodeName(String(titleValue).replace(/<[^>]*>/g, '')),
      coverUrl,
      artist: String(firstValue(raw, ['artist', 'author', 'nickname', 'uname', 'UNAME']) || creator?.name || creator?.nickname || ''),
      trackCount: Number(firstValue(raw, ['trackCount', 'trackcount', 'songCount', 'song_count', 'songnum', 'SONGNUM'])) || undefined,
      playCount: Number(firstValue(raw, ['playCount', 'playcount', 'play_count', 'playcnt', 'listennum', 'LISTENNUM'])) || undefined,
      rawData: raw,
    });
  }

  return results;
}

async function searchLxPlaylists(source: LxSourceId, keyword: string, page: number, limit: number): Promise<LxPlaylistSearchResult[]> {
  if (source === 'kw') {
    // 优先用新 API，回退到旧 API
    try {
      const data = await httpGetJson(`https://www.kuwo.cn/api/www/search/searchPlayListBykeyWord?key=${encodeURIComponent(keyword)}&pn=${page}&rn=${limit}`, {
        csrf: 'ABCDEF',
        Cookie: 'kw_token=ABCDEF',
        Referer: 'https://www.kuwo.cn/',
      });
      const list = data?.data?.list || data?.data || [];
      if (Array.isArray(list) && list.length > 0) {
        return normalizeLxPlaylistResults(source, list);
      }
    } catch { /* 回退到旧 API */ }
    // 旧 r.s 接口返回单引号 JSON（httpGetLooseJson 兼容），字段为
    // playlistid/name/nickname/hts_pic|pic/songnum/playcnt
    const data = await httpGetLooseJson(`https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&ft=playlist&encoding=utf8&rformat=json`, {
      Referer: 'https://www.kuwo.cn/',
    });
    return normalizeLxPlaylistResults(source, data?.abslist || data?.data || []);
  }

  if (source === 'kg') {
    const data = await httpGetJson(`https://songsearch.kugou.com/special_search?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&userid=-1&clientver=&platform=WebFilter&filter=0&iscorrection=1&privilege_filter=0`);
    return normalizeLxPlaylistResults(source, data?.data?.lists || data?.data?.list || []);
  }

  if (source === 'wy') {
    const offset = limit * (page - 1);
    const data = await httpGetJson(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1000&offset=${offset}&limit=${limit}`, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://music.163.com',
      Cookie: 'MUSIC_A=1',
    });
    return normalizeLxPlaylistResults(source, data?.result?.playlists || []);
  }

  if (source === 'tx') {
    const requestData = {
      comm: { ct: '24', cv: '4747474', v: '4747474', tmeAppID: 'qqmusic', format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', platform: 'yqq.json', needNewCode: 0, uin: '0', guid: '0' },
      req: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicMobile',
        param: {
          search_type: 3,
          searchid: Math.random().toString().slice(2),
          query: keyword,
          page_num: page,
          num_per_page: limit,
          highlight: 0,
          nqc_flag: 0,
          multi_zhida: 0,
          cat: 2,
          grp: 1,
          sin: 0,
          sem: 0,
        },
      },
    };
    // 该接口与 searchTx 同属新签名(Mobile)风控体系，被风控/降级时 body 为空，
    // 走无签名 Desktop 通道兜底（txSheetSearchDesktopFallback，实测稳定可用）
    let list: any[];
    try {
      const sign = await zzcSign(JSON.stringify(requestData));
      const data = await httpPostJson(
        `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`,
        JSON.stringify(requestData),
        { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; EBG-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.5304.141 Mobile Safari/537.36', 'Content-Type': 'application/json', 'Referer': 'https://y.qq.com/' },
      );
      const body = data?.req?.data?.body;
      list = body?.item_songlist || body?.songlist?.list || [];
    } catch (e: any) {
      console.warn(`[LxMusicSdk] TX 歌单搜索接口异常，尝试 Desktop 兜底: ${e?.message || e}`);
      list = [];
    }
    if (!Array.isArray(list) || list.length === 0) {
      console.warn('[LxMusicSdk] TX 歌单搜索 Mobile 为空，尝试 Desktop 兜底');
      list = await txSheetSearchDesktopFallback(keyword, page, limit);
    }
    return normalizeLxPlaylistResults(source, list);
  }

  const time = Date.now().toString();
  const signData = await mgCreateSignature(time, keyword);
  const searchSwitch = encodeURIComponent(JSON.stringify({
    song: 0,
    album: 0,
    singer: 0,
    tagSong: 0,
    mvSong: 0,
    bestShow: 0,
    songlist: 1,
    lyricSong: 0,
  }));
  const data = await httpGetJson(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=${limit}&text=${encodeURIComponent(keyword)}&pageNo=${page}&sort=0&sid=USS`, {
    uiVersion: 'A_music_3.6.1',
    deviceId: signData.deviceId,
    timestamp: time,
    sign: signData.sign,
    channel: '0146921',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
  });
  const resultData = data?.songListResultData || data?.songlistResultData || {};
  return normalizeLxPlaylistResults(source, resultData.resultList || resultData.list || []);
}

export async function lxCatalogSearch(
  source: LxSourceId,
  keyword: string,
  type: 'artist' | 'album' | 'playlist',
  page = 1,
  limit = 30,
): Promise<LxArtistSearchResult[] | LxAlbumSearchResult[] | LxPlaylistSearchResult[]> {
  if (type === 'playlist') return searchLxPlaylists(source, keyword, page, limit);
  const result = await lxSearch(source, keyword, page, limit);
  if (type !== 'artist') {
    const albums = deriveLxAlbumResults(result.list);
    // kw/wy 源搜索结果无可靠封面对应字段（kw 无图片字段、wy 只有超大整数 picId），异步补专辑封面
    if (source === 'kw') {
      await fillKwAlbumCovers(albums as LxAlbumSearchResult[]);
    } else if (source === 'wy') {
      await fillWyAlbumCovers(albums as LxAlbumSearchResult[]);
    }
    return albums;
  }
  const artists = deriveLxArtistResults(result.list);
  // kw 源搜索结果无图片字段，用 songmid 调 artistpicserver 异步获取封面作为歌手头像；
  // wy 源搜索接口的 img1v1Url 是全局占位头像，需用 artistId 调艺人接口补真实头像
  if (source === 'kw') {
    await fillKwArtistAvatars(artists);
  } else if (source === 'wy') {
    await fillWyArtistAvatars(artists);
  }
  return artists;
}

// Re-export 类型，保持 lxMusicSdk 消费方单一入口
export type { LxSourceId, LxAlbumSearchResult, LxArtistSearchResult, LxPlaylistSearchResult } from './lxMusicSdkTypes';