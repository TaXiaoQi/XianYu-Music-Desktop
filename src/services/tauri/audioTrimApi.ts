import { tauriInvoke } from './invoke';
import type { TrimAudioResult } from './contracts';

/** 工具箱 · 音频剪辑：调用系统 ffmpeg 探测时长并做本地无损剪切 */
export const audioTrimApi = {
  /** 探测单个音频文件时长（秒） */
  probeDuration: (inputPath: string, ffmpegPath?: string): Promise<number> =>
    tauriInvoke('probe_audio_duration', {
      inputPath,
      ...(ffmpegPath ? { ffmpegPath } : {}),
    }),
  /** 无损剪切音频区间 [startSecs, endSecs]，输出到 outputDir（缺省为原文件同目录） */
  trimAudio: (
    inputPath: string,
    startSecs: number,
    endSecs: number,
    opts?: { outputDir?: string; ffmpegPath?: string },
  ): Promise<TrimAudioResult> =>
    tauriInvoke('trim_audio', {
      inputPath,
      startSecs,
      endSecs,
      ...(opts?.outputDir ? { outputDir: opts.outputDir } : {}),
      ...(opts?.ffmpegPath ? { ffmpegPath: opts.ffmpegPath } : {}),
    }),
};
export type { TrimAudioResult };