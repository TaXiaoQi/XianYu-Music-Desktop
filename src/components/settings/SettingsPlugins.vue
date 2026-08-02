<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { Puzzle, Trash2, RefreshCw, Search, PackageOpen, Globe, Link2, Download, GripVertical, UploadCloud, FileCode2, Info, X, Copy } from 'lucide-vue-next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useToast } from '../../composables/toast';
import type { PluginSource, PluginSubscription } from '../../types';
import { getStoredPlugins, addPluginSource, removePluginSource, togglePlugin, loadPlugins, reorderPlugins, checkPluginUpdate, performPluginUpdate, checkAllPluginUpdates, type PluginUpdateCheckResult, getSubscriptions, addSubscription, updateSubscription, removeSubscription, installFromSubscriptionUrl, installAllSubscriptions, isValidSubscriptionUrl } from '../../services/pluginEngine';
import { useSettings } from '../../features/settings/useSettings';
import SettingHint from './SettingHint.vue';

withDefaults(defineProps<{
  overlayZClass?: string;
}>(), {
  overlayZClass: 'z-[200]',
});

const { showToast } = useToast();
const { settings, patchSettings } = useSettings();

// 插件设置快捷访问
const pluginSettings = computed(() => settings.value.plugins);
function togglePluginSetting(key: 'autoUpdateOnStartup' | 'lazyLoad' | 'skipVersionCheck') {
  patchSettings({
    plugins: { [key]: !pluginSettings.value[key] },
  });
}

// 启动时加载已启用的插件
onMounted(async () => {
  await loadPlugins(pluginSettings.value.lazyLoad);
  plugins.value = getStoredPlugins();
  // 注册 Tauri 拖放事件监听（仅当本地安装面板打开时响应）
  setupDragDropListeners();
});

onUnmounted(() => {
  unlistenDragDrop?.();
  unlistenDragOver?.();
  unlistenDragLeave?.();
  stopDragging();
});

// UI 状态
const searchQuery = ref('');
const showSubscriptionPanel = ref(false);
const showInstallFromUrlDialog = ref(false);
const showInstallFromFilePanel = ref(false);
const isDragOverDropZone = ref(false);
const installUrl = ref('');

// Tauri 拖放事件取消监听函数
let unlistenDragDrop: UnlistenFn | null = null;
let unlistenDragOver: UnlistenFn | null = null;
let unlistenDragLeave: UnlistenFn | null = null;

/** 插件列表（从 localStorage 读取） */
const plugins = ref<PluginSource[]>(getStoredPlugins());
/** 订阅列表（持久化到 localStorage，重启后保留） */
const subscriptions = ref<PluginSubscription[]>(getSubscriptions());
const showAddSubscriptionInput = ref(false);
const newSubscriptionUrl = ref('');

const isPluginBusy = ref(false);

/** 插件排序：完全按用户自定义的 sortOrder 排列，不强制按格式分组 */
function sortPlugins(list: PluginSource[]): PluginSource[] {
  return [...list].sort((a, b) => {
    const sa = a.sortOrder ?? 0;
    const sb = b.sortOrder ?? 0;
    if (sa !== sb) return sa - sb;
    // sortOrder 相同时保持原始顺序（兼容旧数据）
    return list.indexOf(a) - list.indexOf(b);
  });
}

const filteredPlugins = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase();
  const sorted = sortPlugins(plugins.value);
  if (!keyword) return sorted;
  return sorted.filter((p) =>
    p.name.toLowerCase().includes(keyword) ||
    p.sources.join(',').toLowerCase().includes(keyword) ||
    (p.author?.toLowerCase().includes(keyword) ?? false)
  );
});

// ==================== 拖拽排序（基于 pointer 事件）====================
// 不用 HTML5 drag & drop：Tauri 的 WebView2 默认接管拖放（dragDropEnabled），
// 会导致页面内原生 DnD 失效，因此这里用 pointer 事件自行实现。
const draggingIndex = ref<number | null>(null);
const listRef = ref<HTMLElement | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);
let latestPointerY = 0;
let autoScrollFrame: number | null = null;

const AUTO_SCROLL_EDGE_SIZE = 80;
const AUTO_SCROLL_MAX_SPEED = 8;

/** 查找列表所在的纵向滚动容器 */
const findScrollContainer = (element: HTMLElement): HTMLElement | null => {
  let current = element.parentElement;
  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

/**
 * 根据指针位置和当前拖拽索引推导目标索引。
 * 只在越过相邻项中线后换位，避免列表重排后指针反向命中原位置而抖动。
 */
const resolveTargetIndex = (clientY: number, currentIndex: number): number | null => {
  const listEl = listRef.value;
  if (!listEl) return null;

  const rows = Array.from(
    listEl.querySelectorAll<HTMLElement>('[data-plugin-row]'),
  );
  if (rows.length === 0) return null;

  let target = currentIndex;

  // 向上扫描
  for (let i = currentIndex - 1; i >= 0; i--) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) target = i;
    else break;
  }

  if (target !== currentIndex) return target;

  // 向下扫描
  for (let i = currentIndex + 1; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) target = i;
    else break;
  }

  return target;
};

/** 在已排序列表中移动插件（仅内存操作，拖拽结束后持久化） */
const movePluginItem = (from: number, to: number) => {
  if (from < 0 || from >= filteredPlugins.value.length || to < 0 || to >= filteredPlugins.value.length || from === to) return;
  const sorted = [...filteredPlugins.value];
  const [moved] = sorted.splice(from, 1);
  sorted.splice(to, 0, moved);
  // 更新内存中的 sortOrder，触发 filteredPlugins 重新排序
  sorted.forEach((p, i) => {
    const plugin = plugins.value.find(item => item.id === p.id);
    if (plugin) plugin.sortOrder = i;
  });
};

const updateDraggedItemPosition = (clientY: number) => {
  const currentIndex = draggingIndex.value;
  if (currentIndex === null) return;

  const target = resolveTargetIndex(clientY, currentIndex);
  if (target === null || target === currentIndex) return;

  movePluginItem(currentIndex, target);
  // 实时重排后，被拖拽项已移动到新位置
  draggingIndex.value = target;
};

/** 指针靠近滚动区域边缘时，持续滚动并同步更新拖拽位置 */
const runAutoScroll = () => {
  autoScrollFrame = null;
  if (draggingIndex.value === null) return;

  const container = scrollContainer.value;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  let speed = 0;

  if (latestPointerY < rect.top + AUTO_SCROLL_EDGE_SIZE) {
    const intensity = Math.min(1, (rect.top + AUTO_SCROLL_EDGE_SIZE - latestPointerY) / AUTO_SCROLL_EDGE_SIZE);
    speed = -AUTO_SCROLL_MAX_SPEED * intensity;
  } else if (latestPointerY > rect.bottom - AUTO_SCROLL_EDGE_SIZE) {
    const intensity = Math.min(1, (latestPointerY - (rect.bottom - AUTO_SCROLL_EDGE_SIZE)) / AUTO_SCROLL_EDGE_SIZE);
    speed = AUTO_SCROLL_MAX_SPEED * intensity;
  }

  if (speed === 0) return;

  const previousScrollTop = container.scrollTop;
  container.scrollTop += speed;
  if (container.scrollTop !== previousScrollTop) {
    updateDraggedItemPosition(latestPointerY);
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  }
};

