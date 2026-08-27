import {
  buildKuwoAlbumCoverUrl,
  normalizeKuwoCoverUrl,
} from '../../utils/coverUrl';
import { decodeName } from '../../utils/musicFormat';
import {
  formatPlayTime,
  httpGetJson,
  type LxSearchResult,
  type LxSearchResultItem,
} from './lxMusicSdkBase';

/**
 * LX 平台搜索层 · KW (酷我)。
 * 仅依赖 lxMusicSdkBase，作为叶子模块被 lxSearchPlatform 门面 re-export。
 */

// ==================== KW (酷我) Search ====================

const KW_MINFO_REGEX = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/;

/**
 * 酷我搜索结果的封面字段在不同响应/版本中位置不一，尝试多个字段拼封面。
 * 完整 URL 直接归一化，相对 short 路径用 buildKuwoAlbumCoverUrl。
 * 全部缺失返回 null，由 catalogSearch 阶段对 artist/album 异步补封面。
 */
function kwSearchCover(info: any): string | null {
  const candidates = ['web_albumpic_short', 'web_album_pic', 'album_pic', 'albumpic_short', 'albumpic', 'pic'];
  for (const key of candidates) {
    const v = info?.[key];
    if (!v) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (/^https?:\/\//i.test(s)) {
      const norm = normalizeKuwoCoverUrl(s);
      if (norm) return norm;
    } else {
      const built = buildKuwoAlbumCoverUrl(s);
      if (built) return built;
    }
  }
  return null;
}

function kwHandleResult(rawData: any[]): LxSearchResultItem[] | null {
  const result: LxSearchResultItem[] = [];
  if (!rawData) return result;
  for (let i = 0; i < rawData.length; i++) {
    const info = rawData[i];
    const songId = info.MUSICRID.replace('MUSIC_', '');
    if (!info.N_MINFO) {
      return null;
    }
    const types: LxSearchResultItem['types'] = [];
    const _types: LxSearchResultItem['_types'] = {};
    const infoArr = info.N_MINFO.split(';');
    for (const item of infoArr) {
      const match = item.match(KW_MINFO_REGEX);
      if (match) {
        switch (match[2]) {
          case '4000':
            types.push({ type: 'flac24bit', size: match[4] });
            _types.flac24bit = { size: match[4].toLocaleUpperCase() };
            break;
          case '2000':
            types.push({ type: 'flac', size: match[4] });
            _types.flac = { size: match[4].toLocaleUpperCase() };
            break;
          case '320':
            types.push({ type: '320k', size: match[4] });
            _types['320k'] = { size: match[4].toLocaleUpperCase() };
            break;
          case '128':
            types.push({ type: '128k', size: match[4] });
            _types['128k'] = { size: match[4].toLocaleUpperCase() };
            break;
        }
      }
    }
    types.reverse();
    const interval = parseInt(info.DURATION);
    // 搜索结果图片字段在同一响应/版本中位置不一，用 kwSearchCover 尝试多个字段；
    // 全部缺失则留空，由 lxCatalogSearch 阶段对 artist/album 异步补封面
    const imgFromSearch = kwSearchCover(info);
    result.push({
      name: decodeName(info.SONGNAME),
      singer: decodeName(info.ARTIST).replace(/&/g, '、'),
      source: 'kw',
      songmid: songId,
      albumId: decodeName(info.ALBUMID || ''),
      interval: Number.isNaN(interval) ? '00:00' : formatPlayTime(interval),
      albumName: info.ALBUM ? decodeName(info.ALBUM) : '',
      img: imgFromSearch,
      types,
      _types,
    });
  }
  return result;
}

export async function searchKw(str: string, page = 1, limit = 30, retryNum = 0): Promise<LxSearchResult> {
  if (retryNum > 2) throw new Error('KW search: try max num');
  const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(str)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
  const result = await httpGetJson(url);
  if (!result || (result.TOTAL !== '0' && result.SHOW === '0')) return searchKw(str, page, limit, ++retryNum);
  const list = kwHandleResult(result.abslist);
  if (list == null) return searchKw(str, page, limit, ++retryNum);
  const total = parseInt(result.TOTAL);
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'kw',
  };
}