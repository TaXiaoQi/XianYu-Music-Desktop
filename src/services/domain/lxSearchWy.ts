import { neteasePicIdToUrl } from '../../utils/coverUrl';
import {
  formatPlayTime,
  httpGetJson,
  type LxSearchResult,
  type LxSearchResultItem,
} from './lxMusicSdkBase';

/**
 * LX 平台搜索层 · WY (网易云)。
 * 仅依赖 lxMusicSdkBase，作为叶子模块被 lxSearchPlatform 门面 re-export。
 */

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
    // 网易云搜索接口多数场景不返回 hq/sq 标志（旧版字段），若仅依赖它们，
    // _types 会只剩 128k，导致底部栏可选项与播放都只有最低档。
    // 网易云歌曲普遍提供 320k 与 flac（无损），在 hq/sq 之外补充声明，
    // 由探测/回退链路实测过滤出真正可用的档位。
    if (song.hq) { types.push({ type: '320k', size: null }); _types['320k'] = { size: null }; }
    if (song.sq) { types.push({ type: 'flac', size: null }); _types.flac = { size: null }; }
    types.push({ type: '128k', size: null }); _types['128k'] = { size: null };
    if (!song.hq) { types.push({ type: '320k', size: null }); _types['320k'] = { size: null }; }
    if (!song.sq) { types.push({ type: 'flac', size: null }); _types.flac = { size: null }; }
    // 高音质档位同样采用声明 + 探测回落策略：网易云黑胶曲库普遍提供 Hi-Res 与超清母带
    types.push({ type: 'flac24bit', size: null }); _types.flac24bit = { size: null };
    types.push({ type: 'master', size: null }); _types.master = { size: null };
    types.reverse();
    const ar = song.artists || [];
    const al = song.album || {};
    // 优先完整 picUrl（网易云返回 http://，统一转 https，避免走后端代理失败导致无封面）；
    // 其次可靠的字符串 picId（大整数 number 会丢精度，neteasePicIdToUrl 会拒绝），
    // 覆盖网易云 album 的 pic / pic_str / picId / picId_str 多种字段名。
    // 都没有则保持 null，交给 triggerCoverLoading → lxGetPic 走 song/detail
    const img =
      (al.picUrl && String(al.picUrl).replace(/^http:\/\//i, 'https://'))
      || neteasePicIdToUrl(al.picId_str || al.pic_str || al.picId || al.pic)
      || null;
    // 网易云搜索接口 artists[].img1v1Url 为歌手头像，提取供歌手搜索页使用；
    // 同时提取 artists[].id，img1v1Url 实为全局占位头像时靠 artistId 补真实头像
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