const scheduleAutoScroll = () => {
  if (autoScrollFrame === null) {
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  }
};

const handlePointerMove = (event: PointerEvent) => {
  if (draggingIndex.value === null) return;
  event.preventDefault();

  latestPointerY = event.clientY;
  updateDraggedItemPosition(event.clientY);
  scheduleAutoScroll();
};

const stopDragging = () => {
  // 拖拽结束时持久化到 localStorage
  if (draggingIndex.value !== null) {
    const finalOrder = sortPlugins(plugins.value).map(p => p.id);
    reorderPlugins(finalOrder);
    plugins.value = getStoredPlugins();
  }
  draggingIndex.value = null;
  scrollContainer.value = null;
  if (autoScrollFrame !== null) {
    cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
  }
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', stopDragging);
  window.removeEventListener('pointercancel', stopDragging);
};

const startDragging = (index: number, event: PointerEvent) => {
  // 搜索模式下禁止拖拽
  if (searchQuery.value.trim()) return;
  // 只响应主键/触摸
  if (event.button !== 0) return;
  event.preventDefault();

  draggingIndex.value = index;
  latestPointerY = event.clientY;
  scrollContainer.value = listRef.value ? findScrollContainer(listRef.value) : null;
  window.addEventListener('pointermove', handlePointerMove, { passive: false });
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);
};

const pluginStatsLabel = computed(() => {
  const total = plugins.value.length;
  const enabled = plugins.value.filter((p) => p.enabled).length;
  return `共 ${total} 个插件，已启用 ${enabled} 个`;
});

/** 根据插件格式返回对应颜色类名 */
function pluginColorClasses(format: PluginSource['format']) {
  if (format === 'lx') {
    return {
      iconBg: 'bg-gradient-to-br from-green-500/12 to-emerald-400/12',
      iconText: 'text-green-600 dark:text-green-400',
      toggle: 'bg-green-500',
      tagBg: 'bg-green-500/10 text-green-700 dark:text-green-300 dark:bg-green-500/15',
      label: '落雪',
    };
  }
  if (format === 'musicfree') {
    return {
      iconBg: 'bg-gradient-to-br from-orange-500/12 to-amber-400/12',
      iconText: 'text-orange-600 dark:text-orange-400',
      toggle: 'bg-orange-500',
      tagBg: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 dark:bg-orange-500/15',
      label: 'MusicFree',
    };
  }
  // unknown / fallback
  return {
    iconBg: 'bg-gradient-to-br from-[#EC4141]/12 to-[#ff8b8b]/12',
    iconText: 'text-[#EC4141]',
    toggle: 'bg-[#EC4141]',
    tagBg: 'bg-gray-500/10 text-gray-700 dark:text-gray-300 dark:bg-gray-500/15',
    label: '未知',
  };
}

function refreshPluginList() {
  plugins.value = getStoredPlugins();
}

// ==================== 从本地文件安装 ====================

/** 注册 Tauri 窗口级拖放事件监听 */
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
    // 筛选 .js 和 .json 文件
    const pluginFiles = paths.filter((p) => {
      const lower = p.toLowerCase();
      return lower.endsWith('.js') || lower.endsWith('.json');
    });

    if (pluginFiles.length === 0) return;

    for (const filePath of pluginFiles) {
      await installFromFilePath(filePath);
    }
  });
}

/** 从文件路径安装插件（供拖放和文件选择共用） */
async function installFromFilePath(filePath: string) {
  try {
    isPluginBusy.value = true;
    const script = await invoke<string>('read_plugin_file', { path: filePath });
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

// ==================== 从网络 URL 安装 ====================

async function handleInstallFromUrl() {
  const url = installUrl.value.trim();
  if (!url) {
    showToast('请输入插件 URL', 'error');
    return;
  }

  isPluginBusy.value = true;
  try {
    // 先尝试浏览器 fetch（Tauri WebView 不受部分 CORS 限制）
    let content = '';
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': '*/*' },
      });
      if (resp.ok) content = await resp.text();
    } catch { /* ignore, try Tauri backend */ }

    // 回退到 Tauri 后端代理
    if (!content) {
      const { pluginApi } = await import('../../services/tauri/pluginApi');
      content = await pluginApi.fetchPluginUrl(url);
    }

    if (!content || !content.trim()) {
      showToast('获取链接内容失败，请检查 URL 是否正确', 'error');
      return;
    }

    // [批量导入] 检测是否为多插件 JSON 格式
    // MusicFree 插件集合: { "plugins": [{ "name": "...", "url": "...", "version": "..." }] }
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const json = JSON.parse(trimmed);
        const pluginList = Array.isArray(json) ? json : (json.plugins || json.plugin || null);
        if (Array.isArray(pluginList) && pluginList.length > 0 && pluginList[0]?.url) {
          await importMultiplePlugins(pluginList);
          installUrl.value = '';
          showInstallFromUrlDialog.value = false;
          return;
        }
      } catch { /* 不是有效 JSON，当作普通脚本处理 */ }
    }

    // 单个插件导入
    await installPluginFromScript(content, url);
    installUrl.value = '';
    showInstallFromUrlDialog.value = false;
  } catch (e: any) {
    showToast(`安装失败: ${e?.message || e}`, 'error');
  } finally {
    isPluginBusy.value = false;
  }
}

/** 批量导入多插件 JSON 中的所有插件 */
async function importMultiplePlugins(pluginList: Array<{ name?: string; url: string; version?: string }>) {
  const { loadPluginFromScript } = await import('../../services/pluginEngine');
  const { pluginApi } = await import('../../services/tauri/pluginApi');
  let successCount = 0;
  let failCount = 0;
  const names: string[] = [];

  for (const item of pluginList) {
    if (!item.url) continue;
    try {
      // 下载单个插件脚本
      let script = '';
      try {
        const resp = await fetch(item.url, { headers: { 'Accept': '*/*' } });
        if (resp.ok) script = await resp.text();
      } catch { /* ignore */ }

      if (!script) {
        try { script = await pluginApi.fetchPluginUrl(item.url); } catch { /* ignore */ }
      }

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
    } catch {
      failCount++;
    }
  }

  refreshPluginList();
  if (successCount > 0) {
    showToast(`成功导入 ${successCount} 个插件: ${names.join(', ')}${failCount > 0 ? `，${failCount} 个失败` : ''}`, 'success');
  } else {
    showToast(`所有插件导入失败 (${failCount} 个)`, 'error');
  }
}

// ==================== 核心安装逻辑 ====================

/** 简单版本号比较：返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相同 */
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
  // 使用 pluginEngine 的 loadPluginFromScript，自动检测格式（LX 或 MusicFree）
  const { loadPluginFromScript } = await import('../../services/pluginEngine');
  const source = await loadPluginFromScript(script, filePath);
  if (!source) {
    showToast('插件加载失败', 'error');
    return;
  }

  // 版本校验：检查是否已存在同名插件且版本更高或相同
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
  showToast(`成功安装插件: ${source.name} (${source.format === 'lx' ? '落雪' : 'MusicFree'})`, 'success');
}

// ==================== 插件管理 ====================

const showUninstallAllConfirm = ref(false);

function handleUninstallAll() {
  if (plugins.value.length === 0) return;
  showUninstallAllConfirm.value = true;
}

