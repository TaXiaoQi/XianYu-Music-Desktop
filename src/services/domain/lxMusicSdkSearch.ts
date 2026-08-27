/**
 * LX 协议 SDK · 搜索与 TX 分发包装。
 *
 * 负责跨平台歌曲搜索（kx/kw/wy/mg 走 dispatchFallbackModule 可兑底），以及 QQ
 * 专辑搜索/批量时长补查的分发包装（同走 fallback 模块）。搜索实现在 lxSearchPlatform。
 */
import {
  type LxSearchResult,
} from './lxMusicSdkBase';
import {
  searchKg,
  searchKw,
  searchMg,
  searchTx,
  searchWy,
  txBatchTrackIntervalBuiltin,
  txSearchAlbumsRawBuiltin,
} from './lxSearchPlatform';
import { dispatchFallbackModule } from '../fallbackModules/registry';
import type { LxSourceId } from './lxMusicSdkTypes';

/**
 * Search music from LX sources
 * @param source Source ID: 'kw'|'kg'|'tx'|'wy'|'mg'
 * @param keyword Search keyword
 * @param page Page number (1-based)
 * @param limit Results per page
 */
export async function lxSearch(source: LxSourceId, keyword: string, page = 1, limit?: number): Promise<LxSearchResult> {
  return dispatchFallbackModule('lx_search', 'search', { source, keyword, page, limit },
    () => lxSearchBuiltin(source, keyword, page, limit));
}

async function lxSearchBuiltin(source: LxSourceId, keyword: string, page = 1, limit?: number): Promise<LxSearchResult> {
  const searchFnMap: Record<string, (str: string, page: number, limit: number) => Promise<LxSearchResult>> = {
    kw: searchKw,
    kg: searchKg,
    tx: searchTx,
    wy: searchWy,
    mg: searchMg,
  };
  const fn = searchFnMap[source];
  if (!fn) throw new Error(`Unknown LX source: ${source}`);
  return fn(keyword, page, limit ?? (source === 'tx' ? 50 : source === 'mg' ? 20 : 30));
}

export async function txSearchAlbumsRaw(
  keyword: string,
  page = 1,
  limit = 30,
): Promise<Array<Record<string, any>>> {
  return dispatchFallbackModule('lx_album', 'searchAlbums', { keyword, page, limit },
    () => txSearchAlbumsRawBuiltin(keyword, page, limit));
}

/**
 * 批量查询 QQ 歌曲时长（UniformRuleCtrl / CgiGetTrackInfo，按 songid）。
 * QQ 系 MusicFree 插件的 formatMusicItem 不输出时长（interval 被丢弃），
 * getMusicInfo 对已带 artwork+qualities 的条目又走早退分支，宿主只能自行批量补。
 * 该端点与插件 getBatchQualities 同源，实测未受搜索类风控影响。
 * 返回 Map<songId, 时长秒>；单批失败跳过，不抛异常。
 */
export async function txBatchTrackInterval(
  songIds: Array<string | number>,
): Promise<Map<string, number>> {
  const result = await dispatchFallbackModule('lx_duration', 'batchTrackInterval', { songIds },
    () => txBatchTrackIntervalBuiltin(songIds));
  // 下发模块返回普通对象（JSON 边界），转换为 Map 保持原契约
  if (result instanceof Map) return result;
  if (result && typeof result === 'object') {
    return new Map(Object.entries(result as Record<string, number>));
  }
  return new Map();
}