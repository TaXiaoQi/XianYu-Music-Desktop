import { computed, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import { useLyricsSettingsStore } from '../../features/lyricsSettings/store';
import { getCurrentLyricDisplayLines } from './converters';
import type {
  CurrentLyricDisplayState,
  DesktopLyricsSettings,
  LyricLine,
  LyricDocument,
  LyricsPayload,
  LyricsSettings,
  LyricsStatus,
  SemanticLine,
} from './types';

export const showDesktopLyrics = ref(false);
export const showLyricsPlayerSettingsPanel = ref(false);
export const lyricsStatus = ref<LyricsStatus>('idle');
export const parsedLyrics = ref<LyricLine[]>([]);
export const lyricDocument = ref<LyricDocument | null>(null);

const rawLyrics = ref('');
const semanticLyrics = ref<SemanticLine[]>([]);
let loadRequestId = 0;

function createSettingsProxy<T extends object>(
  read: () => T,
  patch: (patch: Partial<T>) => void,
): T {
  return new Proxy({} as T, {
    get(_target, property) {
      return read()[property as keyof T];
    },
    set(_target, property, value) {
      if (typeof property !== 'string') return false;
      patch({ [property]: value } as Partial<T>);
      return true;
    },
    has(_target, property) {
      return property in read();
    },
    ownKeys() {
      return Reflect.ownKeys(read());
    },
    getOwnPropertyDescriptor() {
      return {
        enumerable: true,
        configurable: true,
      };
    },
  });
}

export const lyricsSettings = createSettingsProxy<LyricsSettings>(
  () => useLyricsSettingsStore().lyricsSettings,
  (patch) => useLyricsSettingsStore().patchLyricsSettings(patch),
);

export const desktopLyricsSettings = createSettingsProxy<DesktopLyricsSettings>(
  () => useLyricsSettingsStore().desktopLyricsSettings,
  (patch) => useLyricsSettingsStore().patchDesktopLyricsSettings(patch),
);

export async function loadLyrics() {
  ensureSongPathWatcher();
  const requestId = ++loadRequestId;
  const playbackStore = usePlaybackStore();
  const song = playbackStore.currentSong;

  if (!song) {
    rawLyrics.value = '';
    lyricDocument.value = null;
    semanticLyrics.value = [];
    parsedLyrics.value = [];
    lyricsStatus.value = 'idle';
    return;
  }

  lyricsStatus.value = 'loading';
  rawLyrics.value = '';
  lyricDocument.value = null;
  semanticLyrics.value = [];
  parsedLyrics.value = [];

  try {
    // If the song carries pre-fetched lyrics (e.g. from network music API),
    // parse them directly instead of looking up by file path.
    if (song.lyrics_raw) {
      const payload = await invoke<LyricsPayload>('parse_lyrics_text', { text: song.lyrics_raw });

      if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

      rawLyrics.value = song.lyrics_raw;
      lyricDocument.value = payload?.document ?? null;
      semanticLyrics.value = payload?.semanticLines ?? [];
      // [修复]: 不再生成假逐字时间，直接使用后端解析的真实逐字时间
      // 如果歌词没有逐字时间（普通 LRC），words 为 undefined，整行高亮
      parsedLyrics.value = (payload?.displayLines ?? []).map((line) => ({
        ...line,
        translation: line.translation || '',
        romaji: line.romaji || '',
        secondary: line.secondary ? [...line.secondary] : undefined,
      })) as LyricLine[];
      lyricsStatus.value = parsedLyrics.value.length > 0 ? 'ready' : 'empty';
      return;
    }

    // [在线歌曲歌词重试] lx:// 和 plugin:// 协议歌曲的歌词是异步获取的，
    // playSong 中的 loadLyrics() 可能在歌词获取完成前就被调用。
    // 此时不要走文件路径读取（对在线歌曲无意义），而是延迟重试等待 lyrics_raw 就绪。
    const lyricsPath = song.cue_source_path || song.path;
    const isOnlineSong = lyricsPath.startsWith('lx://') || lyricsPath.startsWith('plugin://');
    if (isOnlineSong) {
      lyricsStatus.value = 'loading';
      // 延迟重试：等待 IIFE 异步获取歌词完成
      setTimeout(() => {
        // 仅当仍是同一首歌且仍是最新请求时才重试
        if (
          playbackStore.currentSong?.path === song.path
          && requestId === loadRequestId
        ) {
          void loadLyrics();
        }
      }, 800);
      return;
    }

    const payload = await invoke<LyricsPayload>('get_song_lyrics_payload', { path: lyricsPath });

    if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

    rawLyrics.value = payload?.rawLyrics || '';
    lyricDocument.value = payload?.document ?? null;
    semanticLyrics.value = payload?.semanticLines ?? [];
    // [修复]: 不再生成假逐字时间，直接使用后端解析的真实逐字时间
    parsedLyrics.value = (payload?.displayLines ?? []).map((line) => ({
      ...line,
      translation: line.translation || '',
      romaji: line.romaji || '',
      secondary: line.secondary ? [...line.secondary] : undefined,
    })) as LyricLine[];
    lyricsStatus.value = parsedLyrics.value.length > 0 ? 'ready' : 'empty';
  } catch (error) {
    if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

    rawLyrics.value = '';
    lyricDocument.value = null;
    semanticLyrics.value = [];
    parsedLyrics.value = [];
    lyricsStatus.value = 'error';
    console.error('Failed to load lyrics:', error);
  }
}

// [修复防御]: 监听当前歌曲路径变化，自动刷新歌词
// 解决切歌时 loadLyrics() 未被调用或读取到旧 song 对象导致歌词不更新的问题
// 延迟注册 watcher，避免模块导入时 Pinia 尚未初始化导致 getActivePinia() 报错
let lastWatchedSongPath: string | null = null;
let lastWatchedLyricsRaw: string | null = null;
let songPathWatcherInitialized = false;

function ensureSongPathWatcher() {
  if (songPathWatcherInitialized) return;
  songPathWatcherInitialized = true;
  // 同时监听 path 和 lyrics_raw 的变化：
  // - path 变化：切歌时重新加载歌词
  // - lyrics_raw 变化：在线歌曲异步获取歌词后（path 不变）自动刷新
  watch(
    () => {
      const song = usePlaybackStore().currentSong;
      return { path: song?.path ?? null, lyricsRaw: song?.lyrics_raw ?? null };
    },
    (newVal) => {
      if (newVal.path !== lastWatchedSongPath) {
        lastWatchedSongPath = newVal.path;
        lastWatchedLyricsRaw = newVal.lyricsRaw;
        void loadLyrics();
        return;
      }
      // path 没变但 lyrics_raw 变了（在线歌曲异步获取歌词完成）
      if (newVal.lyricsRaw !== lastWatchedLyricsRaw) {
        lastWatchedLyricsRaw = newVal.lyricsRaw;
        // 仅在 lyrics_raw 从空变为非空时刷新（避免重复加载）
        if (newVal.lyricsRaw) {
          void loadLyrics();
        }
      }
    },
    { deep: false },
  );
}

function findLyricIndexByTime(lines: LyricLine[], targetTime: number): number {
  let left = 0;
  let right = lines.length - 1;
  let answer = -1;

  while (left <= right) {
    const mid = (left + right) >> 1;
    if (lines[mid].time <= targetTime) {
      answer = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return answer;
}

export const currentLyricIndex = computed(() => {
  if (parsedLyrics.value.length === 0) return -1;

  const targetTime = usePlaybackStore().currentTime - useSettingsStore().audioDelay;
  // [修复防御]: 未开始播放（targetTime < 0）时不匹配任何歌词行
  if (targetTime < 0) return -1;
  return findLyricIndexByTime(parsedLyrics.value, targetTime);
});

export const currentLyricLine = computed<CurrentLyricDisplayState>(() => {
  if (lyricsStatus.value === 'loading') {
    return {
      text: 'Loading lyrics...',
      lines: ['Loading lyrics...'],
      displayLines: [{ kind: 'main', text: 'Loading lyrics...' }],
    };
  }

  if (lyricsStatus.value === 'error') {
    return {
      text: 'Lyrics unavailable',
      lines: ['Lyrics unavailable'],
      displayLines: [{ kind: 'main', text: 'Lyrics unavailable' }],
    };
  }

  if (parsedLyrics.value.length === 0) {
    const fallback = rawLyrics.value.trim() ? 'No synchronized lyrics' : 'Instrumental / No lyrics';
    return {
      text: fallback,
      lines: [fallback],
      displayLines: [{ kind: 'main', text: fallback }],
    };
  }

  const index = currentLyricIndex.value;

  if (index !== -1) {
    const current = parsedLyrics.value[index];
    const displayLines = getCurrentLyricDisplayLines(
      current,
      lyricsSettings.showTranslation,
      lyricsSettings.showRomaji,
    );

    return {
      text: current.text,
      lines: displayLines.map((line) => line.text),
      displayLines,
    };
  }

  // [修复防御]: index === -1 时区分"未开始播放"和"歌词间隙"
  const targetTime = usePlaybackStore().currentTime - useSettingsStore().audioDelay;
  if (targetTime < 0 || parsedLyrics.value.length === 0) {
    const placeholder = '···';
    return { text: placeholder, lines: [placeholder], displayLines: [{ kind: 'main', text: placeholder }] };
  }

  const first = parsedLyrics.value[0];
  return {
    text: first.text,
    lines: [first.text],
    displayLines: [{ kind: 'main', text: first.text }],
  };
});

export function useLyrics() {
  return {
    showDesktopLyrics,
    showLyricsPlayerSettingsPanel,
    lyricsSettings,
    desktopLyricsSettings,
    lyricsStatus,
    currentLyricLine,
    currentLyricIndex,
    parsedLyrics,
    lyricDocument,
    loadLyrics,
    semanticLyrics,
  };
}
