import {
  type LxSearchResult,
} from './lxMusicSdkBase';
import {
  searchKg,
  searchKw,
  searchMg,
  searchQs,
  searchTx,
  searchWy,
  txBatchTrackIntervalBuiltin,
  txSearchAlbumsRawBuiltin,
} from './lxSearchPlatform';
import type { LxSourceId } from './lxMusicSdkTypes';

export async function lxSearch(source: LxSourceId, keyword: string, page = 1, limit?: number): Promise<LxSearchResult> {
  const searchFnMap: Record<string, (str: string, page: number, limit: number) => Promise<LxSearchResult>> = {
    kw: searchKw,
    kg: searchKg,
    tx: searchTx,
    wy: searchWy,
    mg: searchMg,
    qs: searchQs,
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
  return txSearchAlbumsRawBuiltin(keyword, page, limit);
}

export async function txBatchTrackInterval(
  songIds: Array<string | number>,
): Promise<Map<string, number>> {
  const result = await txBatchTrackIntervalBuiltin(songIds);
  if (result instanceof Map) return result;
  if (result && typeof result === 'object') {
    return new Map(Object.entries(result as Record<string, number>));
  }
  return new Map();
}