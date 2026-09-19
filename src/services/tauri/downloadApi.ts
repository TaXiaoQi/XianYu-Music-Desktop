import { tauriInvoke } from './invoke';
import type {
  FinalizeDownloadExtrasRequestContract,
  FinalizeDownloadExtrasResultContract,
  ProbeUrlInfoContract,
} from './contracts';

export interface SaveDialogFilterContract {
  name: string;
  extensions: string[];
}

export const downloadApi = {
  // ===== 路径与命名规则（权威实现在 Rust toolbox.rs）=====

  resolveDownloadPath: (fileName: string, overwriteExisting: boolean) =>
    tauriInvoke('resolve_download_path', { fileName, overwriteExisting }) as Promise<string>,

  resolveDownloadFullPath: (
    title: string,
    artist: string,
    album: string,
    url: string,
    quality: string,
    keepSourceFilename: boolean,
    fileNameStyle: string,
    overwriteExisting: boolean,
  ) =>
    tauriInvoke('resolve_download_full_path', {
      title,
      artist,
      album,
      url,
      quality,
      keepSourceFilename,
      fileNameStyle,
      overwriteExisting,
    }) as Promise<string>,

  buildDownloadBasename: (title: string, artist: string, album: string, fileNameStyle: string) =>
    tauriInvoke('build_download_basename', {
      title,
      artist,
      album,
      fileNameStyle,
    }) as Promise<string>,

  // ===== 下载执行（目标文件名相对于授权下载目录）=====

  downloadOnlineSong: (
    url: string,
    fileName: string,
    ekey?: string | null,
    headers?: Record<string, string> | null,
  ) =>
    tauriInvoke('download_online_song', {
      url,
      fileName,
      ekey: ekey || null,
      headers: headers || null,
    }) as Promise<string>,

  decryptQmcFile: (filePath: string, ekey?: string | null) =>
    tauriInvoke('decrypt_qmc_file', {
      filePath,
      ekey: ekey || null,
    }) as Promise<boolean>,

  finalizeDownloadExtras: (request: FinalizeDownloadExtrasRequestContract) =>
    tauriInvoke('finalize_download_extras', { request }) as Promise<FinalizeDownloadExtrasResultContract>,

  probeUrlSize: (url: string) =>
    tauriInvoke('probe_url_size', { url }) as Promise<ProbeUrlInfoContract>,

  fetchImageBytes: (url: string) =>
    tauriInvoke('fetch_image_bytes', { url }) as Promise<{ data: number[]; mime: string }>,

  // ===== 播放缓存复用 =====

  isStreamCached: (url: string) =>
    tauriInvoke('is_stream_cached', { url }) as Promise<boolean>,

  copyStreamCache: (url: string, fileName: string) =>
    tauriInvoke('copy_stream_cache', { url, fileName }) as Promise<number>,

  // ===== 下载记录持久化 =====

  readDownloadHistory: () =>
    tauriInvoke('read_download_history') as Promise<string>,

  writeDownloadHistory: (content: string) =>
    tauriInvoke('write_download_history', { content }),

  // ===== 通用文件操作 =====

  fileExists: (path: string) =>
    tauriInvoke('file_exists', { path }) as Promise<boolean>,

  // ===== 原生对话框导出（路径不经过前端）=====

  registerDownloadDirectory: () =>
    tauriInvoke('register_download_directory') as Promise<string>,

  saveTextViaDialog: (
    defaultFileName: string,
    filter: SaveDialogFilterContract | null,
    content: string,
  ) =>
    tauriInvoke('save_text_via_dialog', {
      defaultFileName,
      filter: filter ?? null,
      content,
    }) as Promise<string | null>,

  saveBytesViaDialog: (
    defaultFileName: string,
    filter: SaveDialogFilterContract | null,
    data: number[],
  ) =>
    tauriInvoke('save_bytes_via_dialog', {
      defaultFileName,
      filter: filter ?? null,
      data,
    }) as Promise<string | null>,
};
