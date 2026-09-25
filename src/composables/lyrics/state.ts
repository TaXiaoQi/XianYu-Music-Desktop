import { computed, ref, watch } from 'vue';

import { usePlaybackStore } from '../../features/playback/store';
import { useLibraryStore } from '../../features/library/store';
import type { Song } from '../../types';
import { fetchOnlineLyricsRaw } from '../../features/playback/onlineLyrics';
import { useSettingsStore } from '../../features/settings/store';
import { useLyricsSettingsStore } from '../../features/lyricsSettings/store';
import { toTraditional } from '../../features/i18n/traditional';
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
const MAX_ONLINE_LYRICS_RETRIES = 15;
let onlineLyricsRetryCount = 0;
const unavailableOnlineLyricsPaths = new Set<string>();
const onlineLyricsFetchRequests = new Set<string>();

export function markOnlineLyricsUnavailable(songPath: string) {
  if (!songPath) return;

  unavailableOnlineLyricsPaths.add(songPath);

  const playbackStore = usePlaybackStore();
  if (playbackStore.currentSong?.path !== songPath) {
    return;
  }

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

function localizeLyricLine(line: LyricLine): LyricLine {
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

function synthesizeUniformPlainLyricLines(raw: string, durationSec: number): LyricLine[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0 || !(durationSec > 0)) return [];

  const durationMs = durationSec * 1000;
  const step = durationMs / lines.length;
  return lines.map((text, index) => ({
    time: index * step,
    endTime: (index + 1) * step,
    text,
    translation: '',
    romaji: '',
    isBG: false,
    isDuet: false,
    isDuetPartner: false,
  }));
}

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

  if (lastWatchedSongPath !== song.path) {
    onlineLyricsRetryCount = 0;
  }

  lyricsStatus.value = 'loading';
  rawLyrics.value = '';
  lyricDocument.value = null;
  semanticLyrics.value = [];
  parsedLyrics.value = [];

  try {
    const lyricsRaw = overrideLyricsRaw ?? song.lyrics_raw;
    if (lyricsRaw) {
      const payload = await lyricsApi.parseLyricsText(lyricsRaw);

      if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

      rawLyrics.value = lyricsRaw;
      lyricDocument.value = payload?.document ?? null;
      semanticLyrics.value = payload?.semanticLines ?? [];
      parsedLyrics.value = (payload?.displayLines ?? []).map((line) => localizeLyricLine({
        ...line,
        translation: line.translation || '',
        romaji: line.romaji || '',
        secondary: line.secondary ? [...line.secondary] : undefined,
      } as LyricLine));
      if (parsedLyrics.value.length === 0) {
        const synthesized = synthesizeUniformPlainLyricLines(
          lyricsRaw,
          playbackStore.currentSong?.duration ?? 0,
        );
        if (synthesized.length > 0) {
          parsedLyrics.value = synthesized.map(localizeLyricLine);
        }
      }
      lyricsStatus.value = parsedLyrics.value.length > 0 ? 'ready' : 'empty';
      onlineLyricsRetryCount = 0;
      unavailableOnlineLyricsPaths.delete(song.path);
      return;
    }

    const lyricsPath = song.cue_source_path || song.path;
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
          const lyricsRaw = await fetchOnlineLyricsRaw(song);
          onlineLyricsFetchRequests.delete(song.path);
          if (requestId !== loadRequestId || playbackStore.currentSong?.path !== song.path) return;

          if (!lyricsRaw) {
            markOnlineLyricsUnavailable(song.path);
            return;
          }

          song.lyrics_raw = lyricsRaw;
          useLibraryStore().patchSongMeta(song.path, { lyrics_raw: lyricsRaw } as Partial<Song>);
          playbackStore.patchQueueSongMeta(song.path, { lyrics_raw: lyricsRaw });
          void loadLyrics(lyricsRaw);
        })();
        return;
      }

      // 同一首歌的取词已在飞：沿用原来的等待-重试（播放流程也可能先投喂）
      onlineLyricsRetryCount += 1;
      if (onlineLyricsRetryCount > MAX_ONLINE_LYRICS_RETRIES) {
        console.warn('[Lyrics] 在线歌曲歌词获取超时，置为空:', song.path);
        unavailableOnlineLyricsPaths.add(song.path);
        lyricsStatus.value = 'empty';
        onlineLyricsRetryCount = 0;
        return;
      }
      setTimeout(() => {
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
    parsedLyrics.value = (payload?.displayLines ?? []).map((line) => localizeLyricLine({
      ...line,
      translation: line.translation || '',
      romaji: line.romaji || '',
      secondary: line.secondary ? [...line.secondary] : undefined,
    } as LyricLine));
    if (parsedLyrics.value.length === 0) {
      const synthesized = synthesizeUniformPlainLyricLines(
        rawLyrics.value,
        playbackStore.currentSong?.duration ?? 0,
      );
      if (synthesized.length > 0) {
        parsedLyrics.value = synthesized.map(localizeLyricLine);
      }
    }
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

let lastWatchedSongPath: string | null = null;
let songPathWatcherInitialized = false;

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
    rawLyrics,
  };
}
