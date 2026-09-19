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

export async function txBatchTrackInterval(
  songIds: Array<string | number>,
): Promise<Map<string, number>> {
  const result = await dispatchFallbackModule('lx_duration', 'batchTrackInterval', { songIds },
    () => txBatchTrackIntervalBuiltin(songIds));
  if (result instanceof Map) return result;
  if (result && typeof result === 'object') {
    return new Map(Object.entries(result as Record<string, number>));
  }
  return new Map();
}