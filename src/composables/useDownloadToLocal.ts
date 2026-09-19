import { useToast } from './toast';
import { useSettings } from '../features/settings/useSettings';
import { useDownloadStore } from '../features/download/store';
import { downloadSong, downloadSongExtras, isDownloadableOnlineSong } from '../services/domain/downloadService';
import { recordDownload, fileNameFromPath } from '../services/domain/downloadHistory';
import { useLibraryRuntimeActions } from '../features/library/useLibraryRuntimeActions';
import { QUALITY_META } from '../types';
import type { Song, QualityKey, DownloadQuality, DownloadFileNameStyle } from '../types';

export interface DownloadLocalOptions {
  quality?: DownloadQuality;
  downloadDir?: string;
  downloadAudio?: boolean;
  downloadLyrics?: boolean;
  downloadCover?: boolean;
  fileNameStyle?: DownloadFileNameStyle;
  preResolvedUrls?: Partial<Record<QualityKey, string>>;
}

export async function downloadToLocal(
  song: Song,
  options?: DownloadLocalOptions,
): Promise<boolean> {
  const { showToast } = useToast();
  const { settings } = useSettings();
  const downloadStore = useDownloadStore();

  if (!isDownloadableOnlineSong(song)) {
    showToast('该歌曲不是可下载的在线歌曲', 'info');
    return false;
  }

  const downloadDir = options?.downloadDir || settings.value.download.downloadPath;
  if (!downloadDir) {
    showToast('请先在设置 - 下载中选择下载目录', 'error');
    return false;
  }

  const downloadAudio = options?.downloadAudio ?? true;
  const downloadLyrics = options?.downloadLyrics ?? settings.value.download.downloadLyrics;
  const downloadCover = options?.downloadCover ?? settings.value.download.embedCover;
  const fileNameStyle = options?.fileNameStyle ?? settings.value.download.fileNameStyle;

  if (!downloadAudio && !downloadLyrics && !downloadCover) {
    showToast('请至少选择一项下载内容', 'info');
    return false;
  }

  const songPath = song.cue_source_path || song.path;
  const songLabel = song.title || song.name || '未知歌曲';

  const quality = options?.quality
    ?? (settings.value.download.quality as DownloadQuality)
    ?? '320k';

  downloadStore.beginDownload(songPath);
  showToast(`开始下载：${songLabel}`, 'info');

  try {
    if (downloadAudio) {
      const result = await downloadSong(song, {
        quality,
        qualityFallbackBehavior: settings.value.download.qualityFallbackBehavior,
        downloadDir,
        keepSourceFilename: settings.value.download.keepSourceFilename,
        fileNameStyle,
        overwriteExisting: settings.value.download.overwriteExisting,
        downloadLyrics,
        lyricsFormat: settings.value.download.lyricsFormat,
        lyricsStyle: settings.value.download.lyricsStyle,
        embedMetadata: settings.value.download.embedMetadata,
        embedLyrics: settings.value.download.embedLyrics,
        embedCover: settings.value.download.embedCover,
        downloadCover,
        preResolvedUrls: options?.preResolvedUrls,
        onProgress: (percent: number) => downloadStore.setProgress(percent),
      });

      await recordDownload({
        songPath,
        filePath: result.filePath,
        fileName: fileNameFromPath(result.filePath),
        quality: result.hitQuality,
        downloadedAt: Date.now(),
        title: song.title || song.name,
        artist: song.artist,
      });

      const hitMeta = QUALITY_META[result.hitQuality as QualityKey];
      const selectedMeta = QUALITY_META[quality as QualityKey];
      const degraded = selectedMeta && hitMeta
        ? hitMeta.rank < selectedMeta.rank
        : result.hitQuality !== quality;
      const extras: string[] = [];
      if (result.lyricsSaved) extras.push('含歌词');
      if (result.coverSaved) extras.push('含封面');
      const extraNote = extras.length > 0 ? `（${extras.join('、')}）` : '';
      const note = degraded
        ? `（实际下载音质：${hitMeta?.label ?? result.hitQuality}）`
        : '';
      showToast(`下载完成${note}${extraNote}`, degraded ? 'info' : 'success');
    } else {
      const result = await downloadSongExtras(song, {
        downloadDir,
        fileNameStyle,
        downloadLyrics,
        lyricsFormat: settings.value.download.lyricsFormat,
        lyricsStyle: settings.value.download.lyricsStyle,
        downloadCover,
      });

      const extras: string[] = [];
      if (result.lyricsSaved) extras.push('歌词');
      if (result.coverSaved) extras.push('封面');
      const extraNote = extras.length > 0 ? `（${extras.join('、')}）` : '';
      showToast(`下载完成${extraNote}`, 'success');
    }

    try {
      const { scanLibrary } = useLibraryRuntimeActions();
      void scanLibrary({ trigger: 'manual-rescan', visibility: 'silent' });
    } catch (e: any) {
      console.warn('[Download] 下载后刷新本地库失败:', e?.message);
    }

    return true;
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : (e?.message || JSON.stringify(e));
    console.error('[Download] 下载失败:', e);
    showToast(`下载失败：${msg}`, 'error');
    return false;
  } finally {
    downloadStore.endDownload();
  }
}
