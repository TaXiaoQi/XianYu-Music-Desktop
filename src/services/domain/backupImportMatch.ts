import type { Song } from '../../types';
import type { ImportedPlaylist } from './backupImportTypes';


function normalizeBaseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[–—―]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[【[].*?[】\]]/g, '')
    .replace(/[–—―]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArtist(artist: string): string {
  return artist
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isArtistPartialMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
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

export function matchSongsToLocalLibrary(
  playlists: ImportedPlaylist[],
  localSongs: Song[],
): { playlists: ImportedPlaylist[]; matchedCount: number; unmatchedCount: number } {
  const localPathSet = new Set(localSongs.map(s => s.path.toLowerCase()));

  const byBaseName = new Map<string, Song>();
  const byTitleArtist = new Map<string, Song>();
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

      if (localPathSet.has(song.path.toLowerCase())) {
        matchedCount++;
        return song;
      }

      const fileName = song.path.split(/[\\/]/).pop() || song.path;
      const baseName = fileName.replace(/\.[^.]+$/, '');
      const normalizedBaseName = normalizeBaseName(baseName);
      const localByBaseName = byBaseName.get(normalizedBaseName);
      if (localByBaseName) {
        matchedCount++;
        return { ...song, path: localByBaseName.path };
      }

      const titleKey = normalizeTitle(songTitle);
      const artistKey = normalizeArtist(songArtist);
      if (titleKey) {
        const fullKey = `${titleKey}\u0000${artistKey}`;
        const localByFull = byTitleArtist.get(fullKey);
        if (localByFull) {
          matchedCount++;
          return { ...song, path: localByFull.path };
        }

        const titleMatches = byTitle.get(titleKey);
        if (titleMatches) {
          const partialMatch = titleMatches.find(local =>
            isArtistPartialMatch(artistKey, normalizeArtist(local.artist || '')),
          );
          if (partialMatch) {
            matchedCount++;
            return { ...song, path: partialMatch.path };
          }

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