function confirmUninstallAll() {
  for (const p of [...plugins.value]) {
    removePluginSource(p.id);
  }
  refreshPluginList();
  showUninstallAllConfirm.value = false;
  showToast('已卸载全部插件', 'success');
}

// 单个插件卸载二次确认
const showUninstallPluginConfirm = ref(false);
const pendingUninstallPlugin = ref<PluginSource | null>(null);

function handleUninstallPlugin(plugin: PluginSource) {
  pendingUninstallPlugin.value = plugin;
  showUninstallPluginConfirm.value = true;
}

function confirmUninstallPlugin() {
  const plugin = pendingUninstallPlugin.value;
  if (!plugin) return;
  removePluginSource(plugin.id);
  refreshPluginList();
  showUninstallPluginConfirm.value = false;
  pendingUninstallPlugin.value = null;
  showToast(`已卸载 ${plugin.name}`, 'success');
}

async function handleTogglePlugin(plugin: PluginSource) {
  const result = await togglePlugin(plugin.id);
  if (result.success) {
    refreshPluginList();
    showToast(`${result.enabled ? '已启用' : '已禁用'} ${plugin.name}`, 'success');
  } else {
    showToast(result.message || '操作失败', 'error');
  }
}

// 更新检查结果缓存
const updateCheckResults = ref<Map<string, PluginUpdateCheckResult>>(new Map());
const checkingUpdates = ref(false);
const updatingPluginId = ref<string | null>(null);

async function handleUpdatePlugin(plugin: PluginSource) {
  // 如果已有缓存结果且确认有更新，直接执行更新
  const cached = updateCheckResults.value.get(plugin.id);
  if (cached?.hasUpdate && cached.newScript) {
    updatingPluginId.value = plugin.id;
    try {
      const result = await performPluginUpdate(plugin, cached);
      if (result.success) {
        showToast(`${plugin.name} 已更新到 v${cached.newVersion}`, 'success');
        updateCheckResults.value.delete(plugin.id);
        await refreshPluginList();
      } else {
        showToast(result.message || '更新失败', 'error');
      }
    } catch (e: any) {
      showToast(`更新失败: ${e?.message || e}`, 'error');
    } finally {
      updatingPluginId.value = null;
    }
    return;
  }

  // 否则先检查更新
  updatingPluginId.value = plugin.id;
  try {
    const result = await checkPluginUpdate(plugin);
    if (!result) {
      showToast(`${plugin.name} 无可用更新源`, 'info');
    } else if (result.hasUpdate) {
      updateCheckResults.value.set(plugin.id, result);
      showToast(`${plugin.name} 发现新版本 v${result.newVersion}，再次点击更新`, 'info');
    } else {
      showToast(`${plugin.name} 已是最新版本`, 'info');
    }
  } catch (e: any) {
    showToast(`检查更新失败: ${e?.message || e}`, 'error');
  } finally {
    updatingPluginId.value = null;
  }
}

async function handleCheckAllUpdates() {
  if (checkingUpdates.value) return;
  checkingUpdates.value = true;
  try {
    const results = await checkAllPluginUpdates();
    updateCheckResults.value = results;
    let updateCount = 0;
    for (const [, result] of results) {
      if (result.hasUpdate) updateCount++;
    }
    if (updateCount > 0) {
      showToast(`发现 ${updateCount} 个插件可更新`, 'info');
    } else {
      showToast('所有插件均为最新版本', 'info');
    }
    await refreshPluginList();
  } catch (e: any) {
    showToast(`批量检查失败: ${e?.message || e}`, 'error');
  } finally {
    checkingUpdates.value = false;
  }
}

// 打开订阅设置
function toggleSubscriptionPanel() {
  const willOpen = !showSubscriptionPanel.value;
  // 互斥：打开一个面板时关闭其他
  if (willOpen) {
    showInstallFromUrlDialog.value = false;
    showInstallFromFilePanel.value = false;
  }
  showSubscriptionPanel.value = willOpen;
}

// 切换网络安装输入面板
function toggleInstallFromUrlDialog() {
  const willOpen = !showInstallFromUrlDialog.value;
  if (willOpen) {
    showSubscriptionPanel.value = false;
    showInstallFromFilePanel.value = false;
  }
  showInstallFromUrlDialog.value = willOpen;
}

// 切换本地安装面板
function toggleInstallFromFilePanel() {
  const willOpen = !showInstallFromFilePanel.value;
  if (willOpen) {
    showSubscriptionPanel.value = false;
    showInstallFromUrlDialog.value = false;
  }
  showInstallFromFilePanel.value = willOpen;
  isDragOverDropZone.value = false;
}

// 添加订阅源
function handleAddSubscription() {
  showAddSubscriptionInput.value = !showAddSubscriptionInput.value;
  newSubscriptionUrl.value = '';
}

// 确认添加订阅
function confirmAddSubscription() {
  const url = newSubscriptionUrl.value.trim();
  if (!url) {
    showToast('请输入订阅 URL', 'error');
    return;
  }

  // URL 校验：必须 http(s) 且以 .js/.json 结尾（与 MusicFreeDesktop 一致）
  if (!isValidSubscriptionUrl(url)) {
    showToast('订阅链接需以 .js 或 .json 结尾', 'error');
    return;
  }

  // 调用 service 持久化（内部含去重校验）
  const sub = addSubscription({ name: '', url });
  if (!sub) {
    showToast('该订阅已存在或 URL 无效', 'error');
    return;
  }
  subscriptions.value = getSubscriptions();
  newSubscriptionUrl.value = '';
  showAddSubscriptionInput.value = false;
  showToast(`已添加订阅: ${sub.name}`, 'success');
}

// 从单个订阅安装
async function handleInstallFromSubscription(sub: PluginSubscription) {
  if (isPluginBusy.value) return;
  isPluginBusy.value = true;
  try {
    const result = await installFromSubscriptionUrl(sub.url, {
      skipVersionCheck: pluginSettings.value.skipVersionCheck,
    });
    // 更新该订阅的同步状态
    updateSubscription(sub.id, {
      lastSyncAt: Date.now(),
      lastSyncStatus: result.failCount === 0 ? 'success' : (result.successCount > 0 ? 'partial' : 'failed'),
      lastSyncMessage: result.errors[0] || `成功安装 ${result.successCount} 个插件`,
      lastSyncCount: result.successCount,
    });
    subscriptions.value = getSubscriptions();
    refreshPluginList();
    if (result.successCount > 0) {
      showToast(
        `从 ${sub.name} 安装 ${result.successCount} 个插件${result.failCount ? `，${result.failCount} 个失败` : ''}`,
        'success',
      );
    } else {
      showToast(`从 ${sub.name} 安装失败: ${result.errors[0] || '无可安装插件'}`, 'error');
    }
  } catch (e: any) {
    showToast(`同步失败: ${e?.message || e}`, 'error');
  } finally {
    isPluginBusy.value = false;
  }
}

// 一键更新全部订阅
const syncingAll = ref(false);
async function handleSyncAllSubscriptions() {
  if (syncingAll.value || isPluginBusy.value) return;
  if (subscriptions.value.length === 0) {
    showToast('暂无订阅源', 'info');
    return;
  }
  syncingAll.value = true;
  try {
    const res = await installAllSubscriptions();
    subscriptions.value = getSubscriptions();
    refreshPluginList();
    showToast(
      `同步完成: 共安装 ${res.totalInstalled} 个插件${res.failedSubs ? `，${res.failedSubs} 个订阅失败` : ''}`,
      res.failedSubs ? 'info' : 'success',
    );
  } catch (e: any) {
    showToast(`同步失败: ${e?.message || e}`, 'error');
  } finally {
    syncingAll.value = false;
  }
}

