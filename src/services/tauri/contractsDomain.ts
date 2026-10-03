import type {
  Song,
} from '../../types';

export interface RecognizeResponseContract {
  status: number;
  body: string;
}

export interface LxUrlSongInfoContract {
  songmid: string;
  source: string;
  hash?: string;
  name?: string;
  singer?: string;
  albumName?: string;
  albumId?: string | number;
  albumMid?: string;
  copyrightId?: string;
  strMediaMid?: string;
  songId?: string | number;
  _types?: Record<string, { size?: string | null; hash?: string }>;
}

export interface AlternativeSourceResultContract {
  source: string;
  songmid: string;
  name: string;
  singer: string;
  albumName: string;
  albumId: string | number;
  albumMid?: string;
  img?: string | null;
  interval: string;
  hash?: string | null;
  copyrightId?: string | null;
  strMediaMid?: string | null;
  songId?: string | number;
  lxTypes?: Record<string, { size?: string | null; hash?: string }>;
}

export interface LyricSongInfoContract {
  songmid: string;
  hash?: string;
  name: string;
  singer: string;
  albumName?: string;
  interval?: string;
  _interval?: number;
  songId?: string | number;
  strMediaMid?: string;
  albumMid?: string;
  albumId?: string | number;
  copyrightId?: string;
  source?: string;
}

export interface LyricResultContract {
  lyric: string;
  tlyric: string;
  rlyric: string;
  lxlyric: string;
}

/** 对齐 Rust playlist_fetcher::common 的 PlaylistSong（serde camelCase，冻结） */
export interface PlaylistSongResultContract {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  /** 毫秒 */
  duration: number;
  platform: string;
  platformId: string;
  pluginId: string;
  rawData: unknown;
}

/** 对齐 Rust playlist_fetcher::common 的 PlaylistImportResult（serde camelCase，冻结） */
export interface PlaylistImportResultContract {
  source: string;
  songs: PlaylistSongResultContract[];
  total: number;
  info: {
    name: string;
    img: string;
    desc: string;
    author: string;
    playCount: string;
  };
}

export interface PlaybackSessionDataContract {
  currentSongPath: string | null;
  playQueuePaths: string[];
  sourceSongPaths: string[];
  playMode: number;
  volume: number;
  currentPositionSecs: number;
  isPlaying: boolean;
  sessionQualityOverride: string | null;
  queueSongMeta: Record<string, Song>;
  updatedAt: number;
}
