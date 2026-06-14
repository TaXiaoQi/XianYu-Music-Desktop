import { computed, watch, type Ref } from 'vue';

import type { Song } from '../types';
import { compareByAlphabetIndex } from '../utils/alphabetIndex';

interface ArtistAlbumItem {
  key: string;
  name: string;
  count: number;
  artist: string;
  firstSongPath: string;
}

interface UseHomeArtistAlbumsOptions {
  localFilterCondition: Ref<string>;
  filterCondition: Ref<string>;
  librarySongs: Ref<Song[]>;
  albumSortMode: Ref<'count' | 'name' | 'artist' | 'custom'>;
  albumCustomOrder: Ref<string[]>;
  preloadCovers: (paths: string[]) => void;
}

const songHasArtistName = (song: Song, artistName: string) =>
  (
    song.effective_artist_names?.length
      ? song.effective_artist_names
      : song.artist_names || [song.artist]
  ).includes(artistName);

export function useHomeArtistAlbums({
  localFilterCondition,
  filterCondition,
  librarySongs,
  albumSortMode,
  albumCustomOrder,
  preloadCovers,
}: UseHomeArtistAlbumsOptions) {
  const artistAlbumList = computed<ArtistAlbumItem[]>(() => {
    const artistName = localFilterCondition.value || filterCondition.value;
    if (!artistName) {
      return [];
    }

    const albumMap = new Map<string, ArtistAlbumItem>();

    librarySongs.value.forEach(song => {
      if (!songHasArtistName(song, artistName)) {
        return;
      }

      const albumKey =
        song.album_key ||
        `${song.album || 'Unknown'}::${song.album_artist || song.artist || 'Unknown'}`;
      const existing = albumMap.get(albumKey);

      if (existing) {
        existing.count += 1;
        return;
      }

      albumMap.set(albumKey, {
        key: albumKey,
        name: song.album || 'Unknown',
        count: 1,
        artist: song.album_artist || song.artist || 'Unknown',
        firstSongPath: song.path,
      });
    });

    const albums = Array.from(albumMap.values());

    if (albumSortMode.value === 'name') {
      albums.sort((left, right) => compareByAlphabetIndex(left.name, right.name));
    } else if (albumSortMode.value === 'custom') {
      const orderMap = new Map(albumCustomOrder.value.map((key, index) => [key, index]));
      albums.sort((left, right) => {
        const leftIndex = orderMap.has(left.key)
          ? orderMap.get(left.key)!
          : Number.MAX_SAFE_INTEGER;
        const rightIndex = orderMap.has(right.key)
          ? orderMap.get(right.key)!
          : Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });
    } else if (albumSortMode.value === 'artist') {
      albums.sort((left, right) => {
        const artistDiff = compareByAlphabetIndex(left.artist, right.artist);
        return artistDiff !== 0
          ? artistDiff
          : compareByAlphabetIndex(left.name, right.name);
      });
    } else {
      albums.sort(
        (left, right) =>
          right.count - left.count || compareByAlphabetIndex(left.artist, right.artist),
      );
    }

    return albums;
  });

  watch(
    artistAlbumList,
    albums => {
      preloadCovers(albums.map(album => album.firstSongPath).filter(Boolean));
    },
    { immediate: true },
  );

  return {
    artistAlbumList,
  };
}