// ==================== 订阅名称编辑 ====================
const editingSubId = ref<string | null>(null);
const editingSubName = ref('');

function startEditSubName(sub: PluginSubscription) {
  editingSubId.value = sub.id;
  editingSubName.value = sub.name;
}

function saveSubName(sub: PluginSubscription) {
  if (editingSubId.value !== sub.id) return;
  const name = editingSubName.value.trim();
  if (name && name !== sub.name) {
    updateSubscription(sub.id, { name });
    subscriptions.value = getSubscriptions();
  }
  editingSubId.value = null;
}

function cancelEditSubName() {
  editingSubId.value = null;
}

/** 相对时间格式化（用于显示"上次同步"） */
function formatRelativeTime(ts: number | undefined): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 移除订阅源（二次确认）
const showRemoveSubscriptionConfirm = ref(false);
const pendingRemoveSubscription = ref<PluginSubscription | null>(null);

function handleRemoveSubscription(sub: PluginSubscription) {
  pendingRemoveSubscription.value = sub;
  showRemoveSubscriptionConfirm.value = true;
}

function confirmRemoveSubscription() {
  const sub = pendingRemoveSubscription.value;
  if (!sub) return;
  removeSubscription(sub.id);
  subscriptions.value = getSubscriptions();
  showRemoveSubscriptionConfirm.value = false;
  pendingRemoveSubscription.value = null;
  showToast(`已移除订阅 ${sub.name}`, 'success');
}

// ==================== 插件详情弹窗 ====================
const detailPlugin = ref<PluginSource | null>(null);

function openPluginDetail(plugin: PluginSource) {
  detailPlugin.value = plugin;
}

function closePluginDetail() {
  detailPlugin.value = null;
}

async function copyPluginLink() {
  if (!detailPlugin.value?.filePath) return;
  try {
    await navigator.clipboard.writeText(detailPlugin.value.filePath);
    showToast('插件链接已复制', 'success');
  } catch {
    showToast('复制失败，请手动选择复制', 'error');
  }
}
</script>

