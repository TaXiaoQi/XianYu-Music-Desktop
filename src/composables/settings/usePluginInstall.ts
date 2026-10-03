import { ref, watch, onUnmounted } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PluginSettings } from '../../types';
import {
  addPluginSource,
  getStoredPlugins,
  getLastPluginLoadError,
  isBakaPlugin,
  loadPluginFromScript,
  persistPluginScriptToDataDir,
} from '../../services/domain/pluginEngine';
import { pluginApi } from '../../services/tauri/pluginApi';
import { useToast } from '../toast';
import { pluginColorClasses } from '../../components/settings/plugins/pluginStyles';

/** 用户取消在线导入（面板取消按钮/关闭面板）：在请求间隙抛出，静默终止安装流程；
 *  安装面板已随取消收起，调用方不再弹失败提示（对齐移动端 PluginInstallCancelled）。 */
export class PluginInstallCancelled extends Error {
  constructor() {
    super('PluginInstallCancelled');
    this.name = 'PluginInstallCancelled';
  }
}

/** 插件 URL 安全校验：仅允许公网 http/https 链接 */
export function validatePluginUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

interface UsePluginInstallOptions {
  /** 远程脚本取数（实现留在 SettingsPlugins.vue，含原生请求优先 + WebView fetch 兜底） */
  fetchRemoteScript: (url: string, cancelled?: () => boolean) => Promise<string>;
  refreshPluginList: () => void;
  pluginsBakaIds: Ref<Set<string>>;
  pluginSettings: ComputedRef<PluginSettings>;
  showInstallFromUrlDialog: Ref<boolean>;
  showInstallFromFilePanel: Ref<boolean>;
  isPluginBusy: Ref<boolean>;
}

/**
 * 插件安装流程：本地文件安装（含拖拽导入）、网络 URL 安装（含取消与批量导入）、
 * 安装落库与版本比对。远程取数实现 fetchRemoteScript 由调用方注入。
 */
