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