<template>
  <div class="w-full space-y-8">
    <!-- 顶部操作栏 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        插件安装
      </h2>

      <div class="flex flex-col gap-3 rounded-xl">
        <!-- 描述 -->
        <div class="flex items-center justify-between gap-4 border-b border-white/30 p-4 dark:border-white/5">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">通过插件扩展音乐源</div>
          <SettingHint severity="warning" text="支持从本地文件或网络 URL 安装 JS 插件，安装后可通过插件拉取在线音乐、歌单、歌词等内容。" />
        </div>

        <!-- 操作按钮组 -->
        <div class="p-4 flex items-center gap-2 settings-plugin-toolbar">
          <button
            type="button"
            class="settings-plugin-button"
            :class="{ 'settings-plugin-button--active': showInstallFromFilePanel }"
            @click="toggleInstallFromFilePanel"
          >
            <PackageOpen class="h-4 w-4" />
            本地安装
          </button>

          <button
            type="button"
            class="settings-plugin-button"
            :class="{ 'settings-plugin-button--active': showInstallFromUrlDialog }"
            @click="toggleInstallFromUrlDialog"
          >
            <Globe class="h-4 w-4" />
            网络链接
          </button>

          <button
            type="button"
            class="settings-plugin-button"
            :class="{ 'settings-plugin-button--active': showSubscriptionPanel }"
            @click="toggleSubscriptionPanel"
          >
            <Link2 class="h-4 w-4" />
            订阅管理
          </button>

          <button
            type="button"
            class="settings-plugin-button settings-plugin-button--danger settings-plugin-button--uninstall"
            :disabled="plugins.length === 0"
            :class="{ 'settings-plugin-button--disabled': plugins.length === 0 }"
            @click="handleUninstallAll"
          >
            <Trash2 class="h-4 w-4" />
            卸载全部
          </button>
        </div>

        <!-- 本地安装拖放面板（展开） -->
        <transition name="settings-pop-panel">
          <div v-if="showInstallFromFilePanel" class="px-4 pb-4">
            <div class="settings-plugin-inline-panel">
              <div
                class="settings-plugin-dropzone"
                :class="{ 'settings-plugin-dropzone--active': isDragOverDropZone }"
                @click="handleInstallFromFile"
              >
                <div class="settings-plugin-dropzone-icon">
                  <UploadCloud class="h-8 w-8" />
                </div>
                <div class="settings-plugin-dropzone-title">
                  点击选择文件或拖拽到此处
                </div>
                <SettingHint severity="warning" class="absolute right-4 top-4" text="支持 .js 或 .json 格式的插件文件" />
              </div>
              <div class="flex justify-end mt-3">
                <button
                  type="button"
                  class="settings-plugin-button settings-plugin-button--ghost"
                  @click="toggleInstallFromFilePanel"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </transition>

        <!-- 从 URL 安装的输入行（展开） -->
        <transition name="settings-pop-panel">
          <div v-if="showInstallFromUrlDialog" class="px-4 pb-4">
            <div class="settings-plugin-inline-panel">
              <div class="flex items-center justify-between gap-4">
                <div class="shrink-0 text-sm font-medium text-gray-800 dark:text-gray-200">插件地址</div>
                <div class="flex min-w-0 flex-1 items-center gap-3">
                  <SettingHint severity="warning" text="粘贴插件的 JS 文件直链或 JSON 索引地址" />
                  <input
                    v-model="installUrl"
                    type="text"
                    placeholder="https://example.com/plugin.js"
                    class="settings-plugin-input flex-1"
                    @keydown.enter="handleInstallFromUrl"
                  />
                  <button
                    type="button"
                    class="settings-plugin-button"
                    @click="handleInstallFromUrl"
                  >
                    <Download class="h-4 w-4" />
                    安装
                  </button>
                  <button
                    type="button"
                    class="settings-plugin-button settings-plugin-button--ghost"
                    @click="toggleInstallFromUrlDialog(); installUrl = ''"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        </transition>

        <!-- 订阅面板（展开） -->
        <transition name="settings-pop-panel">
          <div v-if="showSubscriptionPanel" class="px-4 pb-4">
            <div class="settings-plugin-inline-panel">
              <div class="flex items-center justify-between mb-3 gap-2">
                <div class="text-sm font-medium text-gray-800 dark:text-gray-200">订阅管理</div>
                <div class="flex shrink-0 items-center gap-3">
                  <SettingHint severity="warning" text="订阅可自动同步远端插件列表，方便一次性安装多个来源" />
                  <button
                    type="button"
                    class="settings-plugin-button settings-plugin-button--sm settings-plugin-button--secondary"
                    :disabled="syncingAll || subscriptions.length === 0"
                    :class="{ 'settings-plugin-button--disabled': syncingAll || subscriptions.length === 0 }"
                    :title="subscriptions.length === 0 ? '暂无订阅' : '拉取所有订阅并安装插件'"
                    @click="handleSyncAllSubscriptions"
                  >
                    <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': syncingAll }" />
                    {{ syncingAll ? '同步中...' : '更新全部' }}
                  </button>
                  <button
                    type="button"
                    class="settings-plugin-button settings-plugin-button--sm"
                    @click="handleAddSubscription"
                  >
                    {{ showAddSubscriptionInput ? '取消' : '添加订阅' }}
                  </button>
                </div>
              </div>

              <!-- 添加订阅输入行 -->
              <transition name="settings-pop-panel">
                <div v-if="showAddSubscriptionInput" class="mb-3">
                  <div class="flex items-center gap-3">
                    <input
                      v-model="newSubscriptionUrl"
                      type="text"
                      placeholder="https://example.com/subscription.json"
                      class="settings-plugin-input flex-1"
                      @keydown.enter="confirmAddSubscription"
                    />
                    <button
                      type="button"
                      class="settings-plugin-button"
                      @click="confirmAddSubscription"
                    >
                      <Download class="h-4 w-4" />
                      添加
                    </button>
                  </div>
                </div>
              </transition>

              <div v-if="subscriptions.length === 0 && !showAddSubscriptionInput" class="settings-plugin-empty">
                暂无订阅源，点击「添加订阅」导入
              </div>
              <div v-else class="flex flex-col gap-2">
                <div
                  v-for="sub in subscriptions"
                  :key="sub.id"
                  class="flex items-center gap-3 p-2.5 rounded-lg bg-white/50 dark:bg-white/5 border border-black/5 dark:border-white/5"
                >
                  <div class="min-w-0 flex-1">
                    <!-- 名称：非编辑态可点击编辑，编辑态显示 input -->
                    <input
                      v-if="editingSubId === sub.id"
                      v-model="editingSubName"
                      type="text"
                      class="settings-plugin-input settings-plugin-input--inline text-sm font-medium"
                      @keydown.enter="saveSubName(sub)"
                      @keydown.esc="cancelEditSubName"
                      @blur="saveSubName(sub)"
                    />
                    <div
                      v-else
                      class="text-sm font-medium text-gray-800 dark:text-gray-100 truncate cursor-text hover:text-[#EC4141] transition-colors"
                      :title="`点击编辑「${sub.name}」名称`"
                      @click="startEditSubName(sub)"
                    >
                      {{ sub.name || sub.url }}
                    </div>
                    <div class="text-xs text-gray-500 dark:text-white/50 truncate">{{ sub.url }}</div>
                    <!-- 上次同步状态 -->
                    <div
                      v-if="sub.lastSyncAt"
                      class="flex items-center gap-1.5 mt-0.5 text-[11px] truncate"
                      :class="sub.lastSyncStatus === 'failed' ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-white/40'"
                      :title="sub.lastSyncMessage"
                    >
                      <span
                        class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                        :class="{
                          'bg-green-500': sub.lastSyncStatus === 'success',
                          'bg-amber-500': sub.lastSyncStatus === 'partial',
                          'bg-red-500': sub.lastSyncStatus === 'failed',
                        }"
                      ></span>
                      <span class="truncate">上次同步: {{ formatRelativeTime(sub.lastSyncAt) }} · {{ sub.lastSyncCount ?? 0 }} 个</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="settings-plugin-icon-button"
                    :disabled="isPluginBusy"
                    :class="{ 'settings-plugin-icon-button--updating': isPluginBusy }"
                    title="从订阅安装"
                    @click="handleInstallFromSubscription(sub)"
                  >
                    <Download class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="settings-plugin-icon-button settings-plugin-icon-button--danger"
                    title="移除订阅"
                    @click="handleRemoveSubscription(sub)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </section>

    <!-- 插件设置 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        插件设置
      </h2>
      <div class="space-y-1 rounded-lg border border-black/5 dark:border-white/5 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
        <!-- 启动时自动更新插件 -->
        <div class="flex items-center justify-between px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
          <div class="flex items-center gap-3 min-w-0">
            <RefreshCw class="h-4 w-4 text-gray-400 shrink-0" />
            <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">启动时自动更新插件</p>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint severity="warning" text="软件启动时自动检查并安装插件更新" />
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
              :class="pluginSettings.autoUpdateOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="togglePluginSetting('autoUpdateOnStartup')"
            >
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="pluginSettings.autoUpdateOnStartup ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
        </div>
        <!-- 插件懒加载 -->
        <div class="flex items-center justify-between px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
          <div class="flex items-center gap-3 min-w-0">
            <Puzzle class="h-4 w-4 text-gray-400 shrink-0" />
            <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">插件懒加载</p>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint text="首次使用时才初始化插件，加快启动速度" />
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
              :class="pluginSettings.lazyLoad ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="togglePluginSetting('lazyLoad')"
            >
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="pluginSettings.lazyLoad ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
        </div>
        <!-- 安装时不校验版本 -->
        <div class="flex items-center justify-between px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
          <div class="flex items-center gap-3 min-w-0">
            <FileCode2 class="h-4 w-4 text-gray-400 shrink-0" />
            <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">安装时不校验版本</p>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint severity="warning" text="允许安装相同或更低版本的插件" />
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
              :class="pluginSettings.skipVersionCheck ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="togglePluginSetting('skipVersionCheck')"
            >
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="pluginSettings.skipVersionCheck ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 插件列表 -->
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          已安装插件
        </h2>
        <div class="flex items-center gap-3">
          <div class="text-xs text-gray-500 dark:text-white/55">
            {{ pluginStatsLabel }}
          </div>
          <button
            type="button"
            class="settings-plugin-button settings-plugin-button--secondary settings-plugin-button--sm"
            :disabled="checkingUpdates || plugins.length === 0"
            :class="{ 'settings-plugin-button--disabled': checkingUpdates || plugins.length === 0 }"
            @click="handleCheckAllUpdates"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': checkingUpdates }" />
            {{ checkingUpdates ? '检查中...' : '检查全部更新' }}
          </button>
        </div>
      </div>

      <!-- 搜索栏 -->
      <div class="settings-plugin-search">
        <Search class="h-4 w-4 text-gray-400 shrink-0" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索插件名称、平台或作者"
          class="bg-transparent outline-none flex-1 text-sm placeholder-gray-400 text-gray-800 dark:text-gray-100"
        />
      </div>

      <!-- 空状态 -->
      <div
        v-if="plugins.length === 0"
        class="flex flex-col items-center justify-center py-12 text-center"
      >
        <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center justify-center mb-4">
          <Puzzle class="h-7 w-7 text-gray-400 dark:text-white/40" />
        </div>
        <div class="text-sm font-medium text-gray-600 dark:text-gray-300">还没有安装任何插件</div>
        <div class="text-xs text-gray-400 dark:text-white/45 mt-1.5">
          从本地文件、网络 URL 或订阅源安装插件后，会在这里显示
        </div>
      </div>

      <!-- 无搜索结果 -->
      <div
        v-else-if="filteredPlugins.length === 0"
        class="flex flex-col items-center justify-center py-8 text-center"
      >
        <div class="text-sm text-gray-500 dark:text-white/60">未找到匹配的插件</div>
      </div>

      <!-- 插件卡片 -->
      <div v-else ref="listRef">
      <TransitionGroup name="plugin-sort" tag="div" class="flex flex-col gap-2">
        <div
          v-for="(plugin, index) in filteredPlugins"
          :key="plugin.id"
          data-plugin-row
          class="settings-plugin-card"
          :class="{
            'settings-plugin-card--dragging': draggingIndex === index,
          }"
        >
          <!-- 拖拽手柄 -->
          <div
            class="plugin-drag-handle touch-none select-none"
            :class="{
              'plugin-drag-handle--disabled': !!searchQuery.trim(),
              'cursor-grabbing': draggingIndex === index,
              'cursor-grab': draggingIndex !== index,
            }"
            @pointerdown="startDragging(index, $event)"
          >
            <GripVertical class="h-5 w-5" />
          </div>

          <!-- 左侧：图标 + 信息 -->
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              :class="[pluginColorClasses(plugin.format).iconBg, pluginColorClasses(plugin.format).iconText]"
            >
              <Puzzle class="h-5 w-5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <div class="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                  {{ plugin.name }}
                </div>
                <span
                  class="settings-plugin-tag"
                  :class="pluginColorClasses(plugin.format).tagBg"
                >
                  {{ pluginColorClasses(plugin.format).label }}
                </span>
                <span
                  v-if="plugin.updateAvailable"
                  class="settings-plugin-tag settings-plugin-tag--accent"
                >
                  可更新
                </span>
              </div>
              <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5 truncate">
                v{{ plugin.version }}
                <span v-if="plugin.author"> · {{ plugin.author }}</span>
                <span v-if="plugin.description"> · {{ plugin.description }}</span>
              </div>
            </div>
          </div>

          <!-- 右侧：操作 -->
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              class="settings-plugin-icon-button"
              title="详情信息"
              @click="openPluginDetail(plugin)"
            >
              <Info class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="settings-plugin-icon-button"
              :class="{
                'settings-plugin-icon-button--updating': updatingPluginId === plugin.id,
                'settings-plugin-icon-button--update-available': !!updateCheckResults.get(plugin.id)?.hasUpdate,
              }"
              :disabled="updatingPluginId === plugin.id"
              :title="updateCheckResults.get(plugin.id)?.hasUpdate
                ? `${plugin.name} 可更新到 v${updateCheckResults.get(plugin.id)?.newVersion}，点击执行更新`
                : (updatingPluginId === plugin.id ? '正在更新...' : `检查 ${plugin.name} 的更新`)"
              @click="handleUpdatePlugin(plugin)"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': updatingPluginId === plugin.id }" />
            </button>
            <button
              type="button"
              class="settings-plugin-icon-button settings-plugin-icon-button--danger"
              title="卸载此插件"
              @click="handleUninstallPlugin(plugin)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
            <button
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ml-1"
              :class="plugin.enabled ? pluginColorClasses(plugin.format).toggle : 'bg-gray-300 dark:bg-gray-700'"
              @click="handleTogglePlugin(plugin)"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="plugin.enabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>
      </TransitionGroup>
      </div>
    </section>

    <!-- 卸载全部确认弹窗 -->
    <Teleport to="body">
      <Transition name="plugin-detail">
        <div
          v-if="showUninstallAllConfirm"
          class="fixed inset-0 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          :class="overlayZClass"
          @click.self="showUninstallAllConfirm = false"
        >
          <div class="plugin-detail-card">
            <div class="plugin-detail-header">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-xl bg-red-500/12 flex items-center justify-center shrink-0 text-red-500">
                  <Trash2 class="h-5 w-5" />
                </div>
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-gray-800 dark:text-gray-100">卸载全部插件</div>
                  <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5">此操作不可撤销</div>
                </div>
              </div>
              <button
                type="button"
                class="plugin-detail-close"
                aria-label="关闭"
                @click="showUninstallAllConfirm = false"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="plugin-detail-body">
              <p class="text-sm text-gray-600 dark:text-white/70 leading-relaxed">
                确认要卸载全部 <strong class="text-[#EC4141]">{{ plugins.length }}</strong> 个插件吗？卸载后无法恢复，需重新安装。
              </p>
              <div class="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  class="settings-plugin-button settings-plugin-button--ghost"
                  @click="showUninstallAllConfirm = false"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="settings-plugin-button settings-plugin-button--danger"
                  @click="confirmUninstallAll"
                >
                  <Trash2 class="h-4 w-4" />
                  确认卸载
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 卸载单个插件确认弹窗 -->
    <Teleport to="body">
      <Transition name="plugin-detail">
        <div
          v-if="showUninstallPluginConfirm"
          class="fixed inset-0 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          :class="overlayZClass"
          @click.self="showUninstallPluginConfirm = false"
        >
          <div class="plugin-detail-card">
            <div class="plugin-detail-header">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-xl bg-red-500/12 flex items-center justify-center shrink-0 text-red-500">
                  <Trash2 class="h-5 w-5" />
                </div>
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-gray-800 dark:text-gray-100">卸载插件</div>
                  <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5">此操作不可撤销</div>
                </div>
              </div>
              <button
                type="button"
                class="plugin-detail-close"
                aria-label="关闭"
                @click="showUninstallPluginConfirm = false"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="plugin-detail-body">
              <p class="text-sm text-gray-600 dark:text-white/70 leading-relaxed">
                确认要卸载插件 <strong class="text-[#EC4141]">{{ pendingUninstallPlugin?.name }}</strong> 吗？卸载后无法恢复，需重新安装。
              </p>
              <div class="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  class="settings-plugin-button settings-plugin-button--ghost"
                  @click="showUninstallPluginConfirm = false"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="settings-plugin-button settings-plugin-button--danger"
                  @click="confirmUninstallPlugin"
                >
                  <Trash2 class="h-4 w-4" />
                  确认卸载
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 移除订阅确认弹窗 -->
    <Teleport to="body">
      <Transition name="plugin-detail">
        <div
          v-if="showRemoveSubscriptionConfirm"
          class="fixed inset-0 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          :class="overlayZClass"
          @click.self="showRemoveSubscriptionConfirm = false"
        >
          <div class="plugin-detail-card">
            <div class="plugin-detail-header">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-xl bg-red-500/12 flex items-center justify-center shrink-0 text-red-500">
                  <Trash2 class="h-5 w-5" />
                </div>
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-gray-800 dark:text-gray-100">移除订阅</div>
                  <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5">此操作不可撤销</div>
                </div>
              </div>
              <button
                type="button"
                class="plugin-detail-close"
                aria-label="关闭"
                @click="showRemoveSubscriptionConfirm = false"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="plugin-detail-body">
              <p class="text-sm text-gray-600 dark:text-white/70 leading-relaxed">
                确认要移除订阅 <strong class="text-[#EC4141]">{{ pendingRemoveSubscription?.name }}</strong> 吗？移除后需重新添加。
              </p>
              <div class="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  class="settings-plugin-button settings-plugin-button--ghost"
                  @click="showRemoveSubscriptionConfirm = false"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="settings-plugin-button settings-plugin-button--danger"
                  @click="confirmRemoveSubscription"
                >
                  <Trash2 class="h-4 w-4" />
                  确认移除
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 插件详情弹窗 -->
    <Teleport to="body">
      <Transition name="plugin-detail">
        <div
          v-if="detailPlugin"
          class="fixed inset-0 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          :class="overlayZClass"
          @click.self="closePluginDetail"
        >
          <div class="plugin-detail-card">
            <!-- 头部 -->
            <div class="plugin-detail-header">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-[#EC4141]/12 to-[#ff8b8b]/12 flex items-center justify-center shrink-0 text-[#EC4141]">
                  <Puzzle class="h-5 w-5" />
                </div>
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{{ detailPlugin.name }}</div>
                  <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5">
                    {{ detailPlugin.format === 'lx' ? '落雪格式' : 'MusicFree 格式' }}
                  </div>
                </div>
              </div>
              <button
                type="button"
                class="plugin-detail-close"
                aria-label="关闭"
                @click="closePluginDetail"
              >
                <X class="h-4 w-4" />
              </button>
            </div>

            <!-- 信息列表 -->
            <div class="plugin-detail-body">
              <div class="plugin-detail-row">
                <span class="plugin-detail-label">版本</span>
                <span class="plugin-detail-value">v{{ detailPlugin.version || '—' }}</span>
              </div>
              <div class="plugin-detail-row">
                <span class="plugin-detail-label">作者</span>
                <span class="plugin-detail-value">{{ detailPlugin.author || '—' }}</span>
              </div>
              <div class="plugin-detail-row">
                <span class="plugin-detail-label">描述</span>
                <span class="plugin-detail-value">{{ detailPlugin.description || '—' }}</span>
              </div>
              <div class="plugin-detail-row">
                <span class="plugin-detail-label">音源</span>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="src in detailPlugin.sources"
                    :key="src"
                    class="settings-plugin-tag"
                  >{{ src }}</span>
                  <span v-if="detailPlugin.sources.length === 0" class="plugin-detail-value">—</span>
                </div>
              </div>
              <div class="plugin-detail-row">
                <span class="plugin-detail-label">插件链接</span>
                <button
                  type="button"
                  class="plugin-detail-link"
                  :title="detailPlugin.filePath || ''"
                  @click="copyPluginLink"
                >
                  <Copy class="h-3.5 w-3.5 shrink-0" />
                  <span class="truncate">{{ detailPlugin.filePath || '—' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>

</template>

<style scoped>
.settings-plugin-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid rgba(236, 65, 65, 0.18);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
  cursor: pointer;
}

.settings-plugin-button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(236, 65, 65, 0.1);
  box-shadow: 0 10px 20px rgba(236, 65, 65, 0.08);
}

.settings-plugin-button--active {
  border-color: rgba(236, 65, 65, 0.5);
  background: rgba(236, 65, 65, 0.14);
  color: #c42f2f;
}

.settings-plugin-button--active:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.6);
  background: rgba(236, 65, 65, 0.18);
}

