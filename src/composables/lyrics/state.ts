import { computed, ref, watch } from 'vue';

import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import { useLyricsSettingsStore } from '../../features/lyricsSettings/store';
import { getCurrentLyricDisplayLines } from './converters';
import type {
  CurrentLyricDisplayState,
  DesktopLyricsSettings,
  LyricLine,
  LyricDocument,
  LyricsSettings,
  LyricsStatus,
  SemanticLine,
} from './types';
import { lyricsApi } from '../../services/tauri/lyricsApi';

export const showDesktopLyrics = ref(false);
export const showLyricsPlayerSettingsPanel = ref(false);
export const lyricsStatus = ref<LyricsStatus>('idle');
export const parsedLyrics = ref<LyricLine[]>([]);
export const lyricDocument = ref<LyricDocument | null>(null);

const rawLyrics = ref('');
const semanticLyrics = ref<SemanticLine[]>([]);
let loadRequestId = 0;
// [在线歌词重试] 最大重试次数（每次间隔 800ms，共约 12 秒）
// 超过此次数后停止重试，置为 'empty' 状态
const MAX_ONLINE_LYRICS_RETRIES = 15;
let onlineLyricsRetryCount = 0;
const unavailableOnlineLyricsPaths = new Set<string>();

export function markOnlineLyricsUnavailable(songPath: string) {
  if (!songPath) return;

  unavailableOnlineLyricsPaths.add(songPath);

  const playbackStore = usePlaybackStore();
  if (playbackStore.currentSong?.path !== songPath) {
    return;
  }

  // 让已排队的在线歌词重试失效，避免继续 800ms 轮询占用 UI 状态。
  loadRequestId += 1;
  onlineLyricsRetryCount = 0;
  rawLyrics.value = '';
  lyricDocument.value = null;
  semanticLyrics.value = [];
  parsedLyrics.value = [];
  lyricsStatus.value = 'empty';
}

export function clearOnlineLyricsUnavailable(songPath: string) {
  if (!songPath) return;
  unavailableOnlineLyricsPaths.delete(songPath);
}

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

export async function loadLyrics(overrideLyricsRaw?: string) {
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
    onlineLyricsRetryCount = 0;
    return;
  }

  // [修复] 歌曲切换时重置在线歌词重试计数器
  if (lastWatchedSongPath !== song.path) {
    onlineLyricsRetryCount = 0;
  }

  lyricsStatus.value = 'loading';
  rawLyrics.value = '';
  lyricDocument.value = null;
  semanticLyrics.value = [];
  parsedLyrics.value = [];

  try {
    // [修复] 优先使用调用方直接传入的歌词文本（在线歌曲异步获取歌词后直接传入），
    // 避免 currentSong computed 响应式传播延迟导致读到空的 lyrics_raw。
    const lyricsRaw = overrideLyricsRaw ?? song.lyrics_raw;
    // If the song carries pre-fetched lyrics (e.g. from network music API),
    // parse them directly instead of looking up by file path.
    if (lyricsRaw) {
      const payload = await lyricsApi.parseLyricsText(lyricsRaw);

      if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

      const parsedCount = (payload?.displayLines ?? []).length;
      const rawLineCount = lyricsRaw.split(/\r?\n/).length;
      if (parsedCount < rawLineCount) {
        console.info(`[Lyrics] parseLyricsText: rawLines=${rawLineCount} parsedLines=${parsedCount}（丢弃 ${rawLineCount - parsedCount} 行）first=${payload?.displayLines?.[0]?.text ?? ''} last=${payload?.displayLines?.[parsedCount - 1]?.text ?? ''}`);
      } else {
        console.info(`[Lyrics] parseLyricsText: rawLines=${rawLineCount} parsedLines=${parsedCount}`);
      }

      rawLyrics.value = lyricsRaw;
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
      onlineLyricsRetryCount = 0; // 歌词加载成功，重置重试计数器
      unavailableOnlineLyricsPaths.delete(song.path);
      return;
    }

    // [在线歌曲歌词重试] lx:// 和 plugin:// 协议歌曲的歌词是异步获取的，
    // playSong 中的 loadLyrics() 可能在歌词获取完成前就被调用。
    // 此时不要走文件路径读取（对在线歌曲无意义），而是延迟重试等待 lyrics_raw 就绪。
    const lyricsPath = song.cue_source_path || song.path;
    const isOnlineSong = lyricsPath.startsWith('lx://') || lyricsPath.startsWith('plugin://');
    if (isOnlineSong) {
      if (unavailableOnlineLyricsPaths.has(song.path)) {
        lyricsStatus.value = 'empty';
        onlineLyricsRetryCount = 0;
        return;
      }

      lyricsStatus.value = 'loading';
      // [修复] 添加最大重试次数，避免歌词获取失败后无限重试
      // 歌词获取成功时 lyrics_raw 会被设置并触发 watcher 调用 loadLyrics，
      // 此时 lyrics_raw 非空不会进入此分支，所以 maxRetry 只限制"等待歌词"的重试
      onlineLyricsRetryCount += 1;
      if (onlineLyricsRetryCount > MAX_ONLINE_LYRICS_RETRIES) {
        console.warn('[Lyrics] 在线歌曲歌词获取超时，置为空:', song.path);
        unavailableOnlineLyricsPaths.add(song.path);
        lyricsStatus.value = 'empty';
        onlineLyricsRetryCount = 0;
        return;
      }
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

    const payload = await lyricsApi.getSongLyricsPayload(lyricsPath);

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
let songPathWatcherInitialized = false;

function ensureSongPathWatcher() {
  if (songPathWatcherInitialized) return;
  songPathWatcherInitialized = true;
  // 仅监听 path 变化：切歌时重新加载歌词。
  // lyrics_raw 的异步刷新由调用方（playerPlayback.ts）在设置歌词后通过 loadLyrics(raw) 传参显式触发，
  // 这里若再监听 lyrics_raw 变化会与传参加载并发竞争，导致 parsedLyrics 被覆盖、歌词错乱无法滚动。
  watch(
    () => usePlaybackStore().currentSong?.path ?? null,
    (newPath) => {
      if (newPath !== lastWatchedSongPath) {
        lastWatchedSongPath = newPath;
        void loadLyrics();
      }
    },
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
