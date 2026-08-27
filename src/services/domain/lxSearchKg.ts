import { decodeName, formatSingerName } from '../../utils/musicFormat';
import {
  formatPlayTime,
  httpGetJson,
  sizeFormate,
  type LxSearchResult,
  type LxSearchResultItem,
} from './lxMusicSdkBase';

/**
 * LX 平台搜索层 · KG (酷狗)。
 * 仅依赖 lxMusicSdkBase，作为叶子模块被 lxSearchPlatform 门面 re-export。
 */

// ==================== KG (酷狗) Search ====================

/**
 * 构造酷狗封面 URL：搜索结果 Image 字段含 {size} 占位符，替换为实际尺寸并升级为 HTTPS。
 * 例：`http://imge.kugou.com/stdmusic/{size}/xxx.jpg` → `https://imge.kugou.com/stdmusic/480/xxx.jpg`
 */
function buildKugouCoverUrl(url: string | null | undefined, size = 480): string | null {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim();
  if (!u) return null;
  u = u.replace(/^http:\/\//i, 'https://');
  u = u.replace('{size}', String(size));
  return u;
}

export function kgFilterData(rawData: any): LxSearchResultItem {
  const types: LxSearchResultItem['types'] = [];
  const _types: LxSearchResultItem['_types'] = {};
  if (rawData.FileSize !== 0) {
    const size = sizeFormate(rawData.FileSize);
    types.push({ type: '128k', size, hash: rawData.FileHash });
    _types['128k'] = { size, hash: rawData.FileHash };
  }
  if (rawData.HQFileSize !== 0) {
    const size = sizeFormate(rawData.HQFileSize);
    types.push({ type: '320k', size, hash: rawData.HQFileHash });
    _types['320k'] = { size, hash: rawData.HQFileHash };
  }
  if (rawData.SQFileSize !== 0) {
    const size = sizeFormate(rawData.SQFileSize);
    types.push({ type: 'flac', size, hash: rawData.SQFileHash });
    _types.flac = { size, hash: rawData.SQFileHash };
  }
  if (rawData.ResFileSize !== 0) {
    const size = sizeFormate(rawData.ResFileSize);
    types.push({ type: 'flac24bit', size, hash: rawData.ResFileHash });
    _types.flac24bit = { size, hash: rawData.ResFileHash };
  }
  // 酷狗搜索结果 Image 字段含专辑封面 URL（带 {size} 占位符），直接提取避免 img=null
  const imgUrl = buildKugouCoverUrl(rawData.Image || rawData.trans_param?.union_cover);
  return {
    singer: decodeName(formatSingerName(rawData.Singers, 'name')),
    name: decodeName(rawData.SongName),
    albumName: decodeName(rawData.AlbumName),
    albumId: rawData.AlbumID,
    songmid: rawData.Audioid,
    source: 'kg',
    interval: formatPlayTime(rawData.Duration),
    img: imgUrl,
    hash: rawData.FileHash,
    types,
    _types,
  };
}

function kgItemQualityScore(item: LxSearchResultItem): number {
  // 音质档位权重：128k < 320k < flac < flac24bit。同一首歌的多个专辑版本里，
  // 保留最高音质档的那条，避免去重后留下低码率版本。
  const rank: Record<string, number> = { '128k': 1, '320k': 2, flac: 3, flac24bit: 4 };
  let score = 0;
  for (const t of item?.types || []) {
    if (t && rank[t.type]) score = Math.max(score, rank[t.type]);
  }
  return score;
}

function kgNormalKey(name: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, '');
}

function kgHandleResult(rawData: any[]): LxSearchResultItem[] {
  const rawList: LxSearchResultItem[] = [];
  rawData.forEach(item => {
    rawList.push(kgFilterData(item));
    if (item.Grp) {
      for (const childItem of item.Grp) rawList.push(kgFilterData(childItem));
    }
  });
  // 酷狗搜索常把同一首歌按不同专辑版本重复返回（同名同歌手、仅专辑不同），
  // 连带 Grp 一起展开后会出现成批重名的歌。这里按「歌名+歌手」去重并保留最高
  // 音质档的那条，既消除批量同名，又不误伤同名但不同歌手的歌曲。
  const best = new Map<string, LxSearchResultItem>();
  for (const item of rawList) {
    const key = `${kgNormalKey(item.name)}|${kgNormalKey(item.singer)}`;
    if (!kgNormalKey(item.name)) continue;
    const prev = best.get(key);
    if (!prev || kgItemQualityScore(item) >= kgItemQualityScore(prev)) {
      best.set(key, item);
    }
  }
  // 保持首次出现顺序，内容替换为最高音质版本
  const list: LxSearchResultItem[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const key = `${kgNormalKey(item.name)}|${kgNormalKey(item.singer)}`;
    if (!kgNormalKey(item.name) || seen.has(key)) continue;
    seen.add(key);
    list.push(best.get(key)!);
  }
  return list;
}

export async function searchKg(str: string, page = 1, limit = 30, retryNum = 0): Promise<LxSearchResult> {
  if (++retryNum > 3) throw new Error('KG search: try max num');
  const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(str)}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;
  const result = await httpGetJson(url);
  if (!result || result.error_code !== 0) return searchKg(str, page, limit, retryNum);
  const list = kgHandleResult(result.data.lists);
  if (list == null) return searchKg(str, page, limit, retryNum);
  const total = result.data.total;
  return {
    list,
    allPage: Math.ceil(total / limit),
    limit,
    total,
    source: 'kg',
  };
}