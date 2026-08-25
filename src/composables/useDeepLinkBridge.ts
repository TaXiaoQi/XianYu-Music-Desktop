import { listen } from '@tauri-apps/api/event';
import { onMounted, onUnmounted } from 'vue';
import router from '../router';
import { appApi } from '../services/tauri/appApi';
import { lxSearch, type LxSearchResultItem, type LxSourceId } from '../services/lxMusicSdk';
import { useNavigationStore } from '../shared/stores/navigation';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { parseIntervalToSeconds } from '../utils/remoteSong';
import { useToast } from './toast';
import type { Song } from '../types';

type SongLinkParams = { name: string; artist: string; source: string };

/** 有效落雪音源 key（与移动端 kOnlineSources / 分享数据契约 source 同构） */
const VALID_LX_SOURCES: ReadonlySet<string> = new Set(['kw', 'kg', 'tx', 'wy', 'mg']);

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
      source: decodeOnce(u.searchParams.get('source') ?? ''),
    };
  } catch {
    return { name: '', artist: '', source: '' };
  }
}

/** 将 Lx 搜索结果项转换为 Song（与 Search.vue 的 lxResultToSong 同构） */
function lxResultToSong(item: LxSearchResultItem): Song {
  const artistNames = item.singer ? item.singer.split('、').filter(Boolean) : ['未知歌手'];
  const songDuration = parseIntervalToSeconds(item.interval);
  const album = item.albumName || '未知专辑';
  return {
    name: item.name,
    title: item.name,
    path: `lx://${item.source}/${item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album,
    album_artist: item.singer || '未知歌手',
    album_key: `${album}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: songDuration,
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${item.source}/${item.songmid}`,
    _hash: item.hash,
    _types: item._types,
    _copyrightId: item.copyrightId,
    _songmid: item.songmid,
    _source: item.source,
    _songId: item.songId,
    _strMediaMid: item.strMediaMid,
    _albumMid: item.albumMid,
    _albumId: item.albumId,
    rawData: item,
  } as any;
}

/**
 * 分享链接触发：按来源（source）优先用对应音源搜索同一首歌并直接播放。
 * 交给播放器时带 shareLinkPlayback 标记，失败行为按「分享链接播放失败行为」设置（暂停/替换播放）。
 */
async function playShareLinkSong(name: string, artist: string, source: string) {
  const keyword = artist.trim() ? `${name} ${artist}`.trim() : name.trim();
  const { showToast } = useToast();
  try {
    const result = await lxSearch(source as LxSourceId, keyword, 1);
    const first = result?.list?.[0];
    if (!first) {
      showToast('未找到分享的歌曲，请稍后重试', 'info');
      return;
    }
    const song = lxResultToSong(first);
    const { playSong } = usePlaybackController();
    await playSong(song, { shareLinkPlayback: true });
  } catch (error) {
    console.error('[deeplink] 分享歌曲播放失败:', error);
    showToast('分享歌曲播放失败', 'error');
  }
}

async function handleSongLink(raw: string) {
  const { name, artist, source } = parseSongLink(raw);
  if (!name.trim()) return;

  // 来源感知：分享链接带有效音源 key（kw/wy/kg/tx/mg）时优先按该音源搜索并自动播放
  if (source && VALID_LX_SOURCES.has(source)) {
    await playShareLinkSong(name, artist, source);
    return;
  }

  // 兜底：无来源/未知来源 → 填入搜索框并跳转搜索页
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
 * 这里监听 app:deep-link 事件并消费。带来源（source）的分享链接按对应音源搜索并
 * 直接播放（分享播放失败行为：暂停/替换播放）；无来源的旧链接回退到搜索页填入关键词。
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