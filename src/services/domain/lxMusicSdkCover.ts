/**
 * LX 协议 SDK · 封面与歌手头像补充。
 *
 * 部分源的搜索结果缺少可用封面字段：kw 无图片字段、wy 只有全局占位头像/超大整数
 * picId。本模块对这些缺失异步补齐（并行 + 超时兜底，不阻塞搜索过久）。
 */
import { httpFetch, httpGetJson, toUrlSongInfo } from './lxMusicSdkBase';
import type { LxSearchResultItem } from './lxMusicSdkBase';
import { normalizeKuwoCoverUrl } from '../../utils/coverUrl';
import { pluginApi } from '../tauri/pluginApi';
import type { LxAlbumSearchResult, LxArtistSearchResult } from './lxMusicSdkTypes';

/**
 * 酷我搜索结果无任何图片字段，用 songmid 调 artistpicserver 获取歌曲封面作为歌手头像。
 * 并行请求所有缺失头像的歌手，最多等待 3 秒避免阻塞搜索过久。
 */
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

/**
 * 网易云搜索接口 artists[].img1v1Url 实为全局统一的默认占位头像
 * （所有歌手返回同一个 6y-UleORITEDbvrOLV0Q8A== URL），不是真实头像。
 * 用 artistId 调艺人详情接口（/api/artist/{id}）拿真实 artist.picUrl。
 * 小并发（3）打接口，只阻塞 2.5 秒，其余后台继续补获
 * （Search.vue 的封面轮询会把迟到的头像刷进视图）。
 */
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

/**
 * 酷我搜索结果无图片字段，用专辑信息接口补专辑封面；
 * 专辑接口失败/为空时用歌曲封面(artistpicserver)兜底。最多等待 3 秒。
 */
export async function fillKwAlbumCovers(albums: LxAlbumSearchResult[]): Promise<void> {
  const tasks = albums
    .filter(a => !a.coverUrl && (a.rawData as any)?.id)
    .map(async a => {
      const raw = a.rawData as any;
      try {
        // 1) 酷我专辑信息接口取专辑封面
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
        // 2) 兜底：用歌曲封面(artistpicserver)作为专辑封面
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

/**
 * 网易云搜索结果 album 不返回 picUrl，只返回超大整数 picId（JSON 解析即丢精度，
 * neteasePicIdToUrl 的精度校验会拒绝），导致专辑封面为空。
 *
 * 与歌曲封面补获（triggerCoverLoading → lxGetPic）走同一条链路：Rust get_lx_cover
 * 自带按专辑缓存 + 全局串行锁 + 请求间隔，天然规避网易云风控（code:-462）；
 * 前端并发调用只会在 Rust 侧排队，不会打爆专辑接口。
 *
 * 只阻塞等待 2.5 秒让首批封面随搜索结果一起返回，其余由后台 worker 继续补获
 * （Search.vue 的 albumCoverRefresh 轮询会把迟到的封面刷进视图）。
 */
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

/**
 * 获取落雪 LX 音源的封面图片 URL
 *
 * HTTP 请求+URL 归一化均由 Rust 后端 (url_resolver.rs) 完成。
 * 如果搜索结果已有封面，直接返回（避免不必要的网络请求）。
 */
export async function lxGetPic(songInfo: LxSearchResultItem): Promise<string | null> {
  // 如果搜索结果已有封面，直接返回
  if (songInfo.img) return normalizeKuwoCoverUrl(songInfo.img) || songInfo.img;

  try {
    const result = await pluginApi.getLxCover(toUrlSongInfo(songInfo));
    return (result && String(result).replace(/^http:\/\//i, 'https://')) || null;
  } catch (e: any) {
    console.warn(`[LxMusicSdk] getLxCover failed: ${e?.message || e}`);
    return null;
  }
}