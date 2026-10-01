import type {
  Song,
  SongDetail,
} from '../../types';

export interface MovedMusicFilePath {
  old_path: string;
  new_path: string;
}

export interface BatchMoveMusicFilesResult {
  moved_paths: MovedMusicFilePath[];
}

export type LyricsStorageSource = 'embedded' | 'sidecar' | 'empty';

export interface SongLyricsForEdit {
  lyrics: string;
  source: LyricsStorageSource;
  sourcePath: string | null;
}

export interface SongInfoEditPayload {
  title: string;
  artist: string;
  album: string;
  trackNumber: string | null;
  discNumber: string | null;
  year: string | null;
  coverPath: string | null;
}

export interface SaveSongInfoResponse {
  song: Song;
  detail: SongDetail;
}


export interface LibraryStats {
  total_songs: number;
  total_duration: number;
  total_file_size: number;
  album_count: number;
  artist_count: number;
  lossless_count: number;
  hires_count: number;
  this_month_added: number;
}

export type TimeRange =
  | { type: 'All' }
  | { type: 'Days7' }
  | { type: 'Days30' }
  | { type: 'ThisYear' };

export interface BehaviorStats {
  total_plays: number;
  total_duration: number;
  top_songs: TopSong[];
  top_songs_by_duration: TopSong[];
  top_artists: TopArtist[];
  top_albums: TopAlbum[];
  hour_distribution: number[];
  recent_activity: number[];
}

export interface ListenDurations {
  daily: number;
  weekly: number;
  total: number;
}

export interface CloudMergeResult {
  total_duration: number;
  merged: boolean;
}

export interface ListenSnapshotGlobal {
  total_play_count: number;
  total_play_time_ms: number;
  first_played_at: string | null;
  last_played_at: string | null;
}

export interface ListenSnapshotDaily {
  date: string;
  play_count: number;
  play_time_ms: number;
  unique_songs: number;
  unique_artists: number;
}

export interface ListenSnapshot {
  global: ListenSnapshotGlobal;
  daily: ListenSnapshotDaily[];
}

export interface ListenSnapshotMergeResult {
  total_play_time_ms: number;
  total_play_count: number;
}

export interface TopSong {
  song_path: string;
  play_count: number;
  value: number;
}

export interface TopArtist {
  artist: string;
  play_count: number;
}

export interface TopAlbum {
  album: string;
  play_count: number;
}

export interface QualityDistribution {
  hires: number;
  super_quality: number;
  high_quality: number;
  other: number;
}

export interface FormatDistribution {
  flac: number;
  mp3: number;
  alac: number;
  wav: number;
  aiff: number;
  aac: number;
  ogg: number;
  other: number;
}

export interface GeneratedFolder {
  name: string;
  path: string;
  songs: Song[];
}

export interface RenameConfig {
  mode: string;
  template: string;
  remove_track_prefix: boolean;
  remove_source_prefix: boolean;
}

export interface RenamePreview {
  original_path: string;
  original_name: string;
  new_name: string;
  status: string;
  error: string | null;
}

export interface RenameOperation {
  original_path: string;
  new_name: string;
}

export interface FfmpegDetection {
  available: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
}

export interface ConvertAudioResult {
  input_path: string;
  output_path: string;
  success: boolean;
  error: string | null;
}

export interface TrimAudioResult {
  input_path: string;
  output_path: string;
  success: boolean;
  error: string | null;
}
