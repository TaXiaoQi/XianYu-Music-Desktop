import { useToast } from './toast';
import {
  uploadPlugins as uploadPluginsToCloud,
  downloadPlugins as downloadPluginsFromCloud,
  type PluginSyncResult,
} from '../services/domain/pluginSync';
import {
  lastPluginSyncResult,
  lastPluginSyncTime,
  pluginSyncProgress,
  pluginSyncing,
} from './playlistSyncState';

export interface PluginSyncCoordinatorDeps {
  canSync: () => boolean;
  isPluginUploadEnabled: () => boolean;
  showToast: ReturnType<typeof useToast>['showToast'];
  logSync: (message: string, ...args: unknown[]) => void;
  logSyncError: (message: string, ...args: unknown[]) => void;
}

export function createPluginSyncCoordinator({
  canSync,
  isPluginUploadEnabled,
  showToast,
  logSync,
  logSyncError,
}: PluginSyncCoordinatorDeps) {
async function syncPlugins(): Promise<PluginSyncResult> {
  logSync('========== syncPlugins 开始 ==========');
  if (!canSync()) {
    logSyncError('syncPlugins: 未登录或无弦予号，取消同步');
    showToast('请先登录后再同步', 'error');
    return { uploadedPlugins: 0, downloadedPlugins: 0, syncedSubscriptions: 0, errors: ['未登录'] };
  }

  pluginSyncing.value = true;
  pluginSyncProgress.value = '正在同步插件...';
  lastPluginSyncResult.value = null;

  try {
    let uploadResult: PluginSyncResult = {
      uploadedPlugins: 0,
      downloadedPlugins: 0,
      syncedSubscriptions: 0,
      errors: [],
    };
    if (isPluginUploadEnabled()) {
      logSync('syncPlugins: 步骤 1/2 - 开始上传插件');
      pluginSyncProgress.value = '正在上传插件到云端...';
      uploadResult = await uploadPluginsToCloud();
      logSync('syncPlugins: 步骤 1/2 - 上传插件完成', uploadResult);
    } else {
      logSync('syncPlugins: 步骤 1/2 - 插件上传未开启，跳过');
    }

    logSync('syncPlugins: 步骤 2/2 - 开始下载插件');
    pluginSyncProgress.value = '正在从云端恢复插件...';
    const downloadResult = await downloadPluginsFromCloud();
    logSync('syncPlugins: 步骤 2/2 - 下载插件完成', downloadResult);

    const combined: PluginSyncResult = {
      uploadedPlugins: uploadResult.uploadedPlugins,
      downloadedPlugins: downloadResult.downloadedPlugins,
      syncedSubscriptions: downloadResult.syncedSubscriptions,
      errors: [...uploadResult.errors, ...downloadResult.errors],
    };

    lastPluginSyncResult.value = combined;
    lastPluginSyncTime.value = Date.now();

    logSync(`syncPlugins 完成: uploaded=${combined.uploadedPlugins}, downloaded=${combined.downloadedPlugins}, errors=${combined.errors.length}`);
    if (combined.errors.length > 0) {
      combined.errors.forEach((err, idx) => logSyncError(`syncPlugins error[${idx}]: ${err}`));
    }

    if (combined.errors.length > 0) {
      showToast(`插件同步完成（${combined.errors.length} 个错误）`, 'error');
    } else {
      const parts: string[] = [];
      if (combined.uploadedPlugins > 0) parts.push(`上传 ${combined.uploadedPlugins} 个插件`);
      if (combined.downloadedPlugins > 0) parts.push(`恢复 ${combined.downloadedPlugins} 个插件`);
      if (combined.syncedSubscriptions > 0) parts.push(`同步 ${combined.syncedSubscriptions} 个订阅`);
      showToast(parts.length > 0 ? `插件同步完成：${parts.join('，')}` : '插件已是最新', 'success');
    }

    logSync('========== syncPlugins 结束 ==========');
    return combined;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`syncPlugins 异常: ${msg}`, error);
    showToast(`插件同步失败：${msg}`, 'error');
    return { uploadedPlugins: 0, downloadedPlugins: 0, syncedSubscriptions: 0, errors: [msg] };
  } finally {
    pluginSyncing.value = false;
    pluginSyncProgress.value = '';
  }
}
async function uploadPluginsOnly(): Promise<void> {
  logSync('========== uploadPluginsOnly 开始 ==========');
  if (!canSync()) {
    logSyncError('uploadPluginsOnly: 未登录或无弦予号');
    showToast('请先登录后再同步', 'error');
    return;
  }

  if (!isPluginUploadEnabled()) {
    logSync('uploadPluginsOnly: 插件上传未开启');
    showToast('插件同步已关闭，请在设置中开启', 'info');
    return;
  }

  pluginSyncing.value = true;
  pluginSyncProgress.value = '正在上传插件到云端...';

  try {
    const result = await uploadPluginsToCloud();
    lastPluginSyncTime.value = Date.now();
    lastPluginSyncResult.value = result;
    logSync(`uploadPluginsOnly 完成: uploadedPlugins=${result.uploadedPlugins}, errors=${result.errors.length}`);

    if (result.errors.length > 0) {
      showToast(`插件上传完成（${result.errors.length} 个错误）`, 'error');
    } else if (result.uploadedPlugins > 0) {
      showToast(`已上传 ${result.uploadedPlugins} 个插件`, 'success');
    } else {
      showToast('插件已同步，无需上传', 'info');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`uploadPluginsOnly 异常: ${msg}`, error);
    showToast(`插件上传失败：${msg}`, 'error');
  } finally {
    pluginSyncing.value = false;
    pluginSyncProgress.value = '';
  }
}

async function downloadPluginsOnly(): Promise<void> {
  logSync('========== downloadPluginsOnly 开始 ==========');
  if (!canSync()) {
    logSyncError('downloadPluginsOnly: 未登录或无弦予号');
    showToast('请先登录后再同步', 'error');
    return;
  }

  pluginSyncing.value = true;
  pluginSyncProgress.value = '正在从云端下载插件...';

  try {
    const result = await downloadPluginsFromCloud();
    lastPluginSyncTime.value = Date.now();
    lastPluginSyncResult.value = result;
    logSync(`downloadPluginsOnly 完成: downloadedPlugins=${result.downloadedPlugins}, errors=${result.errors.length}`);

    if (result.errors.length > 0) {
      showToast(`插件下载完成（${result.errors.length} 个错误）`, 'error');
    } else if (result.downloadedPlugins > 0) {
      showToast(`已恢复 ${result.downloadedPlugins} 个插件`, 'success');
    } else {
      showToast('云端暂无插件', 'info');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logSyncError(`downloadPluginsOnly 异常: ${msg}`, error);
    showToast(`插件下载失败：${msg}`, 'error');
  } finally {
    pluginSyncing.value = false;
    pluginSyncProgress.value = '';
  }
}

  return {
    syncPlugins,
    uploadPluginsOnly,
    downloadPluginsOnly,
  };
}
