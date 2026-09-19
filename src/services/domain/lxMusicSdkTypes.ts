
export type LxSourceId = 'kw' | 'kg' | 'tx' | 'wy' | 'mg';

export const LX_SOURCE_NAMES: Record<LxSourceId, string> = {
  kw: '小蜗音乐',
  kg: '小枸音乐',
  tx: '小秋音乐',
  wy: '小芸音乐',
  mg: '小蜜音乐',
};

export interface LxArtistSearchResult {
  id: string;
  name: string;
  avatarUrl: string;
  songCount?: number;
  rawData: unknown;
}

export interface LxAlbumSearchResult {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  songCount?: number;
  rawData: unknown;
}

export interface LxPlaylistSearchResult {
  id: string;
  title: string;
  coverUrl: string;
  artist?: string;
  trackCount?: number;
  playCount?: number;
  rawData: unknown;
}