/* 工具栏：确保所有按钮在同一行，卸载全部靠右 */
.settings-plugin-toolbar {
  flex-wrap: nowrap;
}

.settings-plugin-button--uninstall {
  margin-left: auto;
}

.settings-plugin-button--secondary {
  border-color: rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.55);
  color: rgba(55, 65, 81, 0.85);
}

.settings-plugin-button--secondary:hover:not(:disabled) {
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(255, 255, 255, 0.85);
  color: rgb(31 41 55);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
}

.settings-plugin-button--danger {
  border-color: rgba(220, 38, 38, 0.24);
  background: rgba(220, 38, 38, 0.06);
  color: rgb(220 38 38);
}

.settings-plugin-button--danger:hover:not(:disabled) {
  border-color: rgba(220, 38, 38, 0.4);
  background: rgba(220, 38, 38, 0.1);
  box-shadow: 0 10px 20px rgba(220, 38, 38, 0.08);
}

.settings-plugin-button--ghost {
  border-color: rgba(148, 163, 184, 0.2);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.settings-plugin-button--ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.4);
  color: rgb(31 41 55);
}

.settings-plugin-button--sm {
  min-height: 32px;
  padding: 0 12px;
  font-size: 11px;
}

.settings-plugin-button--disabled,
.settings-plugin-button:disabled {
  border-color: rgba(148, 163, 184, 0.14);
  background: rgba(255, 255, 255, 0.35);
  color: rgba(100, 116, 139, 0.7);
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

.settings-plugin-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 32px;
  border-radius: 999px;
  color: rgba(75, 85, 99, 0.85);
  transition: background-color 160ms ease, color 160ms ease, transform 160ms ease;
  cursor: pointer;
}

