import {
  downloadPlugins,
  uploadPlugins,
  type PluginSyncResult,
} from '../pluginSync';
import type { ToastKind } from './toastKind';

// ==================== 端口（由 UI 层注入状态与反馈） ====================

export interface PluginSyncFlowDeps {
  canSync(): boolean;
  isUploadEnabled(): boolean;
  onProgress(msg: string): void;
  notify(msg: string, kind: ToastKind): void;
  setSyncing(v: boolean): void;
  setLastResult(result: PluginSyncResult | null): void;
  setLastTime(time: number): void;
  log(msg: string, ...args: unknown[]): void;
  logError(msg: string, ...args: unknown[]): void;
}

// ==================== 流程（业务决策与 IO，UI 状态经端口写入） ====================

export function createPluginSyncFlow(deps: PluginSyncFlowDeps) {
  async function syncPlugins(): Promise<PluginSyncResult> {
    deps.log('========== syncPlugins 开始 ==========');
    if (!deps.canSync()) {
      deps.logError('syncPlugins: 未登录或无弦予号，取消同步');
      deps.notify('请先登录后再同步', 'error');
      return { uploadedPlugins: 0, downloadedPlugins: 0, syncedSubscriptions: 0, errors: ['未登录'] };
    }

    deps.setSyncing(true);
    deps.onProgress('正在同步插件...');
    deps.setLastResult(null);

    try {
      let uploadResult: PluginSyncResult = {
        uploadedPlugins: 0,
        downloadedPlugins: 0,
        syncedSubscriptions: 0,
        errors: [],
      };
      if (deps.isUploadEnabled()) {
        deps.log('syncPlugins: 步骤 1/2 - 开始上传插件');
        deps.onProgress('正在上传插件到云端...');
        uploadResult = await uploadPlugins();
        deps.log('syncPlugins: 步骤 1/2 - 上传插件完成', uploadResult);
      } else {
        deps.log('syncPlugins: 步骤 1/2 - 插件上传未开启，跳过');
      }

      deps.log('syncPlugins: 步骤 2/2 - 开始下载插件');
      deps.onProgress('正在从云端恢复插件...');
      const downloadResult = await downloadPlugins();
      deps.log('syncPlugins: 步骤 2/2 - 下载插件完成', downloadResult);

      const combined: PluginSyncResult = {
        uploadedPlugins: uploadResult.uploadedPlugins,
        downloadedPlugins: downloadResult.downloadedPlugins,
        syncedSubscriptions: downloadResult.syncedSubscriptions,
        errors: [...uploadResult.errors, ...downloadResult.errors],
      };

      deps.setLastResult(combined);
      deps.setLastTime(Date.now());

      deps.log(`syncPlugins 完成: uploaded=${combined.uploadedPlugins}, downloaded=${combined.downloadedPlugins}, errors=${combined.errors.length}`);
      if (combined.errors.length > 0) {
        combined.errors.forEach((err, idx) => deps.logError(`syncPlugins error[${idx}]: ${err}`));
      }

      if (combined.errors.length > 0) {
        deps.notify(`插件同步完成（${combined.errors.length} 个错误）`, 'error');
      } else {
        const parts: string[] = [];
        if (combined.uploadedPlugins > 0) parts.push(`上传 ${combined.uploadedPlugins} 个插件`);
        if (combined.downloadedPlugins > 0) parts.push(`恢复 ${combined.downloadedPlugins} 个插件`);
        if (combined.syncedSubscriptions > 0) parts.push(`同步 ${combined.syncedSubscriptions} 个订阅`);
        deps.notify(parts.length > 0 ? `插件同步完成：${parts.join('，')}` : '插件已是最新', 'success');
      }

      deps.log('========== syncPlugins 结束 ==========');
      return combined;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.logError(`syncPlugins 异常: ${msg}`, error);
      deps.notify(`插件同步失败：${msg}`, 'error');
      return { uploadedPlugins: 0, downloadedPlugins: 0, syncedSubscriptions: 0, errors: [msg] };
    } finally {
      deps.setSyncing(false);
      deps.onProgress('');
    }
  }

  async function uploadPluginsOnly(): Promise<void> {
    deps.log('========== uploadPluginsOnly 开始 ==========');
    if (!deps.canSync()) {
      deps.logError('uploadPluginsOnly: 未登录或无弦予号');
      deps.notify('请先登录后再同步', 'error');
      return;
    }

    if (!deps.isUploadEnabled()) {
      deps.log('uploadPluginsOnly: 插件上传未开启');
      deps.notify('插件同步已关闭，请在设置中开启', 'info');
      return;
    }

    deps.setSyncing(true);
    deps.onProgress('正在上传插件到云端...');

    try {
      const result = await uploadPlugins();
      deps.setLastTime(Date.now());
      deps.setLastResult(result);
      deps.log(`uploadPluginsOnly 完成: uploadedPlugins=${result.uploadedPlugins}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        deps.notify(`插件上传完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.uploadedPlugins > 0) {
        deps.notify(`已上传 ${result.uploadedPlugins} 个插件`, 'success');
      } else {
        deps.notify('插件已同步，无需上传', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.logError(`uploadPluginsOnly 异常: ${msg}`, error);
      deps.notify(`插件上传失败：${msg}`, 'error');
    } finally {
      deps.setSyncing(false);
      deps.onProgress('');
    }
  }

  async function downloadPluginsOnly(): Promise<void> {
    deps.log('========== downloadPluginsOnly 开始 ==========');
    if (!deps.canSync()) {
      deps.logError('downloadPluginsOnly: 未登录或无弦予号');
      deps.notify('请先登录后再同步', 'error');
      return;
    }

    deps.setSyncing(true);
    deps.onProgress('正在从云端下载插件...');

    try {
      const result = await downloadPlugins();
      deps.setLastTime(Date.now());
      deps.setLastResult(result);
      deps.log(`downloadPluginsOnly 完成: downloadedPlugins=${result.downloadedPlugins}, errors=${result.errors.length}`);

      if (result.errors.length > 0) {
        deps.notify(`插件下载完成（${result.errors.length} 个错误）`, 'error');
      } else if (result.downloadedPlugins > 0) {
        deps.notify(`已恢复 ${result.downloadedPlugins} 个插件`, 'success');
      } else {
        deps.notify('云端暂无插件', 'info');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      deps.logError(`downloadPluginsOnly 异常: ${msg}`, error);
      deps.notify(`插件下载失败：${msg}`, 'error');
    } finally {
      deps.setSyncing(false);
      deps.onProgress('');
    }
  }

  return {
    syncPlugins,
    uploadPluginsOnly,
    downloadPluginsOnly,
  };
}
