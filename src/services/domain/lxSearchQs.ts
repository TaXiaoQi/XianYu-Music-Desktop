import { formatSingerName } from '../../utils/musicFormat';
import {
  formatPlayTime,
  httpGetJson,
  sizeFormate,
  type LxSearchResult,
  type LxSearchResultItem,
} from './lxMusicSdkBase';


// ==================== QS (汽水音乐) Search ====================
// 移植自 src-tauri/src/music/lx_search/qs.rs：汽水 PC 客户端综合搜索（免签名），
// 端点为歌曲/歌单/歌手/专辑混排流，此处取 tracks 分组，cursor 为全局流偏移。
// UA 或 device_* 参数缺失时上游返回 ERR_INVALID_PARAM（已实测验证的参数组合）。

const QS_PC_QUERY = 'aid=386088&app_name=luna_pc&region=cn&geo_region=cn&os_region=cn&sim_region=&device_id=3753066532709850&cdid=&iid=3753066532713946&version_name=3.5.2&version_code=30050200&channel=official&build_mode=master&network_carrier=&ac=wifi&tz_name=Asia/Shanghai&resolution=&device_platform=windows&device_type=Windows&os_version=Windows%2010&fp=3753066532709850';
const QS_UA = 'LunaPC/3.5.2(412998333)';
/** 单次取数的全局流窗口 */
const QS_CURSOR_STEP = 20;
/** 最多取数轮数（综合搜索的全局流通常 3~4 窗即耗尽） */
const QS_MAX_FETCHES = 5;
/** 搜索封面尺寸 */
const QS_COVER_SIZE = '500:500';
const DOUYIN_IMAGE_BASE = 'https://p3-luna.douyinpic.com/img/';

/// 对齐 Rust js_string：null/undefined → ''，其余按 JS String() 规则
const jsString = (v: unknown): string => (v == null ? '' : String(v));

/// search_id 用 UUID（对齐 Rust uuid::Uuid::new_v4；无 WebCrypto 环境时降级随机串）
function qsSearchId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return `${rand()}-${rand()}-${rand()}-${rand()}`;
}

/**
 * 对齐 Rust playlist_fetcher/qishui.rs build_image_url_from_cover：
 * 优先 uri + template_prefix 拼装固定尺寸封面，否则取 urls 首个可用地址。
 */
function buildImageUrlFromCover(urlCover: unknown, size: string): string {
  if (urlCover == null) return '';
  if (typeof urlCover === 'string') return urlCover;
  if (typeof urlCover !== 'object') return '';
  const obj = urlCover as Record<string, unknown>;
  const uri = jsString(obj.uri);
  const templatePrefix = jsString(obj.template_prefix);
  if (uri && templatePrefix) {
    return `${DOUYIN_IMAGE_BASE}${uri}~${templatePrefix}-resize:${size}.png`;
  }
  if (Array.isArray(obj.urls)) {
    const urls = obj.urls.map(jsString).filter(u => u !== '');
    const first = urls[0];
    if (first) {
      if (!uri || first.includes(uri)) return first;
      return first + uri;
    }
  }
  return '';
}

/** 汽水内部品质 → LX 品质（higher(192k) 在 LX 品质体系无对应，跳过） */
function qsQualityType(quality: string): string | null {
  switch (quality) {
    case 'medium': return '128k';
    case 'highest': return '320k';
    case 'lossless': return 'flac';
    case 'spatial': return 'spatial';
    case 'hi_res': return 'hires';
    default: return null;
  }
}

/** 单首曲目 → LxSearchResultItem */
function qsItemFromTrack(track: any): LxSearchResultItem | null {
  const songmid = typeof track?.id === 'string' ? track.id : '';
  if (!songmid) return null;
  const album = track?.album ?? null;
  const img = buildImageUrlFromCover(album?.url_cover, QS_COVER_SIZE);

  // 音质：bit_rates 顺序即低→高，映射后保持顺序（spatial/hires 为汽水特有品质）
  const types: LxSearchResultItem['types'] = [];
  const _types: LxSearchResultItem['_types'] = {};
  const bitRates = Array.isArray(track?.bit_rates) ? track.bit_rates : [];
  for (const br of bitRates) {
    const lxQuality = qsQualityType(br?.quality ?? '');
    if (!lxQuality) continue;
    const size = typeof br?.size === 'number' ? sizeFormate(br.size) : null;
    types.push({ type: lxQuality, size });
    _types[lxQuality] = { size };
  }

  const durationMs = typeof track?.duration === 'number' ? track.duration : 0;
  return {
    name: typeof track?.name === 'string' ? track.name : '',
    singer: formatSingerName(track?.artists ?? null),
    albumName: typeof album?.name === 'string' ? album.name : '',
    albumId: album?.id ?? '',
    songmid,
    source: 'qs',
    interval: formatPlayTime(durationMs / 1000),
    img: img || null,
    types,
    _types,
  };
}

/** 单次综合搜索（cursor 为全局流偏移，仅收集 tracks 分组） */
async function qsFetchTracks(keyword: string, cursor: number): Promise<LxSearchResultItem[]> {
  const url = `https://api.qishui.com/luna/pc/search/all?q=${encodeURIComponent(keyword)}&cursor=${cursor}&search_id=${qsSearchId()}&search_method=input&${QS_PC_QUERY}`;
  const result = await httpGetJson(url, {
    'User-Agent': QS_UA,
  });

  const out: LxSearchResultItem[] = [];
  const groups = Array.isArray(result?.result_groups) ? result.result_groups : [];
  for (const group of groups) {
    if (group?.id !== 'tracks') continue;
    const items = Array.isArray(group?.data) ? group.data : [];
    for (const item of items) {
      if (item?.meta?.item_type !== 'track') continue;
      const track = item?.entity?.track;
      if (!track) continue;
      const mapped = qsItemFromTrack(track);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

/**
 * 汽水搜索：综合搜索每关键词仅少量歌曲，滚动全局流凑满 limit（不足即上游耗尽）。
 * 上游无总数，翻页按页码偏移 cursor 起点近似（与 Rust 版一致的去重/轮数上限）。
 */
export async function searchQs(str: string, page = 1, limit = 30): Promise<LxSearchResult> {
  const want = Math.max(1, limit);
  const startCursor = Math.max(0, page - 1) * want;
  const collected: LxSearchResultItem[] = [];
  const seen = new Set<string>();
  for (let round = 0; round < QS_MAX_FETCHES; round++) {
    const items = await qsFetchTracks(str, startCursor + round * QS_CURSOR_STEP);
    if (items.length === 0) break;
    for (const it of items) {
      if (seen.has(it.songmid)) continue;
      seen.add(it.songmid);
      collected.push(it);
    }
    if (collected.length >= want) break;
  }
  if (collected.length === 0) {
    // 翻页耗尽返回空列表（loadMore 据此停止），首页空结果按失败抛出（对齐 Rust 版）
    if (page > 1) return { list: [], allPage: page, limit, total: 0, source: 'qs' };
    throw new Error('QS search: no results');
  }
  return {
    list: collected,
    allPage: Math.ceil(collected.length / limit),
    limit,
    total: collected.length,
    source: 'qs',
  };
}