.settings-plugin-icon-button:hover {
  background: rgba(15, 23, 42, 0.06);
  color: rgb(17 24 39);
  transform: translateY(-1px);
}

.settings-plugin-icon-button--danger:hover {
  background: rgba(220, 38, 38, 0.1);
  color: rgb(220 38 38);
}

/* 更新进行中：禁用并保留图标颜色 */
.settings-plugin-icon-button--updating {
  cursor: progress;
  opacity: 0.7;
  transform: none;
}

.settings-plugin-icon-button--updating:hover {
  background: transparent;
  transform: none;
}

/* 有可用更新：醒目高亮，提示用户点击执行更新 */
.settings-plugin-icon-button--update-available {
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
}

.settings-plugin-icon-button--update-available:hover {
  background: rgba(236, 65, 65, 0.2);
  color: #c42f2f;
}

.settings-plugin-input {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  color: rgb(55 65 81);
  font-size: 13px;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.settings-plugin-input:focus {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

/* 订阅名称内联编辑输入框：更紧凑，铺满名称列 */
.settings-plugin-input--inline {
  width: 100%;
  min-height: 28px;
  padding: 2px 10px;
  border-radius: 8px;
  font-size: 13px;
}

.settings-plugin-inline-panel {
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  padding-top: 14px;
}

.settings-plugin-dropzone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 20px;
  border: 2px dashed rgba(148, 163, 184, 0.35);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition:
    border-color 200ms ease,
    background-color 200ms ease,
    transform 200ms ease;
}

.settings-plugin-dropzone:hover {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(236, 65, 65, 0.04);
  transform: translateY(-1px);
}

.settings-plugin-dropzone--active {
  border-color: rgba(236, 65, 65, 0.6);
  background: rgba(236, 65, 65, 0.08);
  transform: scale(1.01);
}

.settings-plugin-dropzone-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
  transition: background-color 200ms ease, color 200ms ease;
}

.settings-plugin-dropzone--active .settings-plugin-dropzone-icon {
  background: rgba(236, 65, 65, 0.16);
}

.settings-plugin-dropzone-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(55, 65, 81, 0.9);
}

.settings-plugin-dropzone-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: rgba(100, 116, 139, 0.8);
}

.settings-plugin-search {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.settings-plugin-search:focus-within {
  border-color: rgba(236, 65, 65, 0.3);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

.settings-plugin-empty {
  padding: 20px 0;
  text-align: center;
  color: rgba(100, 116, 139, 0.7);
  font-size: 12px;
}

.settings-plugin-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.6);
  transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}

.settings-plugin-card:hover {
  transform: translateY(-1px);
  border-color: rgba(236, 65, 65, 0.22);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 12px 26px rgba(15, 23, 42, 0.06);
}

/* 拖拽手柄 */
.plugin-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: rgba(148, 163, 184, 0.6);
  cursor: grab;
  flex-shrink: 0;
  transition: color 160ms ease, background-color 160ms ease;
}

.plugin-drag-handle:hover {
  color: rgba(100, 116, 139, 0.9);
  background: rgba(148, 163, 184, 0.1);
}

.plugin-drag-handle:active {
  cursor: grabbing;
}

