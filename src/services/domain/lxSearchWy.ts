import { neteasePicIdToUrl } from '../../utils/coverUrl';
import {
  formatPlayTime,
  httpGetJson,
  type LxSearchResult,
  type LxSearchResultItem,
} from './lxMusicSdkBase';


// ==================== WY (网易云) Search ====================

export async function searchWy(str: string, page = 1, limit = 30, retryNum = 0): Promise<LxSearchResult> {
  if (++retryNum > 3) throw new Error('WY search: try max num');
  const offset = limit * (page - 1);
  const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(str)}&type=1&offset=${offset}&limit=${limit}`;
  const result = await httpGetJson(url, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
    'Referer': 'https://music.163.com',
    'Cookie': 'MUSIC_A=1',
  });
  if (!result || result.code !== 200) {
    console.warn('[LxMusicSdk] WY search failed, code:', result?.code, 'retrying...');
    return searchWy(str, page, limit, retryNum);
  }
  const rawSongs = result.result?.songs || [];
  const list = rawSongs.map((song: any) => {
    const types: LxSearchResultItem['types'] = [];
    const _types: LxSearchResultItem['_types'] = {};
    if (song.hq) { types.push({ type: '320k', size: null }); _types['320k'] = { size: null }; }
    if (song.sq) { types.push({ type: 'flac', size: null }); _types.flac = { size: null }; }
    types.push({ type: '128k', size: null }); _types['128k'] = { size: null };
    if (!song.hq) { types.push({ type: '320k', size: null }); _types['320k'] = { size: null }; }
    if (!song.sq) { types.push({ type: 'flac', size: null }); _types.flac = { size: null }; }
    types.push({ type: 'flac24bit', size: null }); _types.flac24bit = { size: null };
    types.push({ type: 'master', size: null }); _types.master = { size: null };
    types.reverse();
    const ar = song.artists || [];
    const al = song.album || {};
    const img =
      (al.picUrl && String(al.picUrl).replace(/^http:\/\//i, 'https://'))
      || neteasePicIdToUrl(al.picId_str || al.pic_str || al.picId || al.pic)
      || null;
    const singerAvatars: Record<string, string> = {};
    const singerIds: Record<string, string> = {};
    for (const s of ar) {
      if (s && s.name && s.img1v1Url) {
        singerAvatars[s.name] = s.img1v1Url;
      }
      if (s && s.name && s.id != null) {
        singerIds[s.name] = String(s.id);
      }
    }
    return {
      singer: ar.map((s: any) => s.name).join('、'),
      name: song.name,
      albumName: al.name || '',
      albumId: al.id || '',
      source: 'wy' as const,
      interval: formatPlayTime((song.duration || 0) / 1000),
      songmid: String(song.id),
      img,
      singerAvatars: Object.keys(singerAvatars).length > 0 ? singerAvatars : undefined,
      singerIds: Object.keys(singerIds).length > 0 ? singerIds : undefined,
      types,
      _types,
    };
  });
  const total = result.result?.songCount || 0;
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'wy',
  };
}