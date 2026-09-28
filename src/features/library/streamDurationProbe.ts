import type { Playlist, Song } from '../../types';
import { parseIntervalToSeconds } from '../../utils/remoteSong';
import { cacheLxSong, getCachedLxSong } from '../../services/domain/lxSongCache';
import { lxSearch, txBatchTrackInterval } from '../../services/domain/lxMusicSdk';
import type { LxSourceId } from '../../services/domain/lxMusicSdkTypes';

const LX_SCHEME = 'lx://';
const TX_SCHEME = 'lx://tx/';
const PROBE_SOURCES: ReadonlyArray<string> = ['kg', 'tx', 'wy', 'mg', 'kw'];
const STABLE_PROBE_SOURCES = ['kg', 'tx', 'kw'] as const;
const MAX_PARALLEL_PROBES = 3;
const MAX_SEARCH_ROUNDS = 3;

export const isStreamedPath = (path: string) =>
  path.startsWith('lx://') || path.startsWith('remote://') || path.startsWith('plugin://');

interface ProbeHit {
  interval: string;
  source: string;
  songmid?: string | number;
}

interface DurationFixerDeps {
  findSong: (path: string) => Song | undefined;
  resolvePlaylist: (playlistId: string) => Playlist | undefined;
  applyDuration: (path: string, seconds: number) => void;
}

// 先从 lx 缓存或 rawData 里推算已知时长；推算不出返回 0，交给后续网络探测。
export const peekKnownDuration = (song: Song): number => {
  const path = song.path ?? '';

  if (path.startsWith(LX_SCHEME)) {
    const [sourceKey, songmid = ''] = path.slice(LX_SCHEME.length).split('/');
    if (sourceKey && songmid) {
      const cached = getCachedLxSong(sourceKey, songmid);
      if (cached?.interval) {
        return parseIntervalToSeconds(cached.interval);
      }
    }

    const raw = song.rawData;
    if (raw) {
      const rawInterval = raw.interval ?? raw.Interval ?? raw.dt ?? raw.Dt ?? raw.timelength ?? raw.Timelength;
      if (rawInterval) {
        const seconds = parseIntervalToSeconds(String(rawInterval));
        if (seconds > 0) {
          return seconds;
        }
      }

      const milliseconds = raw.duration ?? raw.Duration ?? raw.durationMs ?? raw.duration_ms;
      if (typeof milliseconds === 'number' && milliseconds > 0) {
        return milliseconds > 1000 ? Math.floor(milliseconds / 1000) : milliseconds;
      }
    }

    return 0;
  }

  if (path.startsWith('plugin://')) {
    const raw = song.rawData;
    if (raw) {
      const rawValue = raw.duration ?? raw.Duration ?? raw.dt ?? raw.interval ?? raw.intervalSeconds ?? raw.timelength;
      if (typeof rawValue === 'number' && rawValue > 0) {
        return rawValue > 1000 ? Math.floor(rawValue / 1000) : rawValue;
      }
      if (typeof rawValue === 'string') {
        const parsed = parseIntervalToSeconds(rawValue);
        if (parsed > 0) {
          return parsed;
        }
      }
    }
    return 0;
  }

  if (path.startsWith('remote://')) {
    const raw = song.rawData;
    if (raw) {
      const rawValue = raw.duration ?? raw.Duration ?? raw.dt ?? raw.interval;
      if (typeof rawValue === 'number' && rawValue > 0) {
        return rawValue > 1000 ? Math.floor(rawValue / 1000) : rawValue;
      }
    }
  }

  return 0;
};

/**
 * 播放集时长补齐器：打开播放集时，为时长为 0 的在线曲目
 * 依次尝试 rawData 推算、tx 批量接口、逐曲搜索探测。
 */
