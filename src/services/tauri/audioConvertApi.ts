import { tauriInvoke } from './invoke';
import type { ConvertAudioResult, FfmpegDetection } from './contracts';

/** 工具箱 · 文件转换：调用系统 ffmpeg 做本地音频格式转换 */
export const audioConvertApi = {
  /** 检测 ffmpeg；可选传入手动指定的可执行文件路径（否则按 PATH 查找） */
  detectFfmpeg: (ffmpegPath?: string): Promise<FfmpegDetection> =>
    tauriInvoke('detect_ffmpeg', ffmpegPath ? { ffmpegPath } : {}),
  /** 批量转换：把 inputPaths 的文件转为 targetFormat，输出到 outDir。targetFormat 取自后端白名单 */
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