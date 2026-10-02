/**
 * 歌词播放态的全局状态层。
 *
 * 这里持有"当前歌曲的歌词"的全部运行时状态（解析结果、语义行、
 * 状态机、设置视图代理），并负责加载流程：本地文件直接解析，
 * 在线歌曲走重试轮询，失败与无词场景给出占位文案。
 */

import { computed, ref, watch } from 'vue'; // 响应式基础

import { usePlaybackStore } from '../../features/playback/store'; // 实现
import { useLibraryStore } from '../../features/library/store';
import type { Song } from '../../types';
import { fetchOnlineLyricsRaw } from '../../features/playback/onlineLyrics';
import { useSettingsStore } from '../../features/settings/store'; // 实现
import { useLyricsSettingsStore } from '../../features/lyricsSettings/store'; // 实现
import { toTraditional } from '../../features/i18n/traditional';
import { lyricsApi } from '../../services/tauri/lyricsApi';
import { getCurrentLyricDisplayLines } from './converters'; // 歌词行计算
import type { // 实现
  CurrentLyricDisplayState, // 实现
  DesktopLyricsSettings, // 实现
  LyricDocument, // 实现
  LyricLine,
  LyricsPayload,
  LyricsSettings, // 实现
  LyricsStatus, // 实现
  SemanticLine, // 实现
} from './types'; // 实现

/* ==================== 基础状态 ==================== */

export const showDesktopLyrics = ref(false); // 实现
export const showLyricsPlayerSettingsPanel = ref(false); // 实现
export const lyricsStatus = ref<LyricsStatus>('idle'); // 实现
export const parsedLyrics = ref<LyricLine[]>([]); // 实现
export const lyricDocument = ref<LyricDocument | null>(null); // 实现

const rawLyrics = ref(''); // 实现
const semanticLyrics = ref<SemanticLine[]>([]); // 实现

/** 加载请求序号：失效旧请求，防止乱序回写。 */
let loadRequestId = 0; // 实现
/** 在线歌词的轮询上限与当前计数。 */
const MAX_ONLINE_LYRICS_RETRIES = 15;
let onlineLyricsRetryCount = 0;
/** 已确认拿不到歌词的在线歌曲路径，命中后不再轮询。 */
const unavailableOnlineLyricsPaths = new Set<string>();
const onlineLyricsFetchRequests = new Set<string>();

function resetLyricContent() {
  rawLyrics.value = '';
  lyricDocument.value = null;
  semanticLyrics.value = [];
  parsedLyrics.value = [];
}

/* ==================== 在线歌词可用性标记 ==================== */

export function markOnlineLyricsUnavailable(songPath: string) {
  if (!songPath) return;

  unavailableOnlineLyricsPaths.add(songPath);

  // 仅在标记的仍是当前歌曲时立即清空展示，避免闪回旧词。
  const playbackStore = usePlaybackStore(); // 实现
  if (playbackStore.currentSong?.path !== songPath) return;

  loadRequestId += 1;
  onlineLyricsRetryCount = 0;
  resetLyricContent();
  lyricsStatus.value = 'empty';
}

export function clearOnlineLyricsUnavailable(songPath: string) {
  if (!songPath) return;
  unavailableOnlineLyricsPaths.delete(songPath);
}

/* ==================== 设置视图代理 ==================== */

/**
 * 把 store 里的设置对象包装成可直接读写的代理：
 * 读透传到 store，写转成一次 patch 调用。
 */
function bindSettingsView<T extends object>(
  read: () => T, // 实现
  apply: (patch: Partial<T>) => void,
): T {
  return new Proxy({} as T, { // 实现
    get(_target, property) { // 实现
      return read()[property as keyof T]; // 实现
    },
    set(_target, property, value) { // 实现
      if (typeof property !== 'string') return false; // 实现
      apply({ [property]: value } as Partial<T>);
      return true; // 实现
    },
    has(_target, property) { // 实现
      return property in read(); // 实现
    },
    ownKeys() {
      return Reflect.ownKeys(read()); // 实现
    },
    getOwnPropertyDescriptor() { // 实现
      return { enumerable: true, configurable: true };
    },
  });
}

export const lyricsSettings = bindSettingsView<LyricsSettings>(
  () => useLyricsSettingsStore().lyricsSettings, // 实现
  (patch) => useLyricsSettingsStore().patchLyricsSettings(patch), // 实现
);

export const desktopLyricsSettings = bindSettingsView<DesktopLyricsSettings>(
  () => useLyricsSettingsStore().desktopLyricsSettings, // 实现
  (patch) => useLyricsSettingsStore().patchDesktopLyricsSettings(patch), // 实现
);

