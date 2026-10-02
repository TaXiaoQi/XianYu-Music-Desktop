import { useToast } from './toast';
import { useSettings } from '../features/settings/useSettings';
import { useDownloadStore } from '../features/download/store';
import { downloadSong, downloadSongExtras, isDownloadableOnlineSong } from '../services/domain/downloadService';
import { recordDownload, fileNameFromPath } from '../services/domain/downloadHistory';
import { useLibraryRuntimeActions } from '../features/library/useLibraryRuntimeActions';
import { usePlaybackStore } from '../features/playback/store';
import { usePlayerCore } from '../features/playback/playerCore';
import { isOnlineStreamPath } from '../features/playback/onlineFailover';
import { QUALITY_META } from '../types';
import type { Song, QualityKey, DownloadQuality, DownloadFileNameStyle } from '../types';

export interface DownloadLocalOptions { // 实现
  quality?: DownloadQuality; // 实现
  downloadDir?: string; // 实现
  downloadAudio?: boolean; // 实现
  downloadLyrics?: boolean; // 实现
  downloadCover?: boolean; // 实现
  fileNameStyle?: DownloadFileNameStyle;
  preResolvedUrls?: Partial<Record<QualityKey, string>>;
}

export async function downloadToLocal(
  song: Song,
  options?: DownloadLocalOptions, // 实现
): Promise<boolean> {
  const { showToast } = useToast();
  const { settings } = useSettings();
  const downloadStore = useDownloadStore();

  if (!isDownloadableOnlineSong(song)) {
    showToast('该歌曲不是可下载的在线歌曲', 'info');
    return false;
  }

  const downloadDir = options?.downloadDir || settings.value.download.downloadPath; // 实现
  if (!downloadDir) {
    showToast('请先在设置 - 下载中选择下载目录', 'error');
    return false;
  }

  const downloadAudio = options?.downloadAudio ?? true; // 实现
  const downloadLyrics = options?.downloadLyrics ?? settings.value.download.downloadLyrics; // 实现
  const downloadCover = options?.downloadCover ?? settings.value.download.embedCover; // 实现
  const fileNameStyle = options?.fileNameStyle ?? settings.value.download.fileNameStyle;

  if (!downloadAudio && !downloadLyrics && !downloadCover) { // 实现
    showToast('请至少选择一项下载内容', 'info'); // 实现
    return false;
  }

  const songPath = song.cue_source_path || song.path; // 实现
  const songLabel = song.title || song.name || '未知歌曲';

  const quality = options?.quality // 实现
    ?? (settings.value.download.quality as DownloadQuality)
    ?? '320k';

  downloadStore.beginDownload(songPath);
  showToast(`开始下载：${songLabel}`, 'info');

  try {
    if (downloadAudio) { // 实现
      const result = await downloadSong(song, { // 实现
        quality,
        qualityFallbackBehavior: settings.value.download.qualityFallbackBehavior,
        downloadDir, // 实现
        keepSourceFilename: settings.value.download.keepSourceFilename, // 实现
        fileNameStyle,
        overwriteExisting: settings.value.download.overwriteExisting, // 实现
        downloadLyrics, // 实现
        lyricsFormat: settings.value.download.lyricsFormat, // 实现
        lyricsStyle: settings.value.download.lyricsStyle, // 实现
        embedMetadata: settings.value.download.embedMetadata, // 实现
        embedLyrics: settings.value.download.embedLyrics, // 实现
        embedCover: settings.value.download.embedCover, // 实现
        downloadCover, // 实现
        preResolvedUrls: options?.preResolvedUrls,
        onProgress: (percent: number) => downloadStore.setProgress(percent), // 实现
      });

      await recordDownload({ // 实现
        songPath,
        filePath: result.filePath, // 实现
        fileName: fileNameFromPath(result.filePath), // 实现
        quality: result.hitQuality, // 实现
        downloadedAt: Date.now(), // 实现
        title: song.title || song.name, // 实现
        artist: song.artist, // 实现
        durationMs: Math.round((song.duration || 0) * 1000),
      });

      const hitMeta = QUALITY_META[result.hitQuality as QualityKey]; // 实现
      const selectedMeta = QUALITY_META[quality as QualityKey]; // 实现
      const degraded = selectedMeta && hitMeta // 实现
        ? hitMeta.rank < selectedMeta.rank // 实现
        : result.hitQuality !== quality; // 实现
      const extras: string[] = []; // 实现
      if (result.lyricsSaved) extras.push('含歌词'); // 实现
      if (result.coverSaved) extras.push('含封面'); // 实现
      const extraNote = extras.length > 0 ? `（${extras.join('、')}）` : ''; // 实现
      const note = degraded // 实现
        ? `（实际下载音质：${hitMeta?.label ?? result.hitQuality}）` // 实现
        : '';
      showToast(`下载完成${note}${extraNote}`, degraded ? 'info' : 'success'); // 实现

      // 下载完成联运（对齐移动端 _switchCurrentToLocalAfterDownload）：
      // 刚下载的正是正在播放的在线歌 → 保进度无缝切本地源；暂停态切换后维持暂停。
      try {
        const playbackStore = usePlaybackStore();
        const current = playbackStore.currentSong;
        const currentKey = current ? (current.cue_source_path || current.path) : '';
        if (current && currentKey === songPath && isOnlineStreamPath(currentKey)) {
          const wasPlaying = playbackStore.isPlaying;
          console.info(`[Download] 当前播放歌曲已下载，切换本地源: ${result.filePath} @${playbackStore.currentTime.toFixed(1)}s`);
          const { playSong, pauseSong } = usePlayerCore().playbackDomain;
          await playSong(current, {
            startTime: playbackStore.currentTime,
            continueStatisticsSession: true,
            forceReplay: true,
            preserveQueue: true,
          });
          if (!wasPlaying && playbackStore.isPlaying) {
            await pauseSong();
          }
        }
      } catch (e: any) {
        console.warn('[Download] 下载完成后切换本地播放源失败:', e?.message);
      }
    } else {
      const result = await downloadSongExtras(song, { // 实现
        downloadDir, // 实现
        fileNameStyle,
        downloadLyrics, // 实现
        lyricsFormat: settings.value.download.lyricsFormat, // 实现
        lyricsStyle: settings.value.download.lyricsStyle, // 实现
        downloadCover, // 实现
      });

      const extras: string[] = []; // 实现
      if (result.lyricsSaved) extras.push('歌词'); // 实现
      if (result.coverSaved) extras.push('封面'); // 实现
      const extraNote = extras.length > 0 ? `（${extras.join('、')}）` : ''; // 实现
      showToast(`下载完成${extraNote}`, 'success'); // 实现
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
