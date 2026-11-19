import { ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { APP_VERSION } from "../../version";
import {
    fetchServerUpdate,
    compareVersions,
    type ServerUpdateInfo,
} from "../utils/update";
import { useToast } from "./toast";
import { updateApi } from "../services/tauri/updateApi";
import { appApi } from "../services/tauri/appApi";
import { aboutConfig } from "../utils/aboutConfig";
const updateVisible = ref(false);
const latestUpdate = ref<ServerUpdateInfo | null>(null);
const isCheckingUpdate = ref(false);
function installerMatchesPlatform(url: string): boolean {
    // 服务端外链代理（蓝奏云/移动云盘改写出的 /api/dl 端点）URL 不含扩展名，
    // 由服务端校验分享链接并 302 直链，属可信渠道；真实文件名由下载侧按响应头推断
    if (/\/api\/dl\?/i.test(url)) {
        return true;
    }
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (/Macintosh|Mac OS X/.test(ua)) {
        return /\.(dmg|app)(?:[?#]|$)/i.test(url);
    }
    if (/Linux/.test(ua)) {
        return /\.(deb|rpm|appimage)(?:[?#]|$)/i.test(url);
    }
    return /\.(msi|exe)(?:[?#]|$)/i.test(url);
}
export interface DownloadProgressData {
    progress: number;
    downloaded: number;
    total: number;
    speed: number;
}
const isDownloading = ref(false);
const downloadProgress = ref<DownloadProgressData>({
    progress: 0,
    downloaded: 0,
    total: 0,
    speed: 0,
});
const isSimulatedUpdate = ref(false);
// 商店版（MSIX）同样参与检测更新，但点击更新时跳转商店页，由商店接管安装
const isStoreEdition = ref(false);
let simulateTimer: ReturnType<typeof setInterval> | null = null;
export function useUpdateCheck() {
    const { showToast } = useToast();
    const checkUpdateOnStartup = async () => {
        if (import.meta.env.DEV) return;
        isStoreEdition.value = await updateApi.isStoreBuild();
        if (isCheckingUpdate.value) return;
        isCheckingUpdate.value = true;
        try {
            const server = await fetchServerUpdate();
            if (!server) return;
            const cmp = compareVersions(server.version, APP_VERSION);
            if (cmp > 0) {
                latestUpdate.value = server;
                updateVisible.value = true;
            }
        } finally {
            isCheckingUpdate.value = false;
        }
    };

    const checkUpdateManual = async () => {
        if (import.meta.env.DEV) {
            showToast("开发环境不检查更新", "info");
            return;
        }
        isStoreEdition.value = await updateApi.isStoreBuild();
        if (isCheckingUpdate.value) return;
        isCheckingUpdate.value = true;
        try {
            const server = await fetchServerUpdate();
            if (!server) {
                showToast("已是最新版本", "success");
                return;
            }
            const cmp = compareVersions(server.version, APP_VERSION);
            if (cmp > 0) {
                latestUpdate.value = server;
                updateVisible.value = true;
            } else {
                showToast("已是最新版本", "success");
            }
        } catch {
            showToast("检查更新失败，请稍后重试", "error");
        } finally {
            isCheckingUpdate.value = false;
        }
    };

    const closeUpdate = () => {
        if (simulateTimer) {
            clearInterval(simulateTimer);
            simulateTimer = null;
        }
        isDownloading.value = false;
        isSimulatedUpdate.value = false;
        updateVisible.value = false;
    };

    const simulateUpdate = () => {
        isSimulatedUpdate.value = true;
        latestUpdate.value = {
            version: "99.9.9",
            downloadUrl:
                "https://github.com/TaXiaoQi/XianYu-Music-Desktop/releases",
            updateContent:
                "【调试模拟】此更新提示由调试模式模拟生成，用于测试更新弹窗的显示效果。\n\n模拟版本号：99.9.9\n\n您可以在此查看更新弹窗的排版、样式和交互行为，而无需连接服务器。\n\n点击「立即更新」将模拟下载进度动画。",
            updatedAt: new Date().toISOString(),
        };
        updateVisible.value = true;
    };
    const openDownload = async () => {
        if (latestUpdate.value?.downloadUrl) {
            await openUrl(latestUpdate.value.downloadUrl);
        }
    };

    const simulateDownload = () => {
        if (isDownloading.value) return;
        isDownloading.value = true;
        const totalBytes = 48.3 * 1024 * 1024;
        downloadProgress.value = {
            progress: 0,
            downloaded: 0,
            total: totalBytes,
            speed: 0,
        };
        const intervalMs = 60;
        const totalSteps = 80;
        let step = 0;

        simulateTimer = setInterval(() => {
            step++;
            const baseRatio = step / totalSteps;
            const easedRatio =
                baseRatio < 0.8
                    ? baseRatio * 1.15
                    : 0.92 + (baseRatio - 0.8) * 0.4;
            const ratio = Math.min(1, easedRatio);

            const downloaded = Math.round(totalBytes * ratio);
            const speed = (3 + Math.random() * 5) * 1024 * 1024;
            const progress = ratio * 100;

            downloadProgress.value = {
                progress,
                downloaded,
                total: totalBytes,
                speed,
            };

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
                setTimeout(() => {
                    isDownloading.value = false;
                    isSimulatedUpdate.value = false;
                    updateVisible.value = false;
                    showToast("模拟下载完成（调试模式）", "success");
                }, 400);
            }
        }, intervalMs);
    };

    const downloadAndInstall = async () => {
        if (isSimulatedUpdate.value) {
            simulateDownload();
            return;
        }

        // 商店版：不应用内下载安装，跳转商店页（管理端 storeUrl，未配置回退官网）由商店接管
        if (isStoreEdition.value) {
            const store =
                latestUpdate.value?.storeUrl ||
                aboutConfig.value.officialSiteUrl;
            if (store) {
                await openUrl(store);
            } else {
                showToast("暂未配置商店页地址，请前往官网更新", "info");
            }
            updateVisible.value = false;
            return;
        }

        if (!latestUpdate.value?.downloadUrl) {
            showToast("下载地址不可用", "error");
            return;
        }
        if (!installerMatchesPlatform(latestUpdate.value.downloadUrl)) {
            showToast("当前平台安装包暂未发布，请前往官网下载", "info");
            const site = aboutConfig.value.officialSiteUrl;
            if (site) {
                await openUrl(site);
            }
            updateVisible.value = false;
            return;
        }
        if (isDownloading.value) return;

        isDownloading.value = true;
        downloadProgress.value = {
            progress: 0,
            downloaded: 0,
            total: 0,
            speed: 0,
        };

        let unlisten: UnlistenFn | null = null;
        try {
            unlisten = await listen<DownloadProgressData>(
                "update-download-progress",
                (event) => {
                    downloadProgress.value = event.payload;
                },
            );

            const path = await updateApi.downloadUpdateFile(
                latestUpdate.value!.downloadUrl,
            );

            await updateApi.runInstaller(path);

            await new Promise((resolve) => setTimeout(resolve, 500));
            await appApi.exitApp();
        } catch (error) {
            showToast(
                "更新失败：" +
                    (error instanceof Error ? error.message : String(error)),
                "error",
            );
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
        isStoreEdition,
        checkUpdateOnStartup,
        checkUpdateManual,
        closeUpdate,
        openDownload,
        downloadAndInstall,
        simulateUpdate,
    };
}
