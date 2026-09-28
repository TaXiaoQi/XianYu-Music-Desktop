import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import { useSongDetailCache } from '../../../composables/useSongDetailCache';
import type { SongDetail } from '../../../types';

/** 线上音源（读不到本地元数据）的路径前缀 */
const STREAM_PREFIXES = ['lx://', 'plugin://'] as const;

export const isStreamPath = (path: string) =>
  STREAM_PREFIXES.some((prefix) => path.startsWith(prefix));

/**
 * 详情页展开期间按曲目路径加载本地元数据（SongDetail）。
 * 用递增令牌作废过期请求，只有“令牌仍有效 && 详情页仍开着 && 路径未变”才允许回写。
 */
export function useSongDetailLookup(enabled: Ref<boolean>, trackPath: MaybeRefOrGetter<string>) {
  const { loadSongDetail, clearSongDetailCache: forgetSongDetail } = useSongDetailCache();

  const detail = ref<SongDetail | null>(null);
  let liveToken = 0;

  const stale = (token: number, path: string) =>
    token !== liveToken || !enabled.value || path !== toValue(trackPath);

  watch([enabled, () => toValue(trackPath)], async ([open, path]) => {
    const token = ++liveToken;

    if (!open || !path || isStreamPath(path)) {
      detail.value = null;
      return;
    }

    try {
      const found = await loadSongDetail(path);
      if (stale(token, path)) {
        return;
      }
      detail.value = found;
    } catch {
      if (stale(token, path)) {
        return;
      }
      detail.value = null;
    }
  }, { immediate: true });

  /** 详情页收起时清空当前详情并丢弃缓存 */
  const reset = () => {
    detail.value = null;
    forgetSongDetail();
  };

  return { detail, reset };
}