.plugin-drag-handle--disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* 拖拽中的卡片 */
.settings-plugin-card--dragging {
  border-color: rgba(236, 65, 65, 0.35);
  background: rgba(236, 65, 65, 0.06);
  box-shadow: 0 8px 20px rgba(236, 65, 65, 0.12);
}

/* FLIP 排序动画 */
.plugin-sort-move {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .plugin-sort-move {
    transition: none;
  }
}

.settings-plugin-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: rgba(55, 65, 81, 0.9);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.4;
}

.settings-plugin-tag--accent {
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
}

.settings-pop-panel-enter-active,
.settings-pop-panel-leave-active {
  transition:
    opacity 220ms ease,
    transform 240ms ease,
    max-height 240ms ease;
  transform-origin: top center;
  overflow: hidden;
}

.settings-pop-panel-enter-from,
.settings-pop-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
  max-height: 0;
}

.settings-pop-panel-enter-to,
.settings-pop-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 400px;
}

/* 导入歌单按钮 */
.settings-plugin-import-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid rgba(249, 115, 22, 0.24);
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.06);
  color: rgb(249, 115, 22);
  font-size: 11px;
  font-weight: 600;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
  cursor: pointer;
  white-space: nowrap;
}

.settings-plugin-import-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(249, 115, 22, 0.4);
  background: rgba(249, 115, 22, 0.12);
}

@media (max-width: 640px) {
  .settings-plugin-import-btn__text {
    display: none;
  }
  .settings-plugin-import-btn {
    padding: 0 8px;
  }
}

/* 插件详情弹窗 */
.plugin-detail-card {
  width: min(92vw, 460px);
  background: #ffffff;
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.plugin-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.plugin-detail-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  color: rgba(75, 85, 99, 0.8);
  transition: background-color 160ms ease, color 160ms ease;
  cursor: pointer;
  flex-shrink: 0;
}

.plugin-detail-close:hover {
  background: rgba(15, 23, 42, 0.06);
  color: rgb(17 24 39);
}

.plugin-detail-body {
  padding: 14px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.plugin-detail-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.plugin-detail-label {
  flex-shrink: 0;
  width: 64px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(100, 116, 139, 0.9);
  padding-top: 2px;
}

.plugin-detail-value {
  min-width: 0;
  flex: 1;
  font-size: 13px;
  color: #1f2937;
  line-height: 1.55;
  word-break: break-word;
}

.plugin-detail-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
  font-size: 12px;
  font-weight: 500;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  transition: background-color 160ms ease;
  cursor: pointer;
  border: none;
}

.plugin-detail-link:hover {
  background: rgba(236, 65, 65, 0.12);
}

/* 弹窗过渡动画 */
.plugin-detail-enter-active,
.plugin-detail-leave-active {
  transition: opacity 0.2s ease;
}

.plugin-detail-enter-active .plugin-detail-card,
.plugin-detail-leave-active .plugin-detail-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.plugin-detail-enter-from,
.plugin-detail-leave-to {
  opacity: 0;
}

.plugin-detail-enter-from .plugin-detail-card,
.plugin-detail-leave-to .plugin-detail-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<style>
/* ==================== 暗色模式适配 ==================== */
.dark .plugin-drag-handle {
  color: rgba(255, 255, 255, 0.5);
}

.dark .plugin-drag-handle:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.1);
}

.dark .settings-plugin-card--dragging {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(236, 65, 65, 0.1);
}

.dark .settings-plugin-button--secondary {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
}

.dark .settings-plugin-button--secondary:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.09);
  color: rgba(255, 255, 255, 0.96);
}

.dark .settings-plugin-button--active {
  border-color: rgba(236, 65, 65, 0.55);
  background: rgba(236, 65, 65, 0.2);
  color: #ff8b8b;
}

.dark .settings-plugin-button--active:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.65);
  background: rgba(236, 65, 65, 0.24);
}

.dark .settings-plugin-button--ghost {
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.65);
}

.dark .settings-plugin-button--ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}

.dark .settings-plugin-button--disabled,
.dark .settings-plugin-button:disabled {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.35);
}

.dark .settings-plugin-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

.dark .settings-plugin-input:focus {
  border-color: rgba(236, 65, 65, 0.4);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.14);
}

.dark .settings-plugin-inline-panel {
  border-top-color: rgba(255, 255, 255, 0.08);
}

.dark .settings-plugin-dropzone {
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.03);
}

.dark .settings-plugin-dropzone:hover {
  border-color: rgba(236, 65, 65, 0.45);
  background: rgba(236, 65, 65, 0.06);
}

.dark .settings-plugin-dropzone--active {
  border-color: rgba(236, 65, 65, 0.6);
  background: rgba(236, 65, 65, 0.1);
}

.dark .settings-plugin-dropzone-icon {
  background: rgba(236, 65, 65, 0.14);
  color: #ff6b6b;
}

.dark .settings-plugin-dropzone--active .settings-plugin-dropzone-icon {
  background: rgba(236, 65, 65, 0.22);
}

.dark .settings-plugin-dropzone-title {
  color: rgba(255, 255, 255, 0.9);
}

.dark .settings-plugin-dropzone-hint {
  color: rgba(255, 255, 255, 0.45);
}

.dark .settings-plugin-search {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.07);
}

.dark .settings-plugin-search:focus-within {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(255, 255, 255, 0.07);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.14);
}

.dark .settings-plugin-empty {
  color: rgba(255, 255, 255, 0.4);
}

.dark .settings-plugin-card {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.08);
}

.dark .settings-plugin-card:hover {
  border-color: rgba(236, 65, 65, 0.35);
  background: rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.18);
}

.dark .settings-plugin-tag {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.dark .settings-plugin-tag--accent {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

.dark .settings-plugin-icon-button {
  color: rgba(255, 255, 255, 0.85);
}

.dark .settings-plugin-icon-button:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 1);
}

.dark .settings-plugin-icon-button--danger:hover {
  background: rgba(220, 38, 38, 0.18);
  color: #ff6b6b;
}

.dark .settings-plugin-icon-button--update-available {
  background: rgba(236, 65, 65, 0.2);
  color: #ff8b8b;
}

.dark .settings-plugin-icon-button--update-available:hover {
  background: rgba(236, 65, 65, 0.28);
  color: #ffa6a6;
}

.dark .settings-plugin-import-btn {
  border-color: rgba(249, 115, 22, 0.2);
  background: rgba(249, 115, 22, 0.1);
  color: rgb(251, 146, 60);
}

.dark .settings-plugin-import-btn:hover {
  border-color: rgba(249, 115, 22, 0.36);
  background: rgba(249, 115, 22, 0.16);
}

.dark .plugin-detail-card {
  background: #1f1f23;
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

.dark .plugin-detail-header {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.dark .plugin-detail-close {
  color: rgba(255, 255, 255, 0.7);
}

.dark .plugin-detail-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.96);
}

.dark .plugin-detail-label {
  color: rgba(255, 255, 255, 0.5);
}

.dark .plugin-detail-value {
  color: rgba(255, 255, 255, 0.88);
}

.dark .plugin-detail-link {
  background: rgba(236, 65, 65, 0.14);
  color: #ff8b8b;
}

.dark .plugin-detail-link:hover {
  background: rgba(236, 65, 65, 0.22);
}
</style>
