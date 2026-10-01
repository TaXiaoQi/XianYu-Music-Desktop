import type { QualityKey, OnlineQualityFallbackBehavior, Song } from '../../types';
import { checkDownloadExists } from '../../services/domain/downloadHistory';
import {
  getOnlineAvailableQualities,
  resolveOnlineAudio,
  type ResolveOnlineAudioResult,
} from './onlinePlaybackResolver';

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
  getAvailableQualities: typeof getOnlineAvailableQualities;
  resolveAudio: typeof resolveOnlineAudio;
}

const defaultDeps: OnlinePlaybackPreparationDeps = {
  checkDownloaded: checkDownloadExists,
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
