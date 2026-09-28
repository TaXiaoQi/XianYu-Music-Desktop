import { computed, ref, shallowRef } from 'vue';

import type { LibrarySong, Song } from '../../types';

const LIST_GLUE = '\u0001';

// 就地比对时需要逐个同步的字段；遍历顺序不影响最终结果。
const TRACKED_FIELDS: ReadonlyArray<keyof LibrarySong> = [
  'id',
  'name',
  'title',
  'path',
  'comment',
  'artist',
  'artist_names',
  'effective_artist_names',
  'album',
  'album_artist',
  'album_key',
  'track_number',
  'disc_number',
  'is_various_artists_album',
  'collapse_artist_credits',
  'duration',
  'bitrate',
  'sample_rate',
  'bit_depth',
  'format',
  'added_at',
  'file_modified_at',
];

// 驻留重建时：这些文本字段空值统一收敛为 ''。
const DEFAULTED_TEXT_SLOTS: ReadonlyArray<keyof LibrarySong> = [
  'name',
  'path',
  'artist',
  'album',
  'album_artist',
  'album_key',
];

// 这些文本字段允许保持 undefined。
const OPTIONAL_TEXT_SLOTS: ReadonlyArray<keyof LibrarySong> = [
  'title',
  'track_number',
  'disc_number',
  'format',
];

const LIST_SLOTS: ReadonlyArray<keyof LibrarySong> = [
  'artist_names',
  'effective_artist_names',
];

const sameSequence = (one: string[], other: string[]) =>
  one.length === other.length && one.every((item, index) => item === other[index]);

/**
 * 以 path 为主键的常驻曲目仓库：
 * - 字符串与字符串数组统一驻留去重，多个曲目共享同一实例；
 * - canonical / source 两条路径序列在此收口，负责版本号推进与孤儿回收；
 * - pinned 集合保护不在两条序列内、但被播放队列等场景引用的曲目。
 */
