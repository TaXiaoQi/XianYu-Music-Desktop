import { httpFetch, httpGetJson, toUrlSongInfo } from './lxMusicSdkBase';
import type { LxSearchResultItem } from './lxMusicSdkBase';
import { normalizeKuwoCoverUrl } from '../../utils/coverUrl';
import { pluginApi } from '../tauri/pluginApi';
import type { LxAlbumSearchResult, LxArtistSearchResult } from './lxMusicSdkTypes';

export async function fillKwArtistAvatars(artists: LxArtistSearchResult[]): Promise<void> {
  const tasks = artists
    .filter(a => !a.avatarUrl && (a.rawData as any)?.songmid)
    .map(async a => {
      try {
        const songmid = (a.rawData as any).songmid as string;
        const resp = await httpFetch(
          `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${songmid}`,
          { method: 'GET' },
        );
        if (resp.status === 200 && /^http/.test(resp.body?.trim())) {
          const url = normalizeKuwoCoverUrl(resp.body.trim());
          if (url) a.avatarUrl = url;
        }
      } catch { /* 单个歌手获取失败不影响整体 */ }
    });
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
}

const WY_PLACEHOLDER_AVATAR = '6y-UleORITEDbvrOLV0Q8A==';

export async function fillWyArtistAvatars(artists: LxArtistSearchResult[]): Promise<void> {
  const targets = artists.filter(a => {
    const id = String((a.rawData as any)?.artistId ?? '');
    if (!/^\d+$/.test(id)) return false;
    return !a.avatarUrl || a.avatarUrl.includes(WY_PLACEHOLDER_AVATAR);
  });
  if (targets.length === 0) return;

  const CONCURRENCY = 3;
  let nextIdx = 0;

  const worker = async (): Promise<void> => {
    while (nextIdx < targets.length) {
      const a = targets[nextIdx++];
      const artistId = String((a.rawData as any).artistId);
      try {
        const resp = await httpGetJson(`https://music.163.com/api/artist/${encodeURIComponent(artistId)}?ext=true`, {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
          'Referer': 'https://music.163.com',
          'Cookie': 'MUSIC_A=1',
        });
        const avatar = resp?.artist?.picUrl || resp?.artist?.img1v1Url || '';
        if (avatar) {
          a.avatarUrl = String(avatar).replace(/^http:\/\//i, 'https://');
        }
      } catch { /* 单个歌手获取失败不影响整体 */ }
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker());
  await Promise.race([
    Promise.allSettled(workers),
    new Promise(resolve => setTimeout(resolve, 2500)),
  ]);
}

export async function fillKwAlbumCovers(albums: LxAlbumSearchResult[]): Promise<void> {
  const tasks = albums
    .filter(a => !a.coverUrl && (a.rawData as any)?.id)
    .map(async a => {
      const raw = a.rawData as any;
      try {
        try {
          const resp = await httpGetJson(`https://www.kuwo.cn/api/www/album/albumInfo?albumid=${encodeURIComponent(raw.id)}&httpsStatus=1`, {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Referer': 'https://www.kuwo.cn/',
          });
          const pic = resp?.data?.pic || resp?.data?.picS || resp?.data?.data?.pic || resp?.data?.data?.album?.pic;
          if (pic) {
            const url = normalizeKuwoCoverUrl(String(pic));
            if (url) {
              a.coverUrl = url;
              return;
            }
          }
        } catch { /* 专辑接口失败/为空，走歌曲封面兜底 */ }
        if (raw.songmid) {
          const presp = await httpFetch(
            `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${raw.songmid}`,
            { method: 'GET' },
          );
          if (presp.status === 200 && /^http/.test(presp.body?.trim())) {
            const url = normalizeKuwoCoverUrl(presp.body.trim());
            if (url) a.coverUrl = url;
          }
        }
      } catch { /* 单个专辑获取失败不影响整体 */ }
    });
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
}

export async function fillWyAlbumCovers(albums: LxAlbumSearchResult[]): Promise<void> {
  const targets = albums.filter(a =>
    !a.coverUrl && /^\d+$/.test(String((a.rawData as any)?.id ?? ''))
  );
  if (targets.length === 0) return;

  const worker = async (a: LxAlbumSearchResult): Promise<void> => {
    const raw = a.rawData as any;
    try {
      const cover = await pluginApi.getLxCover({
        songmid: String(raw.songmid || ''),
        source: 'wy',
        albumId: String(raw.id),
        name: raw.name,
        singer: raw.artist,
        albumName: raw.name,
      });
      if (cover) a.coverUrl = String(cover).replace(/^http:\/\//i, 'https://');
    } catch { /* 单个专辑获取失败不影响整体 */ }
  };

  await Promise.race([
    Promise.allSettled(targets.map(worker)),
    new Promise(resolve => setTimeout(resolve, 2500)),
  ]);
}

export async function lxGetPic(songInfo: LxSearchResultItem): Promise<string | null> {
  if (songInfo.img) return normalizeKuwoCoverUrl(songInfo.img) || songInfo.img;

  try {
    const result = await pluginApi.getLxCover(toUrlSongInfo(songInfo));
    return (result && String(result).replace(/^http:\/\//i, 'https://')) || null;
  } catch (e: any) {
    console.warn(`[LxMusicSdk] getLxCover failed: ${e?.message || e}`);
    return null;
  }
}