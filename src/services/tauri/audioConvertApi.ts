import { tauriInvoke } from './invoke';
import type { ConvertAudioResult, FfmpegDetection } from './contracts';

export const audioConvertApi = {
  detectFfmpeg: (ffmpegPath?: string): Promise<FfmpegDetection> =>
    tauriInvoke('detect_ffmpeg', ffmpegPath ? { ffmpegPath } : {}),
  convertAudio: (
    inputPaths: string[],
    outDir: string,
    targetFormat: string,
    opts?: { ffmpegPath?: string; outName?: string; sampleRate?: number },
  ): Promise<ConvertAudioResult[]> =>
    tauriInvoke('convert_audio', {
      inputPaths,
      outDir,
      targetFormat,
      ...(opts?.ffmpegPath ? { ffmpegPath: opts.ffmpegPath } : {}),
      ...(opts?.outName ? { outName: opts.outName } : {}),
      ...(opts && opts.sampleRate ? { sampleRate: opts.sampleRate } : {}),
    }),
};
export type { ConvertAudioResult, FfmpegDetection };