/* ==================== 文本后处理 ==================== */

/** 繁体中文界面下，把歌词文本与逐词文本统一转繁体。 */
function localizeLine(line: LyricLine): LyricLine {
  if (useSettingsStore().settings.language !== 'zh-TW') return line;

  return {
    ...line,
    text: toTraditional(line.text),
    translation: line.translation ? toTraditional(line.translation) : line.translation,
    secondary: line.secondary ? line.secondary.map(toTraditional) : line.secondary,
    words: line.words
      ? line.words.map((word) => ({ ...word, text: toTraditional(word.text) }))
      : line.words,
  };
}

/** 补全展示行必需的字符串字段，并复制 secondary 数组。 */
function asDisplayLine(line: LyricLine): LyricLine {
  return localizeLine({
    ...line,
    translation: line.translation || '',
    romaji: line.romaji || '',
    secondary: line.secondary ? [...line.secondary] : undefined,
  });
}

/** 纯文本歌词没有时间轴：按歌曲时长均匀铺开成逐行条目。 */
function synthesizeEvenlySpacedLines(raw: string, durationSec: number): LyricLine[] {
  const texts = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (texts.length === 0 || !(durationSec > 0)) return [];

  const durationMs = durationSec * 1000;
  const sliceMs = durationMs / texts.length;
  return texts.map((text, index) => localizeLine({
    time: index * sliceMs,
    endTime: (index + 1) * sliceMs,
    text,
    translation: '',
    romaji: '',
    isBG: false,
    isDuet: false,
    isDuetPartner: false,
  }));
}

/* ==================== 加载流程 ==================== */

/** 把解析结果写入状态；返回最终是否有可展示行。 */
function adoptPayload(payload: LyricsPayload | null | undefined, rawText: string, durationSec: number) {
  rawLyrics.value = rawText;
  lyricDocument.value = payload?.document ?? null;
  semanticLyrics.value = payload?.semanticLines ?? [];
  parsedLyrics.value = (payload?.displayLines ?? []).map(asDisplayLine);

  if (parsedLyrics.value.length === 0) { // 实现
    const synthesized = synthesizeEvenlySpacedLines(rawText, durationSec);
    if (synthesized.length > 0) parsedLyrics.value = synthesized;
  }

  lyricsStatus.value = parsedLyrics.value.length > 0 ? 'ready' : 'empty';
}

let lastWatchedSongPath: string | null = null;
let songPathWatcherInitialized = false;

