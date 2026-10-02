import type { QualityKey, OnlineQualityFallbackBehavior, Song } from '../../types';
import { checkDownloadExists, findDownloadedFileFuzzy } from '../../services/domain/downloadHistory';
import {
  getOnlineAvailableQualities,
  resolveOnlineAudio,
  type ResolveOnlineAudioResult,
} from './onlinePlaybackResolver';
import { isOnlineStreamPath } from './onlineFailover';

export interface PrepareOnlinePlaybackInput {
  audioFilePath: string;
  song: Song;
  requestedQuality: QualityKey;
  fallbackBehavior: OnlineQualityFallbackBehavior;
  preFetchedUrl?: string | null;
}

export interface PreparedOnlinePlayback {
  audioFilePath: string;
  usingDownloadedAudioFile: boolean;
  availableQualities: QualityKey[] | null;
  resolvedOnlineAudio: ResolveOnlineAudioResult | null;
}

export interface OnlinePlaybackPreparationDeps {
  checkDownloaded: typeof checkDownloadExists;
  findFuzzyDownloaded: typeof findDownloadedFileFuzzy;
  getAvailableQualities: typeof getOnlineAvailableQualities;
  resolveAudio: typeof resolveOnlineAudio;
}

const defaultDeps: OnlinePlaybackPreparationDeps = {
  checkDownloaded: checkDownloadExists,
  findFuzzyDownloaded: findDownloadedFileFuzzy,
  getAvailableQualities: getOnlineAvailableQualities,
  resolveAudio: resolveOnlineAudio,
};

export async function prepareOnlinePlayback(
  input: PrepareOnlinePlaybackInput,
  deps: OnlinePlaybackPreparationDeps = defaultDeps,
): Promise<PreparedOnlinePlayback> {
  let preparedAudioFilePath = input.audioFilePath;
  let preparedUsingDownloadedAudioFile = false;
  let preparedAvailableQualities: QualityKey[] | null = null;

  const downloadedRecord = await deps.checkDownloaded(preparedAudioFilePath);
  if (downloadedRecord?.filePath) {
    preparedAudioFilePath = downloadedRecord.filePath;
    preparedUsingDownloadedAudioFile = true;
  }

  // 跨源模糊匹配兜底（对齐移动端）：精确播链键未命中时，按"标题+歌手+时长±3s"
  // 找同一首歌其他源的已下载本地文件。仅对在线播链生效，本地歌零额外开销。
  if (!preparedUsingDownloadedAudioFile && isOnlineStreamPath(preparedAudioFilePath)) {
    try {
      const fuzzyFilePath = await deps.findFuzzyDownloaded({
        title: input.song.title || input.song.name,
        artist: input.song.artist,
        durationMs: Math.round((input.song.duration || 0) * 1000),
        excludeSongPath: preparedAudioFilePath,
      });
      if (fuzzyFilePath) {
        preparedAudioFilePath = fuzzyFilePath;
        preparedUsingDownloadedAudioFile = true;
      }
    } catch (error) {
      console.warn('[Audio] 下载记录模糊匹配失败，回退在线解析:', error);
    }
  }

  if (!preparedUsingDownloadedAudioFile) {
    try {
      preparedAvailableQualities = await deps.getAvailableQualities(preparedAudioFilePath, input.song);
    } catch {
      // 音质列表获取失败不应阻断播放准备。
    }

    const resolvedOnlineAudio = await deps.resolveAudio({
      audioFilePath: preparedAudioFilePath,
      song: input.song,
      requestedQuality: input.requestedQuality,
      fallbackBehavior: input.fallbackBehavior,
      availableQualities: preparedAvailableQualities,
      preFetchedUrl: input.preFetchedUrl,
    });

    return {
      audioFilePath: resolvedOnlineAudio.audioFilePath,
      usingDownloadedAudioFile: false,
      availableQualities: preparedAvailableQualities,
      resolvedOnlineAudio,
    };
  }

  return {
    audioFilePath: preparedAudioFilePath,
    usingDownloadedAudioFile: true,
    availableQualities: null,
    resolvedOnlineAudio: null,
  };
}
