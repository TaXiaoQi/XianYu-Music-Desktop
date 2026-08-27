import type { Song } from '../../types';
import type { ImportedPlaylist } from './backupImportTypes';

/**
 * 备份文件导入服务 · 本地库匹配。
 * 把导入歌曲（椒盐 / M3U 导出的外部设备路径）按文件名、标题+歌手
 * 匹配到本地音乐库，用本地路径替换原始路径，使导入的歌单可直接播放。
 */

/**
 * 归一化文件名（不含扩展名）用于比较。
 * 统一大小写、去除空格、统一各种破折号（- – — ―）为标准连字符。
 */
function normalizeBaseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[–—―]/g, '-')     // 统一各种破折号为连字符
    .replace(/\s*-\s*/g, '-')   // 去除连字符周围的空格
    .replace(/\s+/g, ' ')       // 合并多余空格
    .trim();
}

/**
 * 归一化标题用于比较。
 * 统一大小写、去除括号内容、统一破折号、合并空格。
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')   // 去除圆括号内容
    .replace(/[【[].*?[】\]]/g, '') // 去除方括号内容
    .replace(/[–—―]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 归一化歌手名用于比较。
 */
function normalizeArtist(artist: string): string {
  return artist
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 判断两个歌手名是否部分匹配（一方包含另一方）。
 * 用于处理 "Maroon 5, Big Sean" vs "Maroon 5" 的情况。
 */
function isArtistPartialMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // 按逗号/顿号/斜杠分割，检查是否有交集
  const splitArtists = (s: string) =>
    s.split(/[、,/&]/).map(p => p.trim()).filter(Boolean);
  const listA = splitArtists(a);
  const listB = splitArtists(b);
  for (const la of listA) {
    for (const lb of listB) {
      if (la === lb || la.includes(lb) || lb.includes(la)) return true;
    }
  }
  return false;
}

/**
 * 将导入的歌曲与本地音乐库匹配，用本地文件路径替换原始路径。
 *
 * 椒盐音乐 / M3U 导出的文件路径来自导出设备（如 Android），在当前机器上不存在。
 * 此函数根据文件名、标题+歌手在本地库中查找匹配歌曲，将 path 替换为本地路径，
 * 使导入后的歌单可直接播放。
 *
 * 匹配策略（按优先级）：
 * 1. 精确路径匹配 — 路径已在本地库中（同设备导出的 M3U）
 * 2. 文件名匹配 — 归一化后文件名相同（忽略空格、破折号差异）
 * 3. 标题+歌手匹配 — 归一化后标题和歌手完全一致
 * 4. 标题+歌手部分匹配 — 标题一致且歌手部分匹配（如多歌手情况）
 * 5. 仅标题匹配 — 标题一致且本地库中仅有一首同名歌曲
 */
export function matchSongsToLocalLibrary(
  playlists: ImportedPlaylist[],
  localSongs: Song[],
): { playlists: ImportedPlaylist[]; matchedCount: number; unmatchedCount: number } {
  // 本地库路径集合（小写比较）
  const localPathSet = new Set(localSongs.map(s => s.path.toLowerCase()));

  // 归一化文件名 → Song
  const byBaseName = new Map<string, Song>();
  // "title\0artist" → Song
  const byTitleArtist = new Map<string, Song>();
  // 归一化标题 → Song[]（同名歌曲可能有多首）
  const byTitle = new Map<string, Song[]>();

  for (const song of localSongs) {
    const fileName = song.path.split(/[\\/]/).pop() || song.path;
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const normalizedBaseName = normalizeBaseName(baseName);
    if (normalizedBaseName && !byBaseName.has(normalizedBaseName)) {
      byBaseName.set(normalizedBaseName, song);
    }

    const titleKey = normalizeTitle(song.title || song.name || '');
    const artistKey = normalizeArtist(song.artist || '');
    if (titleKey) {
      const fullKey = `${titleKey}\u0000${artistKey}`;
      if (!byTitleArtist.has(fullKey)) {
        byTitleArtist.set(fullKey, song);
      }
      const existing = byTitle.get(titleKey);
      if (existing) {
        existing.push(song);
      } else {
        byTitle.set(titleKey, [song]);
      }
    }
  }

  let matchedCount = 0;
  let unmatchedCount = 0;

  const matchedPlaylists = playlists.map(pl => ({
    ...pl,
    songs: pl.songs.map(song => {
      const songTitle = song.title || song.name || '';
      const songArtist = song.artist || '';

      // 1. 精确路径匹配
      if (localPathSet.has(song.path.toLowerCase())) {
        matchedCount++;
        return song;
      }

      // 2. 文件名匹配（归一化后比较）
      const fileName = song.path.split(/[\\/]/).pop() || song.path;
      const baseName = fileName.replace(/\.[^.]+$/, '');
      const normalizedBaseName = normalizeBaseName(baseName);
      const localByBaseName = byBaseName.get(normalizedBaseName);
      if (localByBaseName) {
        matchedCount++;
        return { ...song, path: localByBaseName.path };
      }

      // 3. 标题+歌手精确匹配（归一化后比较）
      const titleKey = normalizeTitle(songTitle);
      const artistKey = normalizeArtist(songArtist);
      if (titleKey) {
        const fullKey = `${titleKey}\u0000${artistKey}`;
        const localByFull = byTitleArtist.get(fullKey);
        if (localByFull) {
          matchedCount++;
          return { ...song, path: localByFull.path };
        }

        // 4. 标题+歌手部分匹配（标题一致，歌手部分匹配）
        const titleMatches = byTitle.get(titleKey);
        if (titleMatches) {
          // 4a. 尝试歌手部分匹配
          const partialMatch = titleMatches.find(local =>
            isArtistPartialMatch(artistKey, normalizeArtist(local.artist || '')),
          );
          if (partialMatch) {
            matchedCount++;
            return { ...song, path: partialMatch.path };
          }

          // 4b. 仅标题匹配：同名歌曲唯一时直接匹配
          if (titleMatches.length === 1) {
            matchedCount++;
            return { ...song, path: titleMatches[0].path };
          }
        }
      }

      unmatchedCount++;
      return song;
    }),
  }));

  return { playlists: matchedPlaylists, matchedCount, unmatchedCount };
}