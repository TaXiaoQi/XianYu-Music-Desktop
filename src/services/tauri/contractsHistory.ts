export interface RecentHistoryRecord {
  songPath: string;
  playedAt: number;
}

export interface RecentHistoryImportRecord {
  songPath: string;
  playedAt: number;
}

export interface StatisticsExportResult {
  filePath: string;
  exportId: string;
  exportedAt: string;
}

export interface StatisticsImportPreview {
  version: number;
  exportedAt: string;
  appVersion: string;
  exportId: string;
  songStatsCount: number;
  dailyStatsCount: number;
  recentPlaysCount: number;
  matchedSongCount: number;
  unmatchedSongCount: number;
  duplicateImportDetected: boolean;
}

export interface StatisticsImportResult {
  mode: 'overwrite' | 'merge';
  matchedSongCount: number;
  unmatchedSongCount: number;
  mergedSongCount: number;
  importedRecentPlaysCount: number;
  duplicateImportSkipped: boolean;
}

export interface LoudnessRecord {
  songId: number;
  songPath: string;
  loudnessLufs: number | null;
  estimatedLoudnessLufs: number | null;
  samplePeak: number | null;
  truePeak: number | null;
  tagTrackGainDb: number | null;
  tagTrackPeak: number | null;
  tagAlbumGainDb: number | null;
  tagAlbumPeak: number | null;
  tagR128TrackGainDb: number | null;
  tagR128AlbumGainDb: number | null;
  fileSize: number;
  fileModifiedAt: number;
  scanSource: string;
  analyzerName: string | null;
  analyzerVersion: number;
  scanStatus: string;
  scannedAt: number | null;
  errorMessage: string | null;
}
