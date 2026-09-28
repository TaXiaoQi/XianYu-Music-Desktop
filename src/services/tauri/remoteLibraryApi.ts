// 远程音源（WebDAV / SMB 等）库管理的后端接口封装。
// 命令名与载荷键名须与 src-tauri 侧保持一致；返回类型均已在命令映射表中登记。
import type { RemoteCacheUsage, RemoteConnectionResult, RemoteFileEntry, RemoteSource, RemoteSourceInput, RemoteSyncResult } from '../../types';
import { tauriInvoke as callTauri } from './invoke';

export const remoteLibraryApi = {
  /** 列出全部已配置的远程音源。 */
  getRemoteSources(): Promise<RemoteSource[]> {
    return callTauri('get_remote_sources');
  },

  /** 测试远程音源的连通性。 */
  testRemoteSource(source: RemoteSourceInput): Promise<RemoteConnectionResult> {
    return callTauri('test_remote_source', { source });
  },

  /** 新增一个远程音源。 */
  addRemoteSource(source: RemoteSourceInput): Promise<RemoteSource> {
    return callTauri('add_remote_source', { source });
  },

  /** 更新一个已存在的远程音源配置。 */
  updateRemoteSource(source: RemoteSourceInput): Promise<RemoteSource> {
    return callTauri('update_remote_source', { source });
  },

  /** 删除指定 id 的远程音源。 */
  removeRemoteSource(sourceId: string): Promise<void> {
    return callTauri('remove_remote_source', { sourceId });
  },

  /** 触发一次远程音源同步。 */
  syncRemoteSource(sourceId: string): Promise<RemoteSyncResult> {
    return callTauri('sync_remote_source', { sourceId });
  },

  /** 预缓存一首远程曲目。 */
  precacheRemoteSong(remoteUri: string): Promise<void> {
    return callTauri('precache_remote_song', { remoteUri });
  },

  /** 查询远程缓存占用情况。 */
  getRemoteCacheUsage(): Promise<RemoteCacheUsage> {
    return callTauri('get_remote_cache_usage');
  },

  /** 清空远程缓存，返回清理后的占用情况。 */
  clearRemoteCache(): Promise<RemoteCacheUsage> {
    return callTauri('clear_remote_cache');
  },

  /** 列出远程目录下的条目。 */
  listRemoteDirectory(sourceId: string, path: string): Promise<RemoteFileEntry[]> {
    return callTauri('list_remote_directory', { sourceId, path });
  },
};
