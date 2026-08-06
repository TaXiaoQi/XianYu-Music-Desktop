import { useToast } from './toast';
import { useSettings } from '../features/settings/useSettings';
import { useDownloadStore } from '../features/download/store';
import { downloadSong, downloadSongExtras, isDownloadableOnlineSong } from '../services/downloadService';
import { recordDownload, fileNameFromPath } from '../services/downloadHistory';
import { useLibraryRuntimeActions } from '../features/library/useLibraryRuntimeActions';
import { QUALITY_META } from '../types';
import type { Song, QualityKey, DownloadQuality } from '../types';

/** 下载弹窗传入的覆盖选项，未指定字段回退到设置中的默认值 */
export interface DownloadLocalOptions {
  /** 下载音质 */
  quality?: DownloadQuality;
  /** 下载目录（覆盖设置中的 downloadPath） */
  downloadDir?: string;
  /** 是否下载音频文件（默认 true） */
  downloadAudio?: boolean;
  /** 是否下载独立歌词文件（默认跟随设置） */
  downloadLyrics?: boolean;
  /** 是否下载独立封面文件（默认跟随设置） */
  downloadCover?: boolean;
}

/**
 * 统一的「下载至本地」逻辑，供下载弹窗复用。
 *
 * 写入 download store 驱动底栏下载 UI（Loader2 旋转动画），
 * 下载完成后记录历史并刷新底栏已下载状态。
 *
 * @param song 要下载的歌曲
 * @param options 覆盖选项（音质/目录/下载内容），未传字段回退到设置默认值
 * @returns 是否下载成功（用于调用方决定后续 UI 行为）
 */
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

  // 至少需要下载一项内容
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
        downloadDir,
        keepSourceFilename: settings.value.download.keepSourceFilename,
        fileNameStyle: settings.value.download.fileNameStyle,
        overwriteExisting: settings.value.download.overwriteExisting,
        downloadLyrics,
        lyricsFormat: settings.value.download.lyricsFormat,
        lyricsStyle: settings.value.download.lyricsStyle,
        embedMetadata: settings.value.download.embedMetadata,
        embedLyrics: settings.value.download.embedLyrics,
        embedCover: settings.value.download.embedCover,
        downloadCover,
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

      // 命中的实际档位可能低于用户所选（无版权自动降级）
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
      // 仅下载歌词和封面（不下载音频）
      const result = await downloadSongExtras(song, {
        downloadDir,
        fileNameStyle: settings.value.download.fileNameStyle,
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

    // 下载完成后静默刷新本地音乐库，确保新下载的歌曲出现在本地歌曲页
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
