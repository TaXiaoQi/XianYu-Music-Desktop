<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { Puzzle, Trash2, RefreshCw, Search, PackageOpen, Globe, Link2, Download } from 'lucide-vue-next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../../composables/toast';
import type { PluginSource } from '../../types';
import { getStoredPlugins, addPluginSource, removePluginSource, togglePlugin, loadPlugins } from '../../services/pluginEngine';
import { isLxPluginScript, loadLxPluginFromScript, parseLxScriptInfo } from '../../services/lxPluginEngine';

const { showToast } = useToast();

// 启动时加载已启用的插件
onMounted(() => {
  void loadPlugins();
});

// UI 状态
const searchQuery = ref('');
const showSubscriptionPanel = ref(false);
const showInstallFromUrlDialog = ref(false);
const installUrl = ref('');

// 插件列表（从 localStorage 读取）
const plugins = ref<PluginSource[]>(getStoredPlugins());
const subscriptions = ref<{ id: string; name: string; url: string }[]>([]);

const isPluginBusy = ref(false);

const filteredPlugins = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase();
  if (!keyword) return plugins.value;
  return plugins.value.filter((p) =>
    p.name.toLowerCase().includes(keyword) ||
    p.sources.join(',').toLowerCase().includes(keyword) ||
    (p.author?.toLowerCase().includes(keyword) ?? false)
  );
});

const pluginStatsLabel = computed(() => {
  const total = plugins.value.length;
  const enabled = plugins.value.filter((p) => p.enabled).length;
  return `共 ${total} 个插件，已启用 ${enabled} 个`;
});

function refreshPluginList() {
  plugins.value = getStoredPlugins();
}

// ==================== 从本地文件安装 ====================

