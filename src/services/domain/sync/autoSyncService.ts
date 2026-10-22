import type { AppSettings } from '../../../types';
import { fetchServerListenSummary } from '../leaderboardReport';

// ==================== 端口（由 UI 层注入各域流程与登录同步状态） ====================

interface AutoSyncTaskSet {
  uploadPlaylists(): Promise<unknown>;
  downloadPlaylistsOnly(): Promise<unknown>;
  uploadPluginsOnly(options?: { silent?: boolean }): Promise<unknown>;
  downloadPluginsOnly(options?: { silent?: boolean }): Promise<unknown>;
  uploadFavoritesOnly(options?: { silent?: boolean }): Promise<unknown>;
  uploadSettingsOnly(options?: { silent?: boolean }): Promise<unknown>;
  syncPlaylists(): Promise<unknown>;
  syncPlugins(): Promise<unknown>;
  syncFavorites(options?: { silent?: boolean }): Promise<unknown>;
  syncSettings(): Promise<unknown>;
  syncCloudCreds(): Promise<unknown>;
  uploadHistoryOnly(): Promise<unknown>;
  downloadHistoryOnly(): Promise<unknown>;
}

export interface AutoSyncFlowDeps {
  getUploadConfig(): AppSettings['upload'];
  tasks: AutoSyncTaskSet;
  statistics: { refreshBehaviorOnly(range: string): Promise<unknown> };
  isLoginSyncCompleted(): boolean;
  markLoginSyncCompleted(): void;
  log(msg: string, ...args: unknown[]): void;
  logError(msg: string, ...args: unknown[]): void;
}

// 模块级并发闸（跨 composable 实例共享，语义与迁出前一致）
let loginSyncInProgress = false;
let syncOperationInProgress = false;

// ==================== 流程（自动同步编排核心） ====================

export function createAutoSyncFlow(deps: AutoSyncFlowDeps) {
  async function performAutoSync(): Promise<void> {
    if (syncOperationInProgress) {
      deps.log('performAutoSync: 其他同步流程进行中，跳过本次自动同步');
      return;
    }
    syncOperationInProgress = true;
    try {
      deps.log('performAutoSync: 开始自动同步（先拉后推，对齐移动端）');
      const upload = deps.getUploadConfig();
      let hasError = false;

      // 串行执行各域同步：此前并行会让「全局互斥」在域间互相锁住（插件/收藏/
      // 设置被并行在途的其他域挡掉，还误报「请先登录后再同步」），串行保证
      // 每个域每周期都真正同步，且对 2C2G 服务器更友好
      const syncTasks: Array<{ label: string; run: () => Promise<unknown> }> = [];
      // 网盘凭据周期拉取：其他端绑定/轮换的变更及时到达本端；
      // LWW 门控在 syncCloudCreds 内部（本地较新跳过下发，无变化不落盘）
      syncTasks.push({ label: '同步网盘账号', run: deps.tasks.syncCloudCreds });
      // 统一「先拉后推」（对齐移动端 _sync_all）：其他设备推上云的变更在本
      // 周期内即可到达，不再只靠登录时的一次性全量同步；各域 download 内部
      // 有内容对比，无变化不落盘，成本可控。设置域维持仅上传（两端口径一致）
      if (upload.playlists) {
        syncTasks.push({
          label: '同步歌单',
          run: async () => {
            await deps.tasks.downloadPlaylistsOnly();
            await deps.tasks.uploadPlaylists();
          },
        });
      }
      if (upload.plugins) {
        syncTasks.push({
          label: '同步插件',
          run: async () => {
            // silent: 自动同步静默执行，结果 toast 仅手动同步弹出
            await deps.tasks.downloadPluginsOnly({ silent: true });
            await deps.tasks.uploadPluginsOnly({ silent: true });
          },
        });
      }
      if (upload.favorites) {
        syncTasks.push({
          label: '同步收藏',
          run: () => deps.tasks.syncFavorites({ silent: true }),
        });
      }
      if (upload.settings) {
        syncTasks.push({ label: '上传设置', run: () => deps.tasks.uploadSettingsOnly({ silent: true }) });
      }
      // 播放历史云同步（对齐移动端，不受 upload 开关门控）：先拉后推，
      // 下载仅补本地缺失条目
      syncTasks.push({
        label: '同步播放历史',
        run: async () => {
          await deps.tasks.downloadHistoryOnly();
          await deps.tasks.uploadHistoryOnly();
        },
      });

      for (const task of syncTasks) {
        try {
          await task.run();
        } catch (e) {
          deps.logError(`performAutoSync: ${task.label}失败`, e);
          hasError = true;
        }
      }

      deps.log('performAutoSync: 上传完成，开始拉取云端听歌统计');
      try {
        await fetchServerListenSummary();
        await deps.statistics.refreshBehaviorOnly('All');
      } catch (e) {
        deps.logError('performAutoSync: 云端听歌统计拉取失败', e);
        hasError = true;
        await deps.statistics.refreshBehaviorOnly('All').catch(() => undefined);
      }

      deps.log('performAutoSync: 自动同步完成');
      if (hasError) {
        throw new Error('部分同步项失败');
      }
    } finally {
      syncOperationInProgress = false;
    }
  }

  async function syncOnLoginSuccess(): Promise<void> {
    if (deps.isLoginSyncCompleted()) {
      deps.log('syncOnLoginSuccess: 首次登录同步已完成，跳过');
      return;
    }
    if (loginSyncInProgress) return;
    if (syncOperationInProgress) {
      deps.log('syncOnLoginSuccess: 其他同步流程进行中，跳过本次登录同步');
      return;
    }
    loginSyncInProgress = true;
    syncOperationInProgress = true;
    deps.log('========== 首次登录全量同步开始 ==========');
    const upload = deps.getUploadConfig();
    try {
      // 串行执行（理由同 performAutoSync：并行会被全局互斥互相锁住）
      const tasks: Array<{ label: string; run: () => Promise<unknown> }> = [];
      if (upload.playlists) {
        tasks.push({ label: '同步歌单', run: deps.tasks.syncPlaylists });
      }
      if (upload.plugins) {
        tasks.push({ label: '同步插件', run: deps.tasks.syncPlugins });
      }
      if (upload.favorites) {
        tasks.push({ label: '同步收藏', run: deps.tasks.syncFavorites });
      }
      for (const task of tasks) {
        try {
          await task.run();
        } catch (e) {
          deps.logError(`syncOnLoginSuccess: ${task.label}失败`, e);
        }
      }
      try {
        await fetchServerListenSummary();
        await deps.statistics.refreshBehaviorOnly('All');
      } catch (e) {
        deps.logError('syncOnLoginSuccess: 云端听歌统计拉取失败', e);
        await deps.statistics.refreshBehaviorOnly('All').catch(() => undefined);
      }
      if (upload.settings) {
        try {
          await deps.tasks.syncSettings();
        } catch (e) {
          deps.logError('syncOnLoginSuccess: 首次设置同步失败', e);
        }
      }
    } catch (e) {
      deps.logError('syncOnLoginSuccess: 首次全量同步异常', e);
    } finally {
      deps.markLoginSyncCompleted();
      loginSyncInProgress = false;
      syncOperationInProgress = false;
      deps.log('========== 首次登录全量同步结束 ==========');
    }
  }

  return {
    performAutoSync,
    syncOnLoginSuccess,
  };
}
