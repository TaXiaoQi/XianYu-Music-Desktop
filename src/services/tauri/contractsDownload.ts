// ===== 下载服务类型契约 =====

export interface ProbeUrlInfoContract {
  url: string;
  size: number;
  error?: string;
}

export interface EmbedMetadataRequestContract {
  filePath: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  trackNumber?: string;
  discNumber?: string;
  lyrics?: string;
  coverData?: number[] | Uint8Array;
  coverMime?: string;
}

export interface FinalizeDownloadExtrasRequestContract {
  lyricsText?: string | null;
  lyricsPath?: string | null;
  coverUrl?: string | null;
  coverPath?: string | null;
  metadata?: EmbedMetadataRequestContract | null;
  embedCover: boolean;
}

export interface FinalizeDownloadExtrasResultContract {
  lyrics_saved: boolean;
  cover_saved: boolean;
  metadata_embedded: boolean;
  metadata_error?: string | null;
  cover_data: number[] | null;
  cover_mime: string;
}