export function createLibrarySongVault() {
  const entriesByPath = new Map<string, LibrarySong>();
  const pinnedPaths = new Set<string>();
  const wordBank = new Map<string, string>();
  const wordListBank = new Map<string, string[]>();

  const revision = ref(0);
  const dataVersion = ref(0);
  const canonicalTrail = shallowRef<string[]>([]);
  const sourceTrail = shallowRef<string[]>([]);

  const bankWord = (value: string | undefined) => {
    if (!value) {
      return value;
    }

    const banked = wordBank.get(value);
    if (banked !== undefined) {
      return banked;
    }

    wordBank.set(value, value);
    return value;
  };

  const bankWordList = (values: string[] = []) => {
    if (values.length === 0) {
      return [];
    }

    const packed = values.map(value => bankWord(value) ?? '');
    const fingerprint = packed.join(LIST_GLUE);
    const banked = wordListBank.get(fingerprint);
    if (banked !== undefined) {
      return banked;
    }

    wordListBank.set(fingerprint, packed);
    return packed;
  };

  // 生成驻留后的曲目副本：保留原对象全部字段，文本字段替换为驻留实例。
  const compact = (record: LibrarySong): LibrarySong => ({
    ...record,
    name: bankWord(record.name) ?? '',
    title: bankWord(record.title),
    comment: bankWord(record.comment),
    path: bankWord(record.path) ?? '',
    artist: bankWord(record.artist) ?? '',
    artist_names: bankWordList(record.artist_names),
    effective_artist_names: bankWordList(record.effective_artist_names),
    album: bankWord(record.album) ?? '',
    album_artist: bankWord(record.album_artist) ?? '',
    album_key: bankWord(record.album_key) ?? '',
    track_number: bankWord(record.track_number),
    disc_number: bankWord(record.disc_number),
    format: bankWord(record.format),
  });

  // 将驻留副本逐字段并入既有对象；仅统计真正发生变化的字段。
  const mergeInto = (target: LibrarySong, fresh: LibrarySong) => {
    let mutated = false;

    TRACKED_FIELDS.forEach((field) => {
      const candidate = fresh[field];
      const normalized = Array.isArray(candidate)
        ? bankWordList(candidate)
        : typeof candidate === 'string'
          ? bankWord(candidate)
          : candidate;
      const current = target[field];

      const bothLists = Array.isArray(current)
        && Array.isArray(normalized)
        && current.length === normalized.length
        && current.every((item, index) => item === normalized[index]);

      if (current === normalized || bothLists) {
        return;
      }

      (target as Record<keyof LibrarySong, unknown>)[field] = normalized;
      mutated = true;
    });

    return mutated;
  };

  const admit = (incoming: LibrarySong) => {
    const key = incoming?.path;
    if (!key) {
      return { entry: incoming, dirty: false };
    }

    const known = entriesByPath.get(key);
    if (!known) {
      entriesByPath.set(key, compact(incoming));
      return { entry: entriesByPath.get(key) as LibrarySong, dirty: true };
    }

    return { entry: known, dirty: mergeInto(known, compact(incoming)) };
  };

  // 孤儿回收后重建驻留词表：以仍存活的曲目为唯一事实来源。
  const rebank = () => {
    const freshWords = new Map<string, string>();
    const freshLists = new Map<string, string[]>();

    const pinWord = (value: string | undefined) => {
      if (!value) {
        return value;
      }

      const pinned = freshWords.get(value);
      if (pinned !== undefined) {
        return pinned;
      }

      freshWords.set(value, value);
      return value;
    };

    const pinList = (values: string[] = []) => {
      if (values.length === 0) {
        return [];
      }

      const packed = values.map(value => pinWord(value) ?? '');
      const fingerprint = packed.join(LIST_GLUE);
      const pinned = freshLists.get(fingerprint);
      if (pinned !== undefined) {
        return pinned;
      }

      freshLists.set(fingerprint, packed);
      return packed;
    };

    for (const entry of entriesByPath.values()) {
      DEFAULTED_TEXT_SLOTS.forEach((field) => {
        (entry as Record<keyof LibrarySong, unknown>)[field] = pinWord(entry[field] as string | undefined) ?? '';
      });
      OPTIONAL_TEXT_SLOTS.forEach((field) => {
        (entry as Record<keyof LibrarySong, unknown>)[field] = pinWord(entry[field] as string | undefined);
      });
      LIST_SLOTS.forEach((field) => {
        (entry as Record<keyof LibrarySong, unknown>)[field] = pinList(entry[field] as string[] | undefined);
      });
    }

    wordBank.clear();
    freshWords.forEach((value, key) => {
      wordBank.set(key, value);
    });

    wordListBank.clear();
    freshLists.forEach((value, key) => {
      wordListBank.set(key, value);
    });
  };

  // 两条路径序列加上 pinned 集合都覆盖不到的条目视为孤儿，直接驱逐。
  const sweepOrphans = () => {
    const retained = new Set<string>(canonicalTrail.value);
    sourceTrail.value.forEach(path => retained.add(path));
    pinnedPaths.forEach(path => retained.add(path));

    let evicted = false;
    entriesByPath.forEach((_entry, key) => {
      if (!retained.has(key)) {
        entriesByPath.delete(key);
        evicted = true;
      }
    });

    if (evicted) {
      rebank();
      revision.value += 1;
    }
  };

  const project = (paths: string[]) => {
    revision.value;
    return paths
      .map(path => entriesByPath.get(path))
      .filter((entry): entry is LibrarySong => !!entry);
  };

  // 序列落位时尽量复用既有数组实例，避免无意义的引用更换。
  const reconcileTrail = (current: string[], neighbor: string[], incoming: string[]) => {
    if (sameSequence(current, incoming)) {
      return current;
    }
    if (sameSequence(neighbor, incoming)) {
      return neighbor;
    }
    return incoming;
  };

  const writeCanonicalTrail = (incoming: string[], poolTouched = false) => {
    const settled = reconcileTrail(canonicalTrail.value, sourceTrail.value, incoming);
    const trailMoved = canonicalTrail.value !== settled;
    if (trailMoved) {
      canonicalTrail.value = settled;
    }

    if (poolTouched) {
      revision.value += 1;
    }
    if (trailMoved || poolTouched) {
      dataVersion.value += 1;
    }

    sweepOrphans();
  };

  const writeSourceTrail = (incoming: string[], poolTouched = false) => {
    const settled = reconcileTrail(sourceTrail.value, canonicalTrail.value, incoming);
    if (sourceTrail.value !== settled) {
      sourceTrail.value = settled;
    }

    if (poolTouched) {
      revision.value += 1;
    }

    sweepOrphans();
  };

  // 去重收录一批曲目，产出对应的路径序列。
  const collectTrail = (batch: LibrarySong[]) => {
    const seq: string[] = [];
    const visited = new Set<string>();
    let dirty = false;

    batch.forEach((item) => {
      if (!item?.path || visited.has(item.path)) {
        return;
      }

      visited.add(item.path);
      seq.push(item.path);

      if (admit(item).dirty) {
        dirty = true;
      }
    });

    return { seq, dirty };
  };

  const adoptCanonical = (batch: LibrarySong[]) => {
    const found = collectTrail(batch);
    writeCanonicalTrail(found.seq, found.dirty);
  };

  const adoptSource = (batch: LibrarySong[]) => {
    const found = collectTrail(batch);
    writeSourceTrail(found.seq, found.dirty);
  };

  // 仅接受仓库中真实存在的路径；不触发孤儿回收。
  const orderCanonical = (incoming: string[]) => {
    if (!Array.isArray(incoming)) {
      return;
    }

    const usable = incoming.filter(path => entriesByPath.has(path));
    if (sameSequence(canonicalTrail.value, usable)) {
      return;
    }

    canonicalTrail.value = usable;
    revision.value += 1;
    dataVersion.value += 1;
  };

  // 扫描增量：局部剔除 + 原地收录，不引发全量重建。
  const applyDelta = (payload: { songs?: LibrarySong[]; deleted_paths?: string[] }) => {
    const additions = payload.songs ?? [];
    const removals = payload.deleted_paths ?? [];

    if (additions.length === 0 && removals.length === 0) {
      return;
    }

    let mutated = false;

    if (removals.length > 0) {
      const gone = new Set(removals);

      const keptCanonical = canonicalTrail.value.filter(path => !gone.has(path));
      if (keptCanonical.length !== canonicalTrail.value.length) {
        canonicalTrail.value = keptCanonical;
        mutated = true;
      }

      const keptSource = sourceTrail.value.filter(path => !gone.has(path));
      if (keptSource.length !== sourceTrail.value.length) {
        sourceTrail.value = keptSource;
        mutated = true;
      }

      removals.forEach((path) => {
        if (entriesByPath.delete(path)) {
          mutated = true;
        }
      });
    }

    if (additions.length > 0) {
      const freshPaths: string[] = [];

      additions.forEach((item) => {
        if (!item?.path) {
          return;
        }

        const knownBefore = entriesByPath.has(item.path);
        if (admit(item).dirty) {
          mutated = true;
        }
        if (!knownBefore) {
          freshPaths.push(item.path);
        }
      });

      if (freshPaths.length > 0) {
        canonicalTrail.value = [...canonicalTrail.value, ...freshPaths];
        sourceTrail.value = [...sourceTrail.value, ...freshPaths];
        mutated = true;
      }
    }

    if (mutated) {
      revision.value += 1;
      dataVersion.value += 1;
    }
  };

  const getEntry = (path: string | null | undefined, fallback?: Song | null) => {
    void revision.value;

    if (!path) {
      return fallback ?? null;
    }

    return entriesByPath.get(path) ?? fallback ?? null;
  };

  const getEntries = (paths: string[], fallbackSongs: Song[] = []) => {
    const fallbackById = new Map<string, Song>();
    fallbackSongs.forEach((song) => {
      if (song?.path && !fallbackById.has(song.path)) {
        fallbackById.set(song.path, song);
      }
    });

    return paths
      .map(path => getEntry(path, fallbackById.get(path)))
      .filter((song): song is Song => !!song);
  };

  const recordEntry = (song: LibrarySong) => {
    if (admit(song).dirty) {
      revision.value += 1;
    }
  };

  const pinEntry = (song: LibrarySong) => {
    if (!song?.path) {
      return;
    }

    pinnedPaths.add(song.path);
    if (admit(song).dirty) {
      revision.value += 1;
    }
  };

  const pinEntries = (songs: LibrarySong[]) => {
    let dirty = false;

    songs.forEach((song) => {
      if (!song?.path) {
        return;
      }

      pinnedPaths.add(song.path);
      if (admit(song).dirty) {
        dirty = true;
      }
    });

    if (dirty) {
      revision.value += 1;
    }
  };

  const pinEntryGroups = (groups: LibrarySong[][]) => {
    let dirty = false;

    groups.forEach((group) => {
      group.forEach((song) => {
        if (!song?.path) {
          return;
        }

        pinnedPaths.add(song.path);
        if (admit(song).dirty) {
          dirty = true;
        }
      });
    });

    if (dirty) {
      revision.value += 1;
    }
  };

  const amendEntry = (path: string, patch: Partial<LibrarySong>) => {
    if (!path) return;
    const known = entriesByPath.get(path);
    if (known) {
      entriesByPath.set(path, { ...known, ...patch });
      revision.value += 1;
    }
  };

  const dropPinnedEntry = (path: string | null | undefined) => {
    if (!path) {
      return;
    }

    pinnedPaths.delete(path);
    if (entriesByPath.delete(path)) {
      revision.value += 1;
    }
  };

  const songIndex = computed(() => {
    revision.value;
    return entriesByPath as Map<string, Song>;
  });

  const canonicalView = computed<Song[]>({
    get: () => project(canonicalTrail.value),
    set: adoptCanonical,
  });

  const sourceView = computed<Song[]>({
    get: () => project(sourceTrail.value),
    set: adoptSource,
  });

  return {
    revision,
    dataVersion,
    canonicalTrail,
    sourceTrail,
    songIndex,
    canonicalView,
    sourceView,
    getEntry,
    getEntries,
    recordEntry,
    pinEntry,
    pinEntries,
    pinEntryGroups,
    amendEntry,
    dropPinnedEntry,
    adoptCanonical,
    adoptSource,
    orderCanonical,
    applyDelta,
  };
}

export type LibrarySongVault = ReturnType<typeof createLibrarySongVault>;