export const createPlaylistDurationFixer = (deps: DurationFixerDeps) => {
  const probingPaths = new Set<string>();
  const waitingQueue: Song[] = [];
  let runningProbes = 0;
  let lastSyncedPlaylistId = '';

  const probeSongDuration = async (song: Song) => {
    if (!song.path?.startsWith(LX_SCHEME)) return;
    if (probingPaths.has(song.path)) return;
    probingPaths.add(song.path);

    try {
      const originSource = song.path.slice(LX_SCHEME.length).split('/')[0] as LxSourceId;
      if (!originSource || !PROBE_SOURCES.includes(originSource)) return;

      const sourcePlan: LxSourceId[] =
        (STABLE_PROBE_SOURCES as ReadonlyArray<string>).includes(originSource)
          ? [originSource]
          : [...STABLE_PROBE_SOURCES];

      const keyword = song.name || song.title || '';
      let hit: ProbeHit | null = null;

      for (const candidateSource of sourcePlan) {
        let candidates: Array<{ songmid: string | number; name: string; singer?: string; interval: string }> = [];

        for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
          try {
            const response = await lxSearch(candidateSource, keyword, 1, 10);
            candidates = response?.list ?? [];
            break;
          } catch (error: any) {
            const message = String(error?.message ?? error ?? '');
            if (/404|403|405|not found|forbidden|method not allowed/i.test(message)) {
              candidates = [];
              break;
            }
            if (/406|429|限流|频率|frequent|denied/i.test(message) && round < MAX_SEARCH_ROUNDS - 1) {
              await new Promise(resolve => setTimeout(resolve, 800 * (round + 1)));
              continue;
            }
            candidates = [];
            break;
          }
        }
        if (candidates.length === 0) continue;

        if (candidateSource === originSource) {
          const songmid = song.path.slice(LX_SCHEME.length).split('/')[1];
          const exact = candidates.find(item => String(item.songmid) === String(songmid)) ?? null;
          if (exact) hit = { ...exact, source: candidateSource };
        }
        if (!hit) {
          const fuzzy = candidates.find(
            item => item.name === song.name && (item.singer || '').includes(song.artist || ''),
          ) ?? null;
          if (fuzzy) hit = { ...fuzzy, source: candidateSource };
        }
        if (hit) break;
      }

      if (!hit) return;

      const seconds = parseIntervalToSeconds(hit.interval);
      if (seconds <= 0) return;

      cacheLxSong({ interval: hit.interval, songmid: hit.songmid || '', source: hit.source } as any);
      deps.applyDuration(song.path, seconds);
    } catch {
      // 探测失败静默忽略
    } finally {
      probingPaths.delete(song.path);
    }
  };

  const pumpQueue = () => {
    while (runningProbes < MAX_PARALLEL_PROBES && waitingQueue.length > 0) {
      const next = waitingQueue.shift()!;
      void probeSongDuration(next).finally(() => {
        runningProbes--;
        pumpQueue();
      });
      runningProbes++;
    }
  };

  const sync = (playlistId: string) => {
    if (!playlistId || playlistId === lastSyncedPlaylistId) return;
    lastSyncedPlaylistId = playlistId;

    const playlist = deps.resolvePlaylist(playlistId);
    if (!playlist) return;

    const incomplete: Song[] = [];
    playlist.songPaths.forEach((path) => {
      const song = deps.findSong(path) ?? playlist.songs?.find(item => item.path === path);
      if (song && song.duration === 0 && isStreamedPath(song.path)) {
        incomplete.push(song);
      }
    });
    if (incomplete.length === 0) return;

    const directPatches: Array<[string, number]> = [];
    const txCandidates: Song[] = [];
    const queuedSongs: Song[] = [];

    incomplete.forEach((song) => {
      const seconds = peekKnownDuration(song);
      if (seconds > 0) {
        directPatches.push([song.path, seconds]);
      } else if (song.path?.startsWith(LX_SCHEME)) {
        const sourceKey = song.path.slice(LX_SCHEME.length).split('/')[0];
        if (sourceKey === 'tx') txCandidates.push(song);
        else queuedSongs.push(song);
      }
    });

    directPatches.forEach(([path, seconds]) => deps.applyDuration(path, seconds));

    if (txCandidates.length > 0) {
      const trackIds = txCandidates
        .map(s => s.rawData?.id ?? s.path.slice(TX_SCHEME.length).split('/')[1])
        .filter(Boolean) as string[];

      void txBatchTrackInterval(trackIds).then((durationMap) => {
        if (!durationMap.size) return;
        txCandidates.forEach((song) => {
          const songmid = song.path.slice(TX_SCHEME.length).split('/')[1];
          const seconds = durationMap.get(String(songmid));
          if (seconds && seconds > 0) {
            deps.applyDuration(song.path, seconds);
          }
        });
      });
    }

    waitingQueue.length = 0;
    waitingQueue.push(...queuedSongs);
    pumpQueue();
  };

  return { sync };
};
