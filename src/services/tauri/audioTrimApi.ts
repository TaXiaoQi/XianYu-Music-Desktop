import { tauriInvoke } from './invoke';
import type { TrimAudioResult } from './contracts';

export const audioTrimApi = {
  probeDuration: (inputPath: string, ffmpegPath?: string): Promise<number> =>
    tauriInvoke('probe_audio_duration', {
      inputPath,
      ...(ffmpegPath ? { ffmpegPath } : {}),
    }),
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