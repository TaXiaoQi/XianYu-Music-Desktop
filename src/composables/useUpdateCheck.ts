import { ref } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_VERSION } from '../../version';
import {
  fetchServerUpdate,
  compareVersions,
  extractVersion,
  type ServerUpdateInfo,
} from '../utils/update';
import { useToast } from './toast';

// 模块级单例状态，保证全局共享同一份更新检查状态
const updateVisible = ref(false);
const latestUpdate = ref<ServerUpdateInfo | null>(null);
const isCheckingUpdate = ref(false);

export function useUpdateCheck() {
  const { showToast } = useToast();

  /**
   * 启动时自动检查（应用启动调用）
   * 只要后台版本高于本地版本就弹出，每次启动都检查、每次都弹
   * 无数据/请求失败时静默，不打扰用户
   */
  const checkUpdateOnStartup = async () => {
    if (isCheckingUpdate.value) return;
    isCheckingUpdate.value = true;
    try {
      const server = await fetchServerUpdate();
      if (!server) return; // 未启用/请求失败，静默
      const cmp = compareVersions(extractVersion(server.version), extractVersion(APP_VERSION));
      if (cmp > 0) {
        latestUpdate.value = server;
        updateVisible.value = true;
      }
    } finally {
      isCheckingUpdate.value = false;
    }
  };

  /**
   * 手动检查（关于页「检查更新」按钮调用）
   * 强制比对；无更新时 toast「已是最新版本」
   */
  const checkUpdateManual = async () => {
    if (isCheckingUpdate.value) return;
    isCheckingUpdate.value = true;
    try {
      const server = await fetchServerUpdate();
      if (!server) {
        showToast('已是最新版本', 'success');
        return;
      }
      const cmp = compareVersions(extractVersion(server.version), extractVersion(APP_VERSION));
      if (cmp > 0) {
        latestUpdate.value = server;
        updateVisible.value = true;
      } else {
        showToast('已是最新版本', 'success');
      }
    } catch {
      showToast('检查更新失败，请稍后重试', 'error');
    } finally {
      isCheckingUpdate.value = false;
    }
  };

  /** 关闭弹窗（「稍后」仅当次关闭，下次启动仍会重新检查并弹出） */
  const closeUpdate = () => {
    updateVisible.value = false;
  };

  /** 打开下载链接 */
  const openDownload = async () => {
    if (latestUpdate.value?.downloadUrl) {
      await openUrl(latestUpdate.value.downloadUrl);
    }
  };

  return {
    updateVisible,
    latestUpdate,
    isCheckingUpdate,
    checkUpdateOnStartup,
    checkUpdateManual,
    closeUpdate,
    openDownload,
  };
}
