import { ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_VERSION } from '../../version';
import {
  fetchServerUpdate,
  compareVersions,
  extractVersion,
  type ServerUpdateInfo,
} from '../utils/update';
import { useToast } from './toast';
import { tauriInvoke } from '../services/tauri/invoke';

// 模块级单例状态，保证全局共享同一份更新检查状态
const updateVisible = ref(false);
const latestUpdate = ref<ServerUpdateInfo | null>(null);
const isCheckingUpdate = ref(false);

// 下载安装状态
export interface DownloadProgressData {
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
}
const isDownloading = ref(false);
const downloadProgress = ref<DownloadProgressData>({ progress: 0, downloaded: 0, total: 0, speed: 0 });

// 调试模拟标志：simulateUpdate 设置后，downloadAndInstall 走模拟下载流程
const isSimulatedUpdate = ref(false);
let simulateTimer: ReturnType<typeof setInterval> | null = null;

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
    if (simulateTimer) {
      clearInterval(simulateTimer);
      simulateTimer = null;
    }
    isDownloading.value = false;
    isSimulatedUpdate.value = false;
    updateVisible.value = false;
  };

  /** 调试用：使用模拟数据直接弹出更新弹窗，不做真实网络请求 */
  const simulateUpdate = () => {
    isSimulatedUpdate.value = true;
    latestUpdate.value = {
      version: '99.9.9',
      downloadUrl: 'https://github.com/TaXiaoQi/XianYu-Music-Desktop/releases',
      updateContent: '【调试模拟】此更新提示由调试模式模拟生成，用于测试更新弹窗的显示效果。\n\n模拟版本号：99.9.9\n\n您可以在此查看更新弹窗的排版、样式和交互行为，而无需连接服务器。\n\n点击「立即更新」将模拟下载进度动画。',
      updatedAt: new Date().toISOString(),
    };
    updateVisible.value = true;
  };

  /** 打开下载链接（备用：浏览器打开） */
  const openDownload = async () => {
    if (latestUpdate.value?.downloadUrl) {
      await openUrl(latestUpdate.value.downloadUrl);
    }
  };

  /**
   * 调试用：模拟下载进度动画
   * 在约 5 秒内从 0% 递增到 100%，带有随机速度波动
   */
  const simulateDownload = () => {
    if (isDownloading.value) return;
    isDownloading.value = true;
    const totalBytes = 48.3 * 1024 * 1024; // 模拟 48.3MB 安装包
    downloadProgress.value = { progress: 0, downloaded: 0, total: totalBytes, speed: 0 };

    const intervalMs = 60;
    const totalSteps = 80; // 约 4.8 秒完成
    let step = 0;

    simulateTimer = setInterval(() => {
      step++;
      // 非线性进度：前段快、后段稍慢，模拟真实网络波动
      const baseRatio = step / totalSteps;
      const easedRatio = baseRatio < 0.8
        ? baseRatio * 1.15
        : 0.92 + (baseRatio - 0.8) * 0.4;
      const ratio = Math.min(1, easedRatio);

      const downloaded = Math.round(totalBytes * ratio);
      // 随机速度波动：3~8 MB/s
      const speed = (3 + Math.random() * 5) * 1024 * 1024;
      const progress = ratio * 100;

      downloadProgress.value = { progress, downloaded, total: totalBytes, speed };

      if (step >= totalSteps) {
        if (simulateTimer) {
          clearInterval(simulateTimer);
          simulateTimer = null;
        }
        downloadProgress.value = {
          progress: 100,
          downloaded: totalBytes,
          total: totalBytes,
          speed: 0,
        };
        // 短暂展示 100% 后关闭弹窗
        setTimeout(() => {
          isDownloading.value = false;
          isSimulatedUpdate.value = false;
          updateVisible.value = false;
          showToast('模拟下载完成（调试模式）', 'success');
        }, 400);
      }
    }, intervalMs);
  };

  /**
   * 应用内下载更新并自动安装
   * 1. 监听下载进度事件
   * 2. 调用 download_update_file 下载安装包
   * 3. 调用 run_installer 启动 MSI 安装程序
   * 4. 调用 exit_app 退出应用，安装程序接管
   * 用户数据存储在 app_data_dir（%APPDATA%），MSI 覆盖安装目录不影响数据
   *
   * 调试模式下（isSimulatedUpdate）走 simulateDownload 模拟流程，不执行真实下载
   */
  const downloadAndInstall = async () => {
    // 调试模拟模式：仅模拟下载进度动画，不执行真实下载安装
    if (isSimulatedUpdate.value) {
      simulateDownload();
      return;
    }

    if (!latestUpdate.value?.downloadUrl) {
      showToast('下载地址不可用', 'error');
      return;
    }
    if (isDownloading.value) return;

    isDownloading.value = true;
    downloadProgress.value = { progress: 0, downloaded: 0, total: 0, speed: 0 };

    let unlisten: UnlistenFn | null = null;
    try {
      // 监听下载进度
      unlisten = await listen<DownloadProgressData>('update-download-progress', (event) => {
        downloadProgress.value = event.payload;
      });

      // 下载安装包到 Downloads 目录
      const path = await tauriInvoke('download_update_file', {
        url: latestUpdate.value!.downloadUrl,
      });

      // 启动 MSI 安装程序（非阻塞）
      await tauriInvoke('run_installer', { path });

      // 等待安装程序初始化后退出应用
      await new Promise((resolve) => setTimeout(resolve, 500));
      await tauriInvoke('exit_app');
    } catch (error) {
      showToast('更新失败：' + (error instanceof Error ? error.message : String(error)), 'error');
      isDownloading.value = false;
    } finally {
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    }
  };

  return {
    updateVisible,
    latestUpdate,
    isCheckingUpdate,
    isDownloading,
    downloadProgress,
    checkUpdateOnStartup,
    checkUpdateManual,
    closeUpdate,
    openDownload,
    downloadAndInstall,
    simulateUpdate,
  };
}