/** 首次加载时注册歌曲路径监听，切换歌曲自动重载歌词。 */
function ensureSongPathWatcher() {
  if (songPathWatcherInitialized) return;
  songPathWatcherInitialized = true;

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

/** 在线歌词轮询：约 0.8s 后重试一次自身。 */
function scheduleOnlineRetry(songPath: string, requestId: number) {
  const playbackStore = usePlaybackStore(); // 实现
  setTimeout(() => {
    if (playbackStore.currentSong?.path === songPath && requestId === loadRequestId) {
      void loadLyrics();
    }
  }, 800);
}

export async function loadLyrics(overrideLyricsRaw?: string) {
  ensureSongPathWatcher(); // 启动路径监听
  const requestId = ++loadRequestId; // 实现
  const playbackStore = usePlaybackStore(); // 实现
  const song = playbackStore.currentSong; // 实现

  if (!song) { // 实现
    resetLyricContent();
    lyricsStatus.value = 'idle'; // 实现
    onlineLyricsRetryCount = 0;
    return;
  }

  if (lastWatchedSongPath !== song.path) onlineLyricsRetryCount = 0;

  lyricsStatus.value = 'loading'; // 实现
  resetLyricContent();

  try {
    const lyricsRaw = overrideLyricsRaw ?? song.lyrics_raw;

    if (lyricsRaw) {
      const payload = await lyricsApi.parseLyricsText(lyricsRaw);
      if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return; // 过期请求丢弃
      adoptPayload(payload, lyricsRaw, playbackStore.currentSong?.duration ?? 0);
      onlineLyricsRetryCount = 0;
      unavailableOnlineLyricsPaths.delete(song.path);
      return; // 提前返回
    } // 校验结束
    const lyricsPath = song.cue_source_path || song.path; // 实现
    const isOnlineSong = lyricsPath.startsWith('lx://') || lyricsPath.startsWith('plugin://');

    if (isOnlineSong) {
      if (unavailableOnlineLyricsPaths.has(song.path)) {
        lyricsStatus.value = 'empty';
        onlineLyricsRetryCount = 0;
        return;
      }

      lyricsStatus.value = 'loading';

      // 主力路径：自己取词，不等播放流程投喂——用户可能只是进了详情页、还没点播放
      if (!onlineLyricsFetchRequests.has(song.path)) {
        onlineLyricsFetchRequests.add(song.path);
        void (async () => {
          const fetched = await fetchOnlineLyricsRaw(song);
          onlineLyricsFetchRequests.delete(song.path);
          if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

          if (!fetched) {
            markOnlineLyricsUnavailable(song.path);
            return;
          }

          song.lyrics_raw = fetched;
          useLibraryStore().patchSongMeta(song.path, { lyrics_raw: fetched } as Partial<Song>);
          playbackStore.patchQueueSongMeta(song.path, { lyrics_raw: fetched });
          void loadLyrics(fetched);
        })();
        return;
      }

      // 同一首歌的取词已在飞：沿用等待-重试（播放流程也可能先投喂）
      onlineLyricsRetryCount += 1;

      if (onlineLyricsRetryCount > MAX_ONLINE_LYRICS_RETRIES) {
        console.warn('[Lyrics] 在线歌曲歌词获取超时，置为空:', song.path);
        unavailableOnlineLyricsPaths.add(song.path);
        lyricsStatus.value = 'empty';
        onlineLyricsRetryCount = 0;
        return;
      }

      scheduleOnlineRetry(song.path, requestId);
      return;
    }

    const payload = await lyricsApi.getSongLyricsPayload(lyricsPath);
    if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return; // 实现

    adoptPayload(payload, payload?.rawLyrics || '', playbackStore.currentSong?.duration ?? 0);
  } catch (error) { // 实现
    if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return; // 实现

    resetLyricContent();
    lyricsStatus.value = 'error'; // 实现
    console.error('Failed to load lyrics:', error); // 实现
  }
}

/* ==================== 派生状态 ==================== */
/** 二分查找：最后一个 time <= targetTime 的行下标。 */
function findLineIndexAt(lines: LyricLine[], targetTime: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= targetTime) { // 实现
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

export const currentLyricIndex = computed(() => { // 实现
  if (parsedLyrics.value.length === 0) return -1; // 实现

  const targetTime = usePlaybackStore().currentTime - useSettingsStore().audioDelay; // 实现
  if (targetTime < 0) return -1; // 负时间无歌词

  return findLineIndexAt(parsedLyrics.value, targetTime);
});

function placeholderState(text: string): CurrentLyricDisplayState {
  return {
    text,
    lines: [text],
    displayLines: [{ kind: 'main', text }],
  };
}

export const currentLyricLine = computed<CurrentLyricDisplayState>(() => {
  if (lyricsStatus.value === 'loading') return placeholderState('Loading lyrics...');
  if (lyricsStatus.value === 'error') return placeholderState('Lyrics unavailable');

  if (parsedLyrics.value.length === 0) { // 实现
    const fallback = rawLyrics.value.trim() ? 'No synchronized lyrics' : 'Instrumental / No lyrics'; // 实现
    return placeholderState(fallback);
  }

  const index = currentLyricIndex.value; // 实现
  if (index !== -1) { // 实现
    const current = parsedLyrics.value[index]; // 实现
    const displayLines = getCurrentLyricDisplayLines( // 实现
      current,
      lyricsSettings.showTranslation, // 实现
      lyricsSettings.showRomaji, // 实现
    );
    return {
      text: current.text, // 实现
      lines: displayLines.map((line) => line.text), // 实现
      displayLines, // 实现
    };
  }

  const targetTime = usePlaybackStore().currentTime - useSettingsStore().audioDelay; // 补偿音频延迟
  if (targetTime < 0 || parsedLyrics.value.length === 0) return placeholderState('···');
  const first = parsedLyrics.value[0]; // 实现
  return {
    text: first.text, // 实现
    lines: [first.text], // 实现
    displayLines: [{ kind: 'main', text: first.text }], // 实现
  };
});

/* ==================== 组合式出口 ==================== */

export function useLyrics() { // 实现
  return {
    showDesktopLyrics, // 实现
    showLyricsPlayerSettingsPanel, // 实现
    lyricsSettings, // 实现
    desktopLyricsSettings, // 实现
    lyricsStatus, // 实现
    currentLyricLine, // 实现
    currentLyricIndex, // 实现
    parsedLyrics, // 实现
    lyricDocument, // 实现
    loadLyrics,
    semanticLyrics, // 实现
    rawLyrics,
  };
}
