import { listen } from '@tauri-apps/api/event';
import { onMounted, onUnmounted } from 'vue';
import router from '../router';
import { appApi } from '../services/tauri/appApi';
import { useNavigationStore } from '../shared/stores/navigation';

type SongLinkParams = { name: string; artist: string };

const decodeOnce = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

function parseSongLink(raw: string): SongLinkParams {
  try {
    const u = new URL(raw);
    return {
      name: decodeOnce(u.searchParams.get('name') ?? ''),
      artist: decodeOnce(u.searchParams.get('artist') ?? ''),
    };
  } catch {
    return { name: '', artist: '' };
  }
}

async function handleSongLink(raw: string) {
  const { name, artist } = parseSongLink(raw);
  if (!name.trim()) return;
  const keyword = artist.trim() ? `${name} ${artist}`.trim() : name.trim();
  const navigationStore = useNavigationStore();
  navigationStore.setSearch(keyword);
  await router.push('/search');
}

async function consumePendingDeepLinks() {
  try {
    const links = await appApi.consumePendingDeepLinks();
    for (const link of links) {
      await handleSongLink(link);
    }
  } catch (error) {
    console.error('Failed to consume pending deep links:', error);
  }
}

/**
 * xianyu:// 深链桥：分享落地页点「在弦予音乐中打开」后由 Rust 侧把深链入队，
 * 这里监听 app:deep-link 事件并消费，解析歌名/歌手 → 跳转搜索页自动填入关键词。
 * 冷启动（App 被协议直接拉起）时在挂载阶段主动消费一次。
 */
export function useDeepLinkBridge() {
  let unlisten: (() => void) | null = null;

  onMounted(async () => {
    unlisten = await listen('app:deep-link', () => consumePendingDeepLinks());
    await consumePendingDeepLinks();
  });

  onUnmounted(() => {
    unlisten?.();
  });
}