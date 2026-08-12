import { tauriInvoke } from './invoke';
import type {
  FinalizeDownloadExtrasRequestContract,
  FinalizeDownloadExtrasResultContract,
  ProbeUrlInfoContract,
} from './contracts';

/**
 * 下载服务 Tauri 命令的类型安全封装。
 *
 * 所有下载路径解析、文件名计算、流式下载、收尾编排、播放缓存复用、
 * 下载记录持久化等 IPC 调用均通过此模块发出，确保 payload/response 类型正确。
 */
export const downloadApi = {
  // ===== 路径与命名规则（权威实现在 Rust toolbox.rs）=====

  /** 在目标目录中解析非冲突文件路径（自动追加 (1)/(2)… 直到不冲突） */
  resolveDownloadPath: (directory: string, fileName: string, overwriteExisting: boolean) =>
    tauriInvoke('resolve_download_path', { directory, fileName, overwriteExisting }) as Promise<string>,

  /** 构建下载文件名并解析非冲突完整路径（单次 IPC，合并文件名计算 + 路径冲突检测） */
  resolveDownloadFullPath: (
    directory: string,
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
      directory,
      title,
      artist,
      album,
      url,
      quality,
      keepSourceFilename,
      fileNameStyle,
      overwriteExisting,
    }) as Promise<string>,

  /** 构建下载附件（歌词/封面）的清洗后基名（不含扩展名） */
  buildDownloadBasename: (title: string, artist: string, album: string, fileNameStyle: string) =>
    tauriInvoke('build_download_basename', {
      title,
      artist,
      album,
      fileNameStyle,
    }) as Promise<string>,

  // ===== 下载执行 =====

  /** 使用 Rust reqwest 流式下载在线歌曲到目标路径（支持 QMC2 解密和自定义请求头） */
  downloadOnlineSong: (
    url: string,
    destPath: string,
    ekey?: string | null,
    headers?: Record<string, string> | null,
  ) =>
    tauriInvoke('download_online_song', {
      url,
      destPath,
      ekey: ekey || null,
      headers: headers || null,
    }) as Promise<string>,

  /** 原地解密 QMC2 加密文件（用于缓存复用路径：复制播放缓存后解密） */
  decryptQmcFile: (filePath: string, ekey?: string | null) =>
    tauriInvoke('decrypt_qmc_file', {
      filePath,
      ekey: ekey || null,
    }) as Promise<boolean>,

  /** 下载后收尾编排：歌词保存 + 封面下载保存 + 元数据嵌入（单次 IPC） */
  finalizeDownloadExtras: (request: FinalizeDownloadExtrasRequestContract) =>
    tauriInvoke('finalize_download_extras', { request }) as Promise<FinalizeDownloadExtrasResultContract>,

  /** 用 Range: bytes=0-0 探测直链文件大小 */
  probeUrlSize: (url: string) =>
    tauriInvoke('probe_url_size', { url }) as Promise<ProbeUrlInfoContract>,

  /** 将字节数据写入指定路径（通用保存，用于头像等小文件） */
  saveDownloadBytes: (data: number[], destPath: string) =>
    tauriInvoke('save_download_bytes', { data, destPath }) as Promise<string>,

  /** 通过 Rust 后端下载图片字节，避免渲染进程直接放开任意网络 fetch */
  fetchImageBytes: (url: string) =>
    tauriInvoke('fetch_image_bytes', { url }) as Promise<{ data: number[]; mime: string }>,

  // ===== 播放缓存复用 =====

  /** 检查指定 URL 的播放缓存是否已下载完成 */
  isStreamCached: (url: string) =>
    tauriInvoke('is_stream_cached', { url }) as Promise<boolean>,

  /** 将指定 URL 的播放缓存复制为目标下载文件 */
  copyStreamCache: (url: string, destPath: string) =>
    tauriInvoke('copy_stream_cache', { url, destPath }) as Promise<number>,

  // ===== 下载记录持久化 =====

  /** 读取下载记录 JSON 文本 */
  readDownloadHistory: () =>
    tauriInvoke('read_download_history') as Promise<string>,

  /** 写入下载记录 JSON 文本（整体覆盖） */
  writeDownloadHistory: (content: string) =>
    tauriInvoke('write_download_history', { content }),

  // ===== 通用文件操作 =====

  /** 检查文件是否存在 */
  fileExists: (path: string) =>
    tauriInvoke('file_exists', { path }) as Promise<boolean>,

  /** 保存下载歌词文件 */
  saveDownloadLyrics: (content: string, destPath: string) =>
    tauriInvoke('save_download_lyrics', { content, destPath }) as Promise<string>,
};