async function handleInstallFromFile() {
  try {
    const selected = await openDialog({
      title: '选择插件文件',
      filters: [{ name: 'JavaScript 插件', extensions: ['js'] }],
      multiple: false,
    });
    if (!selected || typeof selected !== 'string') return;

    const filePath = selected as string;
    isPluginBusy.value = true;

    // 通过后端读取文件内容
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

// ==================== 从网络 URL 安装 ====================

async function handleInstallFromUrl() {
  const url = installUrl.value.trim();
  if (!url) {
    showToast('请输入插件 URL', 'error');
    return;
  }

  isPluginBusy.value = true;
  try {
    // 通过后端 HTTP 代理获取插件脚本
    const { pluginApi } = await import('../../services/tauri/pluginApi');
    const resp = await pluginApi.pluginHttpRequest('GET', url, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
    }, undefined, 15000);
    if (resp.status < 200 || resp.status >= 300 || !resp.body) {
      showToast(`下载失败: HTTP ${resp.status}`, 'error');
      return;
    }
    await installPluginFromScript(resp.body, url);
    installUrl.value = '';
    showInstallFromUrlDialog.value = false;
  } catch (e: any) {
    showToast(`安装失败: ${e?.message || e}`, 'error');
  } finally {
    isPluginBusy.value = false;
  }
}

// ==================== 核心安装逻辑 ====================

async function installPluginFromScript(script: string, filePath: string) {
  // 检测插件格式
  if (isLxPluginScript(script)) {
    // 落雪 LX 插件
    const scriptInfo = parseLxScriptInfo(script);
    showToast(`正在加载落雪插件: ${scriptInfo.name || filePath}…`, 'info');

    const source = await loadLxPluginFromScript(script, filePath);
    if (!source) {
      showToast('插件加载失败', 'error');
      return;
    }
    addPluginSource(source);
    refreshPluginList();
    showToast(`成功安装插件: ${source.name}`, 'success');
  } else {
    // 暂不支持 MusicFree 格式
    showToast('暂不支持此插件格式，仅支持落雪(LX)插件', 'error');
  }
}

// ==================== 插件管理 ====================

async function handleUpdateAll() {
  showToast('暂不支持批量更新，请重新导入插件', 'info');
}

async function handleUninstallAll() {
  if (plugins.value.length === 0) return;
  for (const p of [...plugins.value]) {
    removePluginSource(p.id);
  }
  refreshPluginList();
  showToast('已卸载全部插件', 'success');
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

async function handleUpdatePlugin(plugin: PluginSource) {
  showToast(`请重新导入 ${plugin.name} 以更新`, 'info');
}

async function handleUninstallPlugin(plugin: PluginSource) {
  removePluginSource(plugin.id);
  refreshPluginList();
  showToast(`已卸载 ${plugin.name}`, 'success');
}

// 打开订阅设置
function toggleSubscriptionPanel() {
  showSubscriptionPanel.value = !showSubscriptionPanel.value;
}

// 添加订阅源
function handleAddSubscription() {
  // TODO: 打开添加订阅对话框
  showToast('添加订阅：等待后端接入', 'info');
}

// 从订阅安装
function handleInstallFromSubscription(sub: Subscription) {
  // TODO: 从订阅 URL 拉取并安装
  showToast(`从订阅 ${sub.name} 安装：等待后端接入`, 'info');
}

// 移除订阅源
function handleRemoveSubscription(sub: Subscription) {
  // TODO: 调用后端移除订阅
  subscriptions.value = subscriptions.value.filter((s) => s.id !== sub.id);
  showToast(`已移除订阅 ${sub.name}`, 'success');
}
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <!-- 顶部操作栏 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        插件安装
      </h2>

      <div class="flex flex-col gap-3 rounded-xl">
        <!-- 描述 -->
        <div class="p-4 border-b border-white/30 dark:border-white/5">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">通过插件扩展音乐源</div>
          <div class="text-xs text-gray-500 dark:text-white/55 mt-1 leading-relaxed">
            支持从本地文件或网络 URL 安装 JS 插件，安装后可通过插件拉取在线音乐、歌单、歌词等内容。
          </div>
        </div>

        <!-- 操作按钮组 -->
        <div class="p-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="settings-plugin-button"
            @click="handleInstallFromFile"
          >
            <PackageOpen class="h-4 w-4" />
            从本地文件安装
          </button>

          <button
            type="button"
            class="settings-plugin-button"
            @click="showInstallFromUrlDialog = true"
          >
            <Globe class="h-4 w-4" />
            从网络安装
          </button>

          <button
            type="button"
            class="settings-plugin-button"
            @click="toggleSubscriptionPanel"
          >
            <Link2 class="h-4 w-4" />
            订阅管理
          </button>

          <div class="flex-1"></div>

          <button
            type="button"
            class="settings-plugin-button settings-plugin-button--secondary"
            :disabled="isPluginBusy || plugins.length === 0"
            :class="{ 'settings-plugin-button--disabled': isPluginBusy || plugins.length === 0 }"
            @click="handleUpdateAll"
          >
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isPluginBusy }" />
            更新全部
          </button>

          <button
            type="button"
            class="settings-plugin-button settings-plugin-button--danger"
            :disabled="plugins.length === 0"
            :class="{ 'settings-plugin-button--disabled': plugins.length === 0 }"
            @click="handleUninstallAll"
          >
            <Trash2 class="h-4 w-4" />
            卸载全部
          </button>
        </div>

        <!-- 从 URL 安装的输入行（展开） -->
        <transition name="settings-pop-panel">
          <div v-if="showInstallFromUrlDialog" class="px-4 pb-4">
            <div class="settings-plugin-inline-panel">
              <div class="text-xs text-gray-600 dark:text-white/60 mb-3">
                粘贴插件的 JS 文件直链或 JSON 索引地址
              </div>
              <div class="flex items-center gap-3">
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
                  @click="showInstallFromUrlDialog = false; installUrl = ''"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </transition>

        <!-- 订阅面板（展开） -->
        <transition name="settings-pop-panel">
          <div v-if="showSubscriptionPanel" class="px-4 pb-4">
            <div class="settings-plugin-inline-panel">
              <div class="flex items-center justify-between mb-3">
                <div class="text-xs text-gray-600 dark:text-white/60">
                  订阅可自动同步远端插件列表，方便一次性安装多个来源
                </div>
                <button
                  type="button"
                  class="settings-plugin-button settings-plugin-button--sm"
                  @click="handleAddSubscription"
                >
                  添加订阅
                </button>
              </div>

              <div v-if="subscriptions.length === 0" class="settings-plugin-empty">
                暂无订阅源
              </div>
              <div v-else class="flex flex-col gap-2">
                <div
                  v-for="sub in subscriptions"
                  :key="sub.id"
                  class="flex items-center gap-3 p-2.5 rounded-lg bg-white/50 dark:bg-white/5 border border-black/5 dark:border-white/5"
                >
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{{ sub.name }}</div>
                    <div class="text-xs text-gray-500 dark:text-white/50 truncate">{{ sub.url }}</div>
                  </div>
                  <button
                    type="button"
                    class="settings-plugin-icon-button"
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

    <!-- 插件列表 -->
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          已安装插件
        </h2>
        <div class="text-xs text-gray-500 dark:text-white/55">
          {{ pluginStatsLabel }}
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
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="plugin in filteredPlugins"
          :key="plugin.id"
          class="settings-plugin-card"
        >
          <!-- 左侧：图标 + 信息 -->
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-[#EC4141]/12 to-[#ff8b8b]/12 flex items-center justify-center shrink-0 text-[#EC4141]">
              <Puzzle class="h-5 w-5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <div class="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                  {{ plugin.name }}
                </div>
                <span class="settings-plugin-tag">{{ plugin.sources.join(', ') || 'LX' }}</span>
                <span
                  v-if="plugin.updateAvailable"
                  class="settings-plugin-tag settings-plugin-tag--accent"
                >
                  可更新
                </span>
              </div>
              <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5 truncate">
                v{{ plugin.version }}{{ plugin.format === 'lx' ? ' · 落雪' : '' }}
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
              title="更新此插件"
              @click="handleUpdatePlugin(plugin)"
            >
              <RefreshCw class="h-4 w-4" />
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
              :class="plugin.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="handleTogglePlugin(plugin)"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="plugin.enabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>
      </div>
    </section>
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

.settings-plugin-inline-panel {
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  padding-top: 14px;
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

:global(.dark) .settings-plugin-button--secondary {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
}

:global(.dark) .settings-plugin-button--secondary:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.09);
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .settings-plugin-button--ghost {
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.65);
}

:global(.dark) .settings-plugin-button--ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}

