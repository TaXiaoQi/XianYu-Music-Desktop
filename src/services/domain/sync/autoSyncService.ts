import type { AppSettings } from '../../../types';
import { syncListenStats } from '../listenStatsSync';

// ==================== 端口（由 UI 层注入各域流程与登录同步状态） ====================

export interface AutoSyncTaskSet {
  uploadPlaylists(): Promise<unknown>;
  uploadPluginsOnly(): Promise<unknown>;
  uploadFavoritesOnly(): Promise<unknown>;
  uploadSettingsOnly(): Promise<unknown>;
  syncPlaylists(): Promise<unknown>;
  syncPlugins(): Promise<unknown>;
  syncFavorites(): Promise<unknown>;
  syncSettings(): Promise<unknown>;
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
      deps.log('performAutoSync: 开始自动同步（客户端为主，只上传）');
      const upload = deps.getUploadConfig();
      let hasError = false;

      const parallelTasks: Array<{ label: string; run: () => Promise<unknown> }> = [];
      if (upload.playlists) {
        parallelTasks.push({ label: '上传歌单', run: deps.tasks.uploadPlaylists });
      }
      if (upload.plugins) {
        parallelTasks.push({ label: '上传插件', run: deps.tasks.uploadPluginsOnly });
      }
      if (upload.favorites) {
        parallelTasks.push({ label: '上传收藏', run: deps.tasks.uploadFavoritesOnly });
      }
      if (upload.settings) {
        parallelTasks.push({ label: '上传设置', run: deps.tasks.uploadSettingsOnly });
      }

      if (parallelTasks.length > 0) {
        const results = await Promise.allSettled(parallelTasks.map(task => task.run()));
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            deps.logError(`performAutoSync: ${parallelTasks[index].label}失败`, result.reason);
            hasError = true;
          }
        });
      }

      deps.log('performAutoSync: 上传完成，开始听歌时长快照同步');
      try {
        await syncListenStats();
        await deps.statistics.refreshBehaviorOnly('All');
      } catch (e) {
        deps.logError('performAutoSync: 听歌时长快照同步失败', e);
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
      if (tasks.length > 0) {
        await Promise.allSettled(tasks.map(task => task.run()));
      }
      try {
        await syncListenStats();
        await deps.statistics.refreshBehaviorOnly('All');
      } catch (e) {
        deps.logError('syncOnLoginSuccess: 听歌时长快照同步失败', e);
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
