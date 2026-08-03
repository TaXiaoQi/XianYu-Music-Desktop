import { useToast } from './toast';
import { useSettings } from '../features/settings/useSettings';
import { useDownloadStore } from '../features/download/store';
import { downloadSong, isDownloadableOnlineSong } from '../services/downloadService';
import { checkDownloadExists, recordDownload, fileNameFromPath } from '../services/downloadHistory';
import { useLibraryRuntimeActions } from '../features/library/useLibraryRuntimeActions';
import { QUALITY_META } from '../types';
import type { Song, QualityKey, DownloadQuality } from '../types';

/**
 * 统一的「下载至本地」逻辑，供底栏下载按钮和右键菜单下载复用。
 *
 * 写入 download store 驱动底栏下载 UI（Loader2 旋转动画），
 * 下载完成后记录历史并刷新底栏已下载状态。
 *
 * @param song 要下载的歌曲
 * @param qualityKey 指定音质（底栏音质下拉传入）；未传时用设置中的默认下载音质
 * @returns 是否下载成功（用于调用方决定后续 UI 行为）
 */
export async function downloadToLocal(
  song: Song,
  qualityKey?: DownloadQuality,
): Promise<boolean> {
  const { showToast } = useToast();
  const { settings } = useSettings();
  const downloadStore = useDownloadStore();

  if (!isDownloadableOnlineSong(song)) {
    showToast('该歌曲不是可下载的在线歌曲', 'info');
    return false;
  }

  const downloadDir = settings.value.download.downloadPath;
  if (!downloadDir) {
    showToast('请先在设置 - 下载中选择下载目录', 'error');
    return false;
  }

  const songPath = song.cue_source_path || song.path;

  // 已下载过且文件仍在：提示并跳过
  const existing = await checkDownloadExists(songPath);
  if (existing) {
    showToast(`已下载过：${existing.fileName}`, 'info');
    return false;
  }

  const songLabel = song.title || song.name || '未知歌曲';
  const quality = qualityKey
    ?? (settings.value.download.quality as DownloadQuality)
    ?? '320k';

  downloadStore.beginDownload(songPath);
  showToast(`开始下载：${songLabel}`, 'info');

  try {
    const result = await downloadSong(song, {
      quality,
      downloadDir,
      keepSourceFilename: settings.value.download.keepSourceFilename,
      fileNameStyle: settings.value.download.fileNameStyle,
      overwriteExisting: settings.value.download.overwriteExisting,
      downloadLyrics: settings.value.download.downloadLyrics,
      downloadCover: settings.value.download.downloadCover,
      lyricsFormat: settings.value.download.lyricsFormat,
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