:global(.dark) .settings-plugin-button--disabled,
:global(.dark) .settings-plugin-button:disabled {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.35);
}

:global(.dark) .settings-plugin-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .settings-plugin-input:focus {
  border-color: rgba(236, 65, 65, 0.4);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.14);
}

:global(.dark) .settings-plugin-inline-panel {
  border-top-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .settings-plugin-search {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
}

:global(.dark) .settings-plugin-search:focus-within {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(255, 255, 255, 0.07);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.14);
}

:global(.dark) .settings-plugin-empty {
  color: rgba(255, 255, 255, 0.4);
}

:global(.dark) .settings-plugin-card {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

:global(.dark) .settings-plugin-card:hover {
  border-color: rgba(236, 65, 65, 0.3);
  background: rgba(255, 255, 255, 0.07);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.18);
}

:global(.dark) .settings-plugin-tag {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

:global(.dark) .settings-plugin-tag--accent {
  background: rgba(236, 65, 65, 0.18);
  color: #ff8b8b;
}

:global(.dark) .settings-plugin-icon-button {
  color: rgba(255, 255, 255, 0.7);
}

:global(.dark) .settings-plugin-icon-button:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .settings-plugin-icon-button--danger:hover {
  background: rgba(220, 38, 38, 0.18);
  color: #ff6b6b;
}
</style>
