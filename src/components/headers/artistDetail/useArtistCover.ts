import { ref, watch } from 'vue';
import { artistHeaderCache } from '../../../caches/imageCaches';
import { useCoverCache } from '../../../composables/useCoverCache';

// 与旧版一致的渐变色板：按歌手名哈希取色，保证同名歌手回退头像颜色稳定
const GRADIENTS = [
  'from-pink-500 to-rose-500',
  'from-purple-500 to-indigo-500',
  'from-cyan-500 to-blue-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-fuchsia-500 to-pink-500',
  'from-blue-400 to-indigo-500',
  'from-violet-500 to-purple-500',
];

export function gradientClassFor(name: string): string {
  if (!name) return GRADIENTS[0];
  let acc = 0;
  for (let i = 0; i < name.length; i += 1) {
    acc = name.charCodeAt(i) + ((acc << 5) - acc);
  }
  return GRADIENTS[Math.abs(acc) % GRADIENTS.length];
}

/**
 * 按歌手名 + 歌曲列表解析头部封面：
 * 依次尝试内存头部缓存 → 首歌缩略图缓存 → 异步加载，
 * 并用自增票号丢弃过期请求的结果。
 */
export function useArtistCover(artistName: () => string, songs: () => any[] | undefined) {
  const coverUrl = ref('');
  const resolving = ref(false);
  const { loadCover, peekCoverUrl } = useCoverCache();
  let ticket = 0;

  const settle = (url: string) => {
    coverUrl.value = url;
    resolving.value = false;
  };

  watch([artistName, songs], async ([name, list]) => {
    const mine = ++ticket;

    const firstPath = list && list.length > 0 ? list[0]?.path : undefined;
    if (!firstPath) {
      if (mine === ticket) settle('');
      return;
    }

    const headerHit = artistHeaderCache.get(name);
    if (headerHit) {
      settle(headerHit);
      return;
    }

    const thumbHit = peekCoverUrl(firstPath);
    if (thumbHit) {
      coverUrl.value = thumbHit;
      artistHeaderCache.set(name, thumbHit);
      resolving.value = false;
      return;
    }

    resolving.value = true;
    try {
      const found = await loadCover(firstPath);
      if (mine !== ticket) return;

      if (found) {
        coverUrl.value = found;
        artistHeaderCache.set(name, found);
      } else {
        coverUrl.value = '';
      }
    } catch {
      if (mine !== ticket) return;
      coverUrl.value = '';
    } finally {
      if (mine === ticket) {
        resolving.value = false;
      }
    }
  }, { immediate: true });

  return { coverUrl, resolving };
}