export function usePluginInstall(options: UsePluginInstallOptions) {
  const { fetchRemoteScript, refreshPluginList, pluginsBakaIds, pluginSettings, showInstallFromUrlDialog, showInstallFromFilePanel, isPluginBusy } = options;
  const { showToast, showProgressToast } = useToast();

  const installUrl = ref('');
  const isDragOverDropZone = ref(false);

  // 在线链接安装的取消状态与进度条句柄（面板取消按钮/关闭面板触发终止）
  const urlInstallCancelled = ref(false);
  let urlInstallProgress: ReturnType<typeof showProgressToast> | null = null;

  function cancelUrlInstall() {
    urlInstallCancelled.value = true;
    // 立即收起进度条：取消后台安装的收尾由 cancelled 检查点兜底
    urlInstallProgress?.close();
    urlInstallProgress = null;
  }

  // 安装面板经任何途径被关闭（取消按钮/切换其他面板/再次点击安装按钮）时：
  // 若在线导入仍在进行，视为用户取消导入（对齐移动端「返回=取消导入」语义），
  // 避免出现「面板已关、导入仍在跑、进度条永不消失且无法取消」的死状态。
  // urlInstallProgress 仅在 URL 安装期间非 null，其他 busy 操作不会误触发。
  watch(showInstallFromUrlDialog, (now, was) => {
    if (!now && was && isPluginBusy.value && urlInstallProgress) {
      cancelUrlInstall();
    }
  });

  let unlistenDragDrop: UnlistenFn | null = null;
  let unlistenDragOver: UnlistenFn | null = null;
  let unlistenDragLeave: UnlistenFn | null = null;

  onUnmounted(() => {
    unlistenDragDrop?.();
    unlistenDragOver?.();
    unlistenDragLeave?.();
  });

  async function setupDragDropListeners() {
    unlistenDragOver = await listen('tauri://drag-over', () => {
      if (showInstallFromFilePanel.value) {
        isDragOverDropZone.value = true;
      }
    });

    unlistenDragLeave = await listen('tauri://drag-leave', () => {
      isDragOverDropZone.value = false;
    });

    unlistenDragDrop = await listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
      isDragOverDropZone.value = false;
      if (!showInstallFromFilePanel.value) return;

      const paths = event.payload?.paths ?? [];
      const pluginFiles = paths.filter((p) => {
        const lower = p.toLowerCase();
        return lower.endsWith('.js') || lower.endsWith('.json');
      });
      if (pluginFiles.length === 0) return;
      if (pluginFiles.length === 1) {
        await installFromFilePath(pluginFiles[0]);
        return;
      }

      const progress = showProgressToast(`正在导入插件文件 (0/${pluginFiles.length})`);
      for (let i = 0; i < pluginFiles.length; i++) {
        const fileName = pluginFiles[i].split(/[\\/]/).pop() || pluginFiles[i];
        progress.update(
          `正在导入 ${fileName} (${i + 1}/${pluginFiles.length})`,
          ((i + 1) / pluginFiles.length) * 100,
        );
        await installFromFilePath(pluginFiles[i]);
      }
      progress.complete(`已处理 ${pluginFiles.length} 个插件文件`, 'success');
    });
  }

  async function installFromFilePath(filePath: string) {
    try {
      isPluginBusy.value = true;
      const script = await pluginApi.readPluginFile(filePath);
      if (!script || script.trim().length === 0) {
        showToast('插件文件为空', 'error');
        return;
      }
      await installPluginFromScript(script, filePath);
    } catch (e: any) {
      showToast(`安装失败: ${e?.message || e}`, 'error');
    } finally {
      isPluginBusy.value = false;
    }
  }

  async function handleInstallFromFile() {
    try {
      const selected = await openDialog({
        title: '选择插件文件',
        filters: [
          { name: '插件文件', extensions: ['js', 'json'] },
          { name: 'JavaScript 插件', extensions: ['js'] },
          { name: 'JSON 插件索引', extensions: ['json'] },
        ],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      await installFromFilePath(selected as string);
    } catch (e: any) {
      showToast(`安装失败: ${e?.message || e}`, 'error');
    } finally {
      isPluginBusy.value = false;
    }
  }

  async function handleInstallFromUrl() {
    // 单飞互斥：导入进行中忽略再次触发（回车/连点），避免重复导入两份插件
    if (isPluginBusy.value) return;
    const url = installUrl.value.trim();
    if (!url) {
      showToast('请输入插件 URL', 'error');
      return;
    }

    if (!validatePluginUrl(url)) {
      showToast('禁止访问内网或非法协议，仅支持公网 http/https 链接', 'error');
      return;
    }

    isPluginBusy.value = true;
    urlInstallCancelled.value = false;
    const progress = showProgressToast('正在导入插件...');
    urlInstallProgress = progress;
    try {
      const content = await fetchRemoteScript(url, () => urlInstallCancelled.value);
      if (!content || !content.trim()) {
        showToast('获取链接内容失败，请检查 URL 是否正确', 'error');
        return;
      }
      const trimmed = content.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const json = JSON.parse(trimmed);
          const pluginList = Array.isArray(json) ? json : (json.plugins || json.plugin || null);
          if (Array.isArray(pluginList) && pluginList.length > 0 && pluginList[0]?.url) {
            // 批量导入复用同一条进度条，逐项响应取消
            await importMultiplePlugins(pluginList, () => urlInstallCancelled.value, progress);
            installUrl.value = '';
            showInstallFromUrlDialog.value = false;
            return;
          }
        } catch (e) {
          if (e instanceof PluginInstallCancelled) throw e;
          /* 不是有效 JSON，当作普通脚本处理 */
        }
      }
      await installPluginFromScript(content, url);
      installUrl.value = '';
      showInstallFromUrlDialog.value = false;
    } catch (e: any) {
      if (e instanceof PluginInstallCancelled) {
        // 用户已取消：面板与进度条均已收起，静默终止，不再弹失败提示
        return;
      }
      progress.fail(`安装失败: ${e?.message || e}`);
    } finally {
      isPluginBusy.value = false;
      // 软失败路径（获取失败/插件加载失败）只弹 toast 不抛异常，进度条在此统一收尾；
      // 对已完成/已取消的进度条 close 是 no-op
      progress.close();
      if (urlInstallProgress === progress) { urlInstallProgress = null; }
    }
  }

  async function importMultiplePlugins(
    pluginList: Array<{ name?: string; url: string; version?: string }>,
    cancelled?: () => boolean,
    externalProgress?: ReturnType<typeof showProgressToast>,
  ) {
    const items = pluginList.filter(p => p?.url);
    if (items.length === 0) return;

    let successCount = 0;
    let failCount = 0;
    const names: string[] = [];
    const progress = externalProgress ?? showProgressToast(`正在导入插件 (0/${items.length})`);
    for (let i = 0; i < items.length; i++) {
      // 批量导入逐项响应取消（PluginInstallCancelled 向上穿透，由调用方静默处理）
      if (cancelled?.()) throw new PluginInstallCancelled();
      const item = items[i];
      progress.update(
        `正在导入 ${item.name || '未命名插件'} (${i + 1}/${items.length})`,
        ((i + 1) / items.length) * 100,
      );
      try {
        const script = await fetchRemoteScript(item.url, cancelled);
        if (cancelled?.()) throw new PluginInstallCancelled();
        if (!script || !script.trim()) {
          failCount++;
          continue;
        }
        const source = await loadPluginFromScript(script, item.url);
        if (source) {
          if (item.name) source.name = item.name;
          if (item.version) source.version = item.version;
          addPluginSource(source);
          names.push(source.name);
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        // 取消不能被吞成单项失败：向上穿透交给调用方静默处理
        if (e instanceof PluginInstallCancelled) throw e;
        failCount++;
      }
    }
    refreshPluginList();
    if (successCount > 0) {
      progress.complete(
        `成功导入 ${successCount} 个插件: ${names.join(', ')}${failCount > 0 ? `，${failCount} 个失败` : ''}`,
        'success',
      );
    } else {
      progress.fail(`所有插件导入失败 (${failCount} 个)`);
    }
  }

  function compareVer(a: string, b: string): number {
    const pa = (a || '0').split(/[.-]/).filter(Boolean);
    const pb = (b || '0').split(/[.-]/).filter(Boolean);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = parseInt(pa[i]) || 0;
      const nb = parseInt(pb[i]) || 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  async function installPluginFromScript(script: string, filePath: string) {
    const source = await loadPluginFromScript(script, filePath);
    if (!source) {
      const reason = getLastPluginLoadError();
      showToast(reason ? `插件加载失败: ${reason}` : '插件加载失败', 'error');
      return;
    }

    const savedPath = await persistPluginScriptToDataDir(source, script);
    if (savedPath) {
      source.filePath = savedPath;
    }

    if (!pluginSettings.value.skipVersionCheck) {
      const existing = getStoredPlugins().find(p => p.name === source.name);
      if (existing) {
        const cmp = compareVer(source.version, existing.version);
        if (cmp <= 0) {
          showToast(`已存在同名插件 v${existing.version}，新版本 v${source.version} 未高于已安装版本，已跳过`, 'info');
          return;
        }
      }
    }

    addPluginSource(source);
    refreshPluginList();
    let isBaka = false;
    if (source.format === 'musicfree') {
      try {
        isBaka = await isBakaPlugin(source);
      } catch { /* 识别失败时按 MusicFree 展示，不影响安装成功 */ }
    }
    if (isBaka) {
      pluginsBakaIds.value = new Set([...pluginsBakaIds.value, source.id]);
    }
    const formatLabel = pluginColorClasses(source.format, isBaka).label;
    showToast(`成功安装插件: ${source.name} (${formatLabel})`, 'success');
  }

  return {
    installUrl,
    isDragOverDropZone,
    cancelUrlInstall,
    setupDragDropListeners,
    installFromFilePath,
    handleInstallFromFile,
    handleInstallFromUrl,
    importMultiplePlugins,
    installPluginFromScript,
  };
}
