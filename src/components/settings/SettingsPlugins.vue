<script setup lang="ts">
import { computed, defineAsyncComponent, provide, ref, watch, onMounted, onUnmounted } from 'vue';
import { Puzzle, Trash2, RefreshCw, Search, PackageOpen, Globe, Link2, FileCode2 } from 'lucide-vue-next';
import { useToast } from '../../composables/toast';
import type { PluginSource } from '../../types'; // 实现
import { getStoredPlugins, loadPlugins, removePluginSource, togglePlugin, log, pluginsVersion } from '../../services/domain/pluginEngine';
import { pluginApi } from '../../services/tauri/pluginApi';
import { useSettings } from '../../features/settings/useSettings';
import SettingHint, { SETTING_HINT_Z_INDEX } from './SettingHint.vue';
import { getCiyuanxiId } from '../../services/domain/playlistSync';
import { deleteCloudPlugins } from '../../services/domain/pluginSync';
import { getSyncedPluginIds, isPluginSynced, addDownloadSkipIds, addUploadSkipIds } from '../../services/domain/pluginSyncState';
import type { SyncDeleteScope } from '../overlays/SyncDeleteScopeModal.vue';
import { usePluginList } from '../../composables/settings/usePluginList';
import { usePluginBadges } from '../../composables/settings/usePluginBadges';
import { usePluginDragSort } from '../../composables/settings/usePluginDragSort';
import { usePluginInstall, PluginInstallCancelled } from '../../composables/settings/usePluginInstall';
import { usePluginSubscriptions } from '../../composables/settings/usePluginSubscriptions';
import { usePluginUpdates } from '../../composables/settings/usePluginUpdates';
import PluginLocalInstallPanel from './plugins/PluginLocalInstallPanel.vue';
import PluginUrlInstallPanel from './plugins/PluginUrlInstallPanel.vue';
import PluginSubscriptionPanel from './plugins/PluginSubscriptionPanel.vue';
import PluginCard from './plugins/PluginCard.vue';
import PluginDetailDialog from './plugins/PluginDetailDialog.vue';
import PluginConfirmDialog from './plugins/PluginConfirmDialog.vue';

const SyncDeleteScopeModal = defineAsyncComponent(() => import('../overlays/SyncDeleteScopeModal.vue'));

/** WebView fetch 的 body 下载超时：对齐移动端 bodyTimeout（60s） */
const BODY_DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * 取远程脚本文本。
 *
 * 优先走 Rust 原生请求：WebView 的 fetch 受同源策略约束，而不少音源站点只在错误响应上
 * 带 CORS 头（正常的 200 反而不带），浏览器侧必然被拦；原生请求还会带上统一 UA，避免被
 * 站点按 UA 拦截（移动端同类问题即由「改用带头的原生请求」解决）。启用网络代理时也只有
 * Rust 的网络栈走代理，浏览器 fetch 不受代理覆盖。
 * WebView fetch 仅作兜底，留给个别依赖浏览器会话/证书的场景。
 *
 * cancelled 为在线链接安装的取消探针：在请求发起前与失败回退的间隙响应取消，
 * 避免取消后仍继续空转后续请求（对齐移动端 fetchPluginScriptWithRetry 语义）。
 */
async function fetchRemoteScript(url: string, cancelled?: () => boolean): Promise<string> {
  if (cancelled?.()) throw new PluginInstallCancelled();
  try {
    return await pluginApi.fetchPluginUrl(url);
  } catch (e: any) {
    if (cancelled?.()) throw new PluginInstallCancelled();
    log(`[fetchRemoteScript] 原生请求失败，回退 WebView fetch: ${e?.message || e}`);
  }

  if (cancelled?.()) throw new PluginInstallCancelled();
  try {
    // body 下载超时兜底：connection/响应头超时只覆盖到收到响应头，body 中途断流时
    // text() 会永久挂起（导入进度条卡死的根因，对齐移动端 bodyTimeout 修复）
    const ctrl = new AbortController();
    const bodyTimer = setTimeout(() => ctrl.abort(), BODY_DOWNLOAD_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { method: 'GET', headers: { 'Accept': '*/*' }, signal: ctrl.signal });
      if (resp.ok) return await resp.text();
      log(`[fetchRemoteScript] WebView fetch 返回 HTTP ${resp.status}`);
    } finally {
      clearTimeout(bodyTimer);
    }
  } catch (e: any) {
    if (cancelled?.()) throw new PluginInstallCancelled();
    log(`[fetchRemoteScript] WebView fetch 失败（跨域被拦时即为此项）: ${e?.message || e}`);
  }

  log(`[fetchRemoteScript] 两种取数方式均失败: ${url}`);
  return '';
}
const props = withDefaults(defineProps<{
  overlayZClass?: string; // 实现
}>(), {
  overlayZClass: 'z-[200]', // 实现
});

const overlayZMatch = props.overlayZClass.match(/z-\[(\d+)\]/);
if (overlayZMatch) {
  provide(SETTING_HINT_Z_INDEX, parseInt(overlayZMatch[1], 10) + 100);
}

const { showToast } = useToast();
const { settings, patchSettings } = useSettings();

const pluginSettings = computed(() => settings.value.plugins);
function togglePluginSetting(key: 'autoUpdateOnStartup' | 'lazyLoad' | 'skipVersionCheck') {
  patchSettings({
    plugins: { [key]: !pluginSettings.value[key] },
  });
}

// ==================== 已安装插件列表 ====================
const {
  plugins,
  searchQuery,
  isPluginBusy,
  sortPlugins,
  filteredPlugins,
  refreshPluginList,
  pluginStatsLabel,
  allPluginsEnabled,
  handleToggleAllPlugins,
  subBrandLabelById,
} = usePluginList();

const {
  pluginsWithUserVars,
  pluginsBakaIds,
  refreshUserVarBadges,
  refreshBakaBadges,
} = usePluginBadges();

const {
  draggingIndex,
  listRef,
  startDragging,
  stopDragging,
} = usePluginDragSort({ plugins, filteredPlugins, searchQuery, sortPlugins });

// ==================== 安装面板显隐 ====================
const showSubscriptionPanel = ref(false);
const showInstallFromUrlDialog = ref(false);
const showInstallFromFilePanel = ref(false);

const {
  installUrl,
  isDragOverDropZone,
  setupDragDropListeners,
  handleInstallFromFile,
  handleInstallFromUrl,
} = usePluginInstall({
  fetchRemoteScript,
  refreshPluginList,
  pluginsBakaIds,
  pluginSettings,
  showInstallFromUrlDialog,
  showInstallFromFilePanel,
  isPluginBusy,
});

const {
  subscriptions,
  showAddSubscriptionInput,
  newSubscriptionUrl,
  syncingAll,
  editingSubId,
  editingSubName,
  showRemoveSubscriptionConfirm,
  pendingRemoveSubscription,
  handleAddSubscription,
  confirmAddSubscription,
  handleInstallFromSubscription,
  handleSyncAllSubscriptions,
  startEditSubName,
  saveSubName,
  cancelEditSubName,
  handleRemoveSubscription,
  confirmRemoveSubscription,
} = usePluginSubscriptions({ isPluginBusy, refreshPluginList, pluginSettings });

const {
  updateCheckResults,
  checkingUpdates,
  updatingPluginId,
  handleUpdatePlugin,
  handleCheckAllUpdates,
} = usePluginUpdates({ refreshPluginList });

onMounted(async () => { // 实现
  await loadPlugins(pluginSettings.value.lazyLoad);
  plugins.value = getStoredPlugins(); // 实现
  void refreshUserVarBadges();
  void refreshBakaBadges();
  setupDragDropListeners();
});

watch(pluginsVersion, () => {
  void refreshUserVarBadges();
  void refreshBakaBadges();
});

onUnmounted(() => {
  stopDragging();
}); // 实现

function toggleSubscriptionPanel() {
  const willOpen = !showSubscriptionPanel.value;
  if (willOpen) {
    showInstallFromUrlDialog.value = false;
    showInstallFromFilePanel.value = false;
  }
  showSubscriptionPanel.value = willOpen;
}

function toggleInstallFromUrlDialog() {
  const willOpen = !showInstallFromUrlDialog.value;
  if (willOpen) {
    showSubscriptionPanel.value = false;
    showInstallFromFilePanel.value = false;
  }
  showInstallFromUrlDialog.value = willOpen;
}

function toggleInstallFromFilePanel() {
  const willOpen = !showInstallFromFilePanel.value;
  if (willOpen) {
    showSubscriptionPanel.value = false;
    showInstallFromUrlDialog.value = false;
  }
  showInstallFromFilePanel.value = willOpen;
  isDragOverDropZone.value = false;
}

// ==================== 插件管理 ====================
const showUninstallAllConfirm = ref(false); // 实现

const showPluginDeleteScope = ref(false);
const pluginDeleteScopeIds = ref<string[]>([]);
const pluginScopeCanDeleteCloud = computed(() =>
  pluginDeleteScopeIds.value.some(id => getSyncedPluginIds().has(id)),
);

function handleUninstallAll() { // 实现
  if (plugins.value.length === 0) return; // 实现
  if (getCiyuanxiId() && plugins.value.some(p => isPluginSynced(p.id))) {
    pluginDeleteScopeIds.value = plugins.value.map(p => p.id);
    showPluginDeleteScope.value = true;
    return;
  }
  showUninstallAllConfirm.value = true; // 实现
}

function confirmUninstallAll() { // 实现
  for (const p of [...plugins.value]) { // 实现
    removePluginSource(p.id); // 实现
  } // 实现
  refreshPluginList(); // 实现
  showUninstallAllConfirm.value = false; // 实现
  showToast('已卸载全部插件', 'success'); // 实现
}

const showUninstallPluginConfirm = ref(false); // 实现
const pendingUninstallPlugin = ref<PluginSource | null>(null); // 实现

function handleUninstallPlugin(plugin: PluginSource) { // 实现
  if (getCiyuanxiId() && isPluginSynced(plugin.id)) {
    pluginDeleteScopeIds.value = [plugin.id];
    showPluginDeleteScope.value = true;
    return;
  }
  pendingUninstallPlugin.value = plugin; // 实现
  showUninstallPluginConfirm.value = true; // 实现
}

function confirmUninstallPlugin() { // 实现
  const plugin = pendingUninstallPlugin.value; // 实现
  if (!plugin) return; // 实现
  removePluginSource(plugin.id); // 实现
  refreshPluginList(); // 实现
  showUninstallPluginConfirm.value = false; // 实现
  pendingUninstallPlugin.value = null; // 实现
  showToast(`已卸载 ${plugin.name}`, 'success'); // 实现
}

async function confirmPluginDeleteScope(scope: SyncDeleteScope) {
  const ids = [...pluginDeleteScopeIds.value];
  showPluginDeleteScope.value = false;
  pluginDeleteScopeIds.value = [];
  if (ids.length === 0) return;
  const syncedIds = ids.filter(id => getSyncedPluginIds().has(id));

  if (scope === 'cloud') {
    if (syncedIds.length > 0) {
      const ok = await deleteCloudPlugins(syncedIds);
      if (!ok) {
        showToast('云端删除失败，请检查网络后重试', 'error');
        return;
      }
      addUploadSkipIds(syncedIds);
      showToast(`已从云端移除 ${syncedIds.length} 个插件，本机保留`, 'success');
    }
    return;
  }

  if (scope === 'all') {
    if (syncedIds.length > 0) {
      const ok = await deleteCloudPlugins(syncedIds);
      if (!ok) showToast('云端删除失败，其他设备可能仍会同步到该插件', 'error');
    }
    for (const id of ids) {
      removePluginSource(id);
    }
    refreshPluginList();
    showToast(`已删除 ${ids.length} 个插件`, 'success');
    return;
  }

  for (const id of ids) {
    removePluginSource(id);
  }
  addDownloadSkipIds(ids);
  refreshPluginList(); // 实现
  showToast(`已从本机删除 ${ids.length} 个插件（云端保留）`, 'success');
}

async function handleTogglePlugin(plugin: PluginSource) { // 实现
  const result = await togglePlugin(plugin.id); // 实现
  if (result.success) { // 实现
    refreshPluginList(); // 实现
    showToast(`${result.enabled ? '已启用' : '已禁用'} ${plugin.name}`, 'success'); // 实现
  } else { // 实现
    showToast(result.message || '操作失败', 'error'); // 实现
  } // 实现
}

// ==================== 插件详情弹窗 ====================
const detailPlugin = ref<PluginSource | null>(null); // 实现

function openPluginDetail(plugin: PluginSource) { // 实现
  detailPlugin.value = plugin; // 实现
}
</script>

<template>
  <div class="w-full space-y-8">
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        插件安装
      </h2>

      <div class="flex flex-col gap-3 rounded-xl">
        <div class="flex items-center justify-between gap-4 p-4">
          <div class="space-y-1 min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">通过插件扩展音乐源</div>
            <div class="text-xs text-amber-600 dark:text-amber-400">第三方插件由独立开发者编写，运行时将获取网络请求与音源检索能力。请仅从信任的来源安装或订阅。</div>
          </div>
          <SettingHint severity="warning" text="支持从本地文件或网络 URL 安装 JS 插件，安装后可通过插件拉取在线音乐、歌单、歌词等内容；请仅使用信任的来源。" />
        </div>

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

        <PluginLocalInstallPanel
          :visible="showInstallFromFilePanel"
          :is-drag-over-drop-zone="isDragOverDropZone"
          @select="handleInstallFromFile"
          @cancel="toggleInstallFromFilePanel"
        />

        <PluginUrlInstallPanel
          v-model="installUrl"
          :visible="showInstallFromUrlDialog"
          @install="handleInstallFromUrl"
          @cancel="toggleInstallFromUrlDialog(); installUrl = ''"
        />

        <PluginSubscriptionPanel
          v-model:editing-sub-name="editingSubName"
          v-model:new-subscription-url="newSubscriptionUrl"
          :visible="showSubscriptionPanel"
          :subscriptions="subscriptions"
          :show-add-subscription-input="showAddSubscriptionInput"
          :syncing-all="syncingAll"
          :is-plugin-busy="isPluginBusy"
          :editing-sub-id="editingSubId"
          @sync-all="handleSyncAllSubscriptions"
          @toggle-add="handleAddSubscription"
          @confirm-add="confirmAddSubscription"
          @install="handleInstallFromSubscription"
          @remove="handleRemoveSubscription"
          @edit-name="startEditSubName"
          @save-name="saveSubName"
          @cancel-name="cancelEditSubName"
        />
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        插件设置
      </h2>
      <div class="overflow-hidden rounded-xl border border-gray-200/40 bg-white/20 dark:border-gray-800/40 dark:bg-black/10">
        <div class="flex items-center justify-between p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="flex items-center gap-3 min-w-0">
            <RefreshCw class="h-4 w-4 text-gray-400 shrink-0" />
            <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">启动时自动更新插件</p>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint severity="warning" text="软件启动时自动检查并安装插件更新" />
            <button
              type="button"
              class="glass-switch"
              :class="{ 'is-checked': pluginSettings.autoUpdateOnStartup }"
              @click="togglePluginSetting('autoUpdateOnStartup')"
            ></button>
          </div>
        </div>
        <div class="flex items-center justify-between p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="flex items-center gap-3 min-w-0">
            <Puzzle class="h-4 w-4 text-gray-400 shrink-0" />
            <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">插件懒加载</p>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint text="首次使用时才初始化插件，加快启动速度" />
            <button
              type="button"
              class="glass-switch"
              :class="{ 'is-checked': pluginSettings.lazyLoad }"
              @click="togglePluginSetting('lazyLoad')"
            ></button>
          </div>
        </div>
        <div class="flex items-center justify-between p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
          <div class="flex items-center gap-3 min-w-0">
            <FileCode2 class="h-4 w-4 text-gray-400 shrink-0" />
            <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">安装时不校验版本</p>
          </div>
          <div class="flex items-center gap-3">
            <SettingHint severity="warning" text="允许安装相同或更低版本的插件" />
            <button
              type="button"
              class="glass-switch"
              :class="{ 'is-checked': pluginSettings.skipVersionCheck }"
              @click="togglePluginSetting('skipVersionCheck')"
            ></button>
          </div>
        </div>
      </div>
    </section>

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
            :disabled="plugins.length === 0 || isPluginBusy"
            :class="{ 'settings-plugin-button--disabled': plugins.length === 0 || isPluginBusy }"
            @click="handleToggleAllPlugins"
          >
            {{ allPluginsEnabled ? '全部禁用' : '全部启用' }}
          </button>
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

      <div class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-white/40" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索插件名称、平台或作者"
          class="h-8 w-full rounded-lg border border-black/10 bg-white/45 pl-8 pr-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
        />
      </div>

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

      <div
        v-else-if="filteredPlugins.length === 0"
        class="flex flex-col items-center justify-center py-8 text-center"
      >
        <div class="text-sm text-gray-500 dark:text-white/60">未找到匹配的插件</div>
      </div>

      <div
        v-else
        ref="listRef"
        class="flex flex-col rounded-xl overflow-hidden bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40"
      >
      <TransitionGroup name="plugin-sort" tag="div" class="flex flex-col">
        <PluginCard
          v-for="(plugin, index) in filteredPlugins"
          :key="plugin.id"
          :plugin="plugin"
          :index="index"
          :dragging="draggingIndex === index"
          :search-query="searchQuery"
          :is-baka="pluginsBakaIds.has(plugin.id)"
          :has-user-vars="pluginsWithUserVars.has(plugin.id)"
          :sub-brand-label="subBrandLabelById.get(plugin.id)"
          :update-check="updateCheckResults.get(plugin.id)"
          :updating="updatingPluginId === plugin.id"
          @drag-start="startDragging"
          @open-detail="openPluginDetail"
          @update="handleUpdatePlugin"
          @uninstall="handleUninstallPlugin"
          @toggle="handleTogglePlugin"
        />
      </TransitionGroup>
      </div>
    </section>

    <PluginConfirmDialog
      :visible="showUninstallAllConfirm"
      title="卸载全部插件"
      confirm-text="确认卸载"
      :overlay-z-class="overlayZClass"
      @cancel="showUninstallAllConfirm = false"
      @confirm="confirmUninstallAll"
    >
      确认要卸载全部 <strong class="text-[#EC4141]">{{ plugins.length }}</strong> 个插件吗？卸载后无法恢复，需重新安装。
    </PluginConfirmDialog>

    <PluginConfirmDialog
      :visible="showUninstallPluginConfirm"
      title="卸载插件"
      confirm-text="确认卸载"
      :overlay-z-class="overlayZClass"
      @cancel="showUninstallPluginConfirm = false"
      @confirm="confirmUninstallPlugin"
    >
      确认要卸载插件 <strong class="text-[#EC4141]">{{ pendingUninstallPlugin?.name }}</strong> 吗？卸载后无法恢复，需重新安装。
    </PluginConfirmDialog>

    <SyncDeleteScopeModal
      v-model:visible="showPluginDeleteScope"
      title="该插件已同步到云端"
      description="请选择删除范围"
      :can-delete-cloud="pluginScopeCanDeleteCloud"
      disabled-hint="该插件暂无云端副本，此选项不可用"
      @cancel="showPluginDeleteScope = false"
      @scope="confirmPluginDeleteScope"
    />

    <PluginConfirmDialog
      :visible="showRemoveSubscriptionConfirm"
      title="移除订阅"
      confirm-text="确认移除"
      :overlay-z-class="overlayZClass"
      @cancel="showRemoveSubscriptionConfirm = false"
      @confirm="confirmRemoveSubscription"
    >
      确认要移除订阅 <strong class="text-[#EC4141]">{{ pendingRemoveSubscription?.name }}</strong> 吗？移除后需重新添加。
    </PluginConfirmDialog>

    <PluginDetailDialog
      :plugin="detailPlugin"
      :overlay-z-class="overlayZClass"
      @close="detailPlugin = null"
    />
  </div>
</template>

<style scoped>
.settings-plugin-toolbar {
  flex-wrap: nowrap;
}
</style>

<style>
/* ==================== 子组件共用样式（PluginCard/安装面板/弹窗等，类名保持不变） ==================== */
.settings-plugin-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  color: rgba(55, 65, 81, 0.85);
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
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(255, 255, 255, 0.85);
  color: rgb(31 41 55);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
}

.settings-plugin-button--active {
  border-color: rgba(236, 65, 65, 0.5);
  background: rgba(236, 65, 65, 0.14); /* 样式 */
  color: #c42f2f;
}

.settings-plugin-button--active:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.6); /* 样式 */
  background: rgba(236, 65, 65, 0.18); /* 样式 */
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
  border-color: rgba(220, 38, 38, 0.5);
  background: #dc2626;
  color: #fff;
}

.settings-plugin-button--danger:hover:not(:disabled) {
  border-color: rgba(220, 38, 38, 0.7);
  background: #c42f2f;
  box-shadow: 0 10px 20px rgba(220, 38, 38, 0.2);
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

.settings-plugin-icon-button--updating {
  cursor: progress;
  opacity: 0.7;
  transform: none;
}

.settings-plugin-icon-button--updating:hover {
  background: transparent;
  transform: none;
}

.settings-plugin-icon-button--update-available {
  background: rgba(236, 65, 65, 0.12); /* 样式 */
  color: #ec4141; /* 样式 */
}

.settings-plugin-icon-button--update-available:hover {
  background: rgba(236, 65, 65, 0.2); /* 样式 */
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

.settings-plugin-input--inline { /* 样式 */
  width: 100%; /* 样式 */
  min-height: 28px; /* 样式 */
  padding: 2px 10px; /* 样式 */
  border-radius: 8px; /* 样式 */
  font-size: 13px; /* 样式 */
} /* 样式 */
.settings-plugin-inline-panel {
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  padding-top: 14px;
}

.settings-plugin-tag {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  white-space: nowrap;
  word-break: keep-all;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: rgba(55, 65, 81, 0.9);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.4;
}

/* 类型标签按格式配色（对齐移动端）；定义在基础样式之后以同优先级覆盖灰色底 */
.settings-plugin-tag--lx {
  background: rgba(34, 197, 94, 0.1);
  color: #15803d;
}

.settings-plugin-tag--anime {
  background: rgba(168, 85, 247, 0.1);
  color: #7e22ce;
}

.settings-plugin-tag--baka {
  background: rgba(59, 130, 246, 0.1);
  color: #1d4ed8;
}

.settings-plugin-tag--musicfree {
  background: rgba(249, 115, 22, 0.1); /* 样式 */
  color: #c2410c;
}

.settings-plugin-tag--accent {
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
}

.settings-plugin-tag--vars {
  display: inline-flex; /* 样式 */
  align-items: center; /* 样式 */
  flex-shrink: 0;
  white-space: nowrap;
  word-break: keep-all;
  gap: 3px;
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}

.settings-plugin-tag--brand {
  background: rgba(230, 162, 60, 0.15);
  color: #e6a23c;
  box-shadow: inset 0 0 0 1px rgba(230, 162, 60, 0.4);
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

.settings-plugin-import-btn { /* 样式 */
  display: inline-flex; /* 样式 */
  align-items: center; /* 样式 */
  gap: 4px; /* 样式 */
  height: 30px; /* 样式 */
  padding: 0 12px; /* 样式 */
  border: 1px solid rgba(249, 115, 22, 0.24); /* 样式 */
  border-radius: 999px; /* 样式 */
  background: rgba(249, 115, 22, 0.06); /* 样式 */
  color: rgb(249, 115, 22); /* 样式 */
  font-size: 11px; /* 样式 */
  font-weight: 600; /* 样式 */
  transition: /* 样式 */
    border-color 160ms ease, /* 样式 */
    background-color 160ms ease, /* 样式 */
    color 160ms ease, /* 样式 */
    transform 160ms ease; /* 样式 */
  cursor: pointer; /* 样式 */
  white-space: nowrap; /* 样式 */
} /* 样式 */
.settings-plugin-import-btn:hover { /* 样式 */
  transform: translateY(-1px); /* 样式 */
  border-color: rgba(249, 115, 22, 0.4); /* 样式 */
  background: rgba(249, 115, 22, 0.12); /* 样式 */
} /* 样式 */
@media (max-width: 640px) { /* 样式 */
  .settings-plugin-import-btn__text { /* 样式 */
    display: none; /* 样式 */
  } /* 样式 */
  .settings-plugin-import-btn { /* 样式 */
    padding: 0 8px; /* 样式 */
  } /* 样式 */
} /* 样式 */
.plugin-detail-card { /* 样式 */
  width: min(92vw, 460px); /* 样式 */
  background: #ffffff; /* 样式 */
  color: #1f2937; /* 样式 */
  border-radius: 16px; /* 样式 */
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08); /* 样式 */
  overflow: hidden; /* 样式 */
  border: 1px solid rgba(0, 0, 0, 0.06); /* 样式 */
}

.plugin-detail-header { /* 样式 */
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
  justify-content: space-between; /* 样式 */
  gap: 12px;
  padding: 16px 18px; /* 样式 */
  border-bottom: 1px solid rgba(0, 0, 0, 0.06); /* 样式 */
}

.plugin-detail-close { /* 样式 */
  display: inline-flex; /* 样式 */
  align-items: center; /* 样式 */
  justify-content: center; /* 样式 */
  width: 32px; /* 样式 */
  height: 32px; /* 样式 */
  border-radius: 999px; /* 样式 */
  color: rgba(75, 85, 99, 0.8); /* 样式 */
  transition: background-color 160ms ease, color 160ms ease; /* 样式 */
  cursor: pointer; /* 样式 */
  flex-shrink: 0; /* 样式 */
}

.plugin-detail-close:hover { /* 样式 */
  background: rgba(15, 23, 42, 0.06); /* 样式 */
  color: rgb(17 24 39); /* 样式 */
}

.plugin-detail-body { /* 样式 */
  padding: 14px 18px 18px; /* 样式 */
  display: flex; /* 样式 */
  flex-direction: column; /* 样式 */
  gap: 14px;
}

.plugin-detail-row { /* 样式 */
  display: flex; /* 样式 */
  align-items: flex-start; /* 样式 */
  gap: 14px;
}

.plugin-detail-label { /* 样式 */
  flex-shrink: 0; /* 样式 */
  width: 64px; /* 样式 */
  font-size: 12px; /* 样式 */
  font-weight: 600; /* 样式 */
  color: rgba(100, 116, 139, 0.9); /* 样式 */
  padding-top: 2px; /* 样式 */
}

.plugin-detail-value { /* 样式 */
  min-width: 0; /* 样式 */
  flex: 1;
  font-size: 13px; /* 样式 */
  color: #1f2937; /* 样式 */
  line-height: 1.55; /* 样式 */
  word-break: break-word; /* 样式 */
}

.plugin-detail-link { /* 样式 */
  display: inline-flex; /* 样式 */
  align-items: center; /* 样式 */
  gap: 6px;
  min-width: 0; /* 样式 */
  flex: 1;
  padding: 6px 10px; /* 样式 */
  border-radius: 8px; /* 样式 */
  background: rgba(236, 65, 65, 0.06); /* 样式 */
  color: #ec4141; /* 样式 */
  font-size: 12px; /* 样式 */
  font-weight: 500; /* 样式 */
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; /* 样式 */
  transition: background-color 160ms ease; /* 样式 */
  cursor: pointer; /* 样式 */
  border: none; /* 样式 */
}

.plugin-detail-link:hover { /* 样式 */
  background: rgba(236, 65, 65, 0.12); /* 样式 */
}

.plugin-detail-enter-active, /* 样式 */
.plugin-detail-leave-active { /* 样式 */
  transition: opacity 0.2s ease; /* 样式 */
}

.plugin-detail-enter-active .plugin-detail-card, /* 样式 */
.plugin-detail-leave-active .plugin-detail-card { /* 样式 */
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); /* 样式 */
}

.plugin-detail-enter-from, /* 样式 */
.plugin-detail-leave-to { /* 样式 */
  opacity: 0;
}

.plugin-detail-enter-from .plugin-detail-card, /* 样式 */
.plugin-detail-leave-to .plugin-detail-card { /* 样式 */
  opacity: 0;
  transform: scale(0.92) translateY(8px); /* 样式 */
}

/* ==================== 暗色模式适配 ==================== */
.dark .plugin-drag-handle { /* 样式 */
  color: rgba(255, 255, 255, 0.5); /* 样式 */
}

.dark .plugin-drag-handle:hover { /* 样式 */
  color: rgba(255, 255, 255, 0.8); /* 样式 */
  background: rgba(255, 255, 255, 0.1); /* 样式 */
}

.dark .settings-plugin-card--dragging { /* 样式 */
  background: rgba(236, 65, 65, 0.1); /* 样式 */
}

.dark .settings-plugin-button {
  border-color: rgba(255, 255, 255, 0.1); /* 样式 */
  background: rgba(255, 255, 255, 0.05); /* 样式 */
  color: rgba(255, 255, 255, 0.85); /* 样式 */
}

.dark .settings-plugin-button:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.18); /* 样式 */
  background: rgba(255, 255, 255, 0.09); /* 样式 */
  color: rgba(255, 255, 255, 0.96); /* 样式 */
}

.dark .settings-plugin-button--secondary { /* 样式 */
  border-color: rgba(255, 255, 255, 0.1); /* 样式 */
  background: rgba(255, 255, 255, 0.05); /* 样式 */
  color: rgba(255, 255, 255, 0.85); /* 样式 */
}

.dark .settings-plugin-button--secondary:hover:not(:disabled) { /* 样式 */
  border-color: rgba(255, 255, 255, 0.18); /* 样式 */
  background: rgba(255, 255, 255, 0.09); /* 样式 */
  color: rgba(255, 255, 255, 0.96); /* 样式 */
}

.dark .settings-plugin-button--active { /* 样式 */
  border-color: rgba(236, 65, 65, 0.55); /* 样式 */
  background: rgba(236, 65, 65, 0.2); /* 样式 */
  color: #ff8b8b; /* 样式 */
}

.dark .settings-plugin-button--active:hover:not(:disabled) { /* 样式 */
  border-color: rgba(236, 65, 65, 0.65); /* 样式 */
  background: rgba(236, 65, 65, 0.24); /* 样式 */
}

.dark .settings-plugin-button--ghost { /* 样式 */
  border-color: rgba(255, 255, 255, 0.1); /* 样式 */
  color: rgba(255, 255, 255, 0.65); /* 样式 */
}

.dark .settings-plugin-button--ghost:hover:not(:disabled) { /* 样式 */
  background: rgba(255, 255, 255, 0.06); /* 样式 */
  color: rgba(255, 255, 255, 0.9); /* 样式 */
}

.dark .settings-plugin-button--disabled, /* 样式 */
.dark .settings-plugin-button:disabled { /* 样式 */
  border-color: rgba(255, 255, 255, 0.08); /* 样式 */
  background: rgba(255, 255, 255, 0.04); /* 样式 */
  color: rgba(255, 255, 255, 0.35); /* 样式 */
}

.dark .settings-plugin-button--danger {
  border-color: rgba(220, 38, 38, 0.5);
  background: #dc2626;
  color: #fff;
}

.dark .settings-plugin-button--danger:hover:not(:disabled) {
  border-color: rgba(220, 38, 38, 0.7);
  background: #c42f2f;
}

.dark .settings-plugin-input { /* 样式 */
  border-color: rgba(255, 255, 255, 0.1); /* 样式 */
  background: rgba(255, 255, 255, 0.05); /* 样式 */
  color: rgba(255, 255, 255, 0.92); /* 样式 */
}

.dark .settings-plugin-input:focus { /* 样式 */
  border-color: rgba(236, 65, 65, 0.4); /* 样式 */
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.14); /* 样式 */
}

.dark .settings-plugin-inline-panel { /* 样式 */
  border-top-color: rgba(255, 255, 255, 0.08); /* 样式 */
}

.dark .settings-plugin-dropzone { /* 样式 */
  border-color: rgba(255, 255, 255, 0.15); /* 样式 */
  background: rgba(255, 255, 255, 0.03); /* 样式 */
}

.dark .settings-plugin-dropzone:hover { /* 样式 */
  border-color: rgba(236, 65, 65, 0.45); /* 样式 */
  background: rgba(236, 65, 65, 0.06); /* 样式 */
}

.dark .settings-plugin-dropzone--active { /* 样式 */
  border-color: rgba(236, 65, 65, 0.6); /* 样式 */
  background: rgba(236, 65, 65, 0.1); /* 样式 */
}

.dark .settings-plugin-dropzone-icon { /* 样式 */
  background: rgba(236, 65, 65, 0.14); /* 样式 */
  color: #ff6b6b; /* 样式 */
}

.dark .settings-plugin-dropzone--active .settings-plugin-dropzone-icon { /* 样式 */
  background: rgba(236, 65, 65, 0.22); /* 样式 */
}

.dark .settings-plugin-dropzone-title { /* 样式 */
  color: rgba(255, 255, 255, 0.9); /* 样式 */
}

.dark .settings-plugin-dropzone-hint { /* 样式 */
  color: rgba(255, 255, 255, 0.45); /* 样式 */
}

.dark .settings-plugin-empty { /* 样式 */
  color: rgba(255, 255, 255, 0.4); /* 样式 */
}

.dark .settings-plugin-card { /* 样式 */
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

.dark .settings-plugin-card:hover { /* 样式 */
  background: rgba(255, 255, 255, 0.05); /* 样式 */
}

.dark .settings-plugin-tag { /* 样式 */
  background: rgba(255, 255, 255, 0.08); /* 样式 */
  color: rgba(255, 255, 255, 0.8); /* 样式 */
}

.dark .settings-plugin-tag--lx {
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
}

.dark .settings-plugin-tag--anime {
  background: rgba(168, 85, 247, 0.15);
  color: #d8b4fe;
}

.dark .settings-plugin-tag--baka {
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
}

.dark .settings-plugin-tag--musicfree {
  background: rgba(249, 115, 22, 0.15);
  color: #fdba74;
}

.dark .settings-plugin-tag--accent { /* 样式 */
  background: rgba(236, 65, 65, 0.18); /* 样式 */
  color: #ff8b8b; /* 样式 */
}

.dark .settings-plugin-tag--vars {
  background: rgba(96, 165, 250, 0.18);
  color: #93c5fd;
}

.dark .settings-plugin-tag--brand {
  background: rgba(230, 162, 60, 0.18);
  color: #f0b25a;
}

.dark .settings-plugin-icon-button { /* 样式 */
  color: rgba(255, 255, 255, 0.85); /* 样式 */
}

.dark .settings-plugin-icon-button:hover { /* 样式 */
  background: rgba(255, 255, 255, 0.12); /* 样式 */
  color: rgba(255, 255, 255, 1); /* 样式 */
}

.dark .settings-plugin-icon-button--danger:hover { /* 样式 */
  background: rgba(220, 38, 38, 0.18); /* 样式 */
  color: #ff6b6b; /* 样式 */
}

.dark .settings-plugin-icon-button--update-available { /* 样式 */
  background: rgba(236, 65, 65, 0.2); /* 样式 */
  color: #ff8b8b; /* 样式 */
}

.dark .settings-plugin-icon-button--update-available:hover { /* 样式 */
  background: rgba(236, 65, 65, 0.28); /* 样式 */
  color: #ffa6a6; /* 样式 */
}

.dark .settings-plugin-import-btn { /* 样式 */
  border-color: rgba(249, 115, 22, 0.2); /* 样式 */
  background: rgba(249, 115, 22, 0.1); /* 样式 */
  color: rgb(251, 146, 60); /* 样式 */
}

.dark .settings-plugin-import-btn:hover { /* 样式 */
  border-color: rgba(249, 115, 22, 0.36); /* 样式 */
  background: rgba(249, 115, 22, 0.16); /* 样式 */
}

.dark .plugin-detail-card { /* 样式 */
  background: #262626;
  color: rgba(255, 255, 255, 0.92); /* 样式 */
  border-color: rgba(255, 255, 255, 0.08); /* 样式 */
}

.dark .plugin-detail-header { /* 样式 */
  border-bottom-color: rgba(255, 255, 255, 0.08); /* 样式 */
}

.dark .plugin-detail-close { /* 样式 */
  color: rgba(255, 255, 255, 0.7); /* 样式 */
}

.dark .plugin-detail-close:hover { /* 样式 */
  background: rgba(255, 255, 255, 0.08); /* 样式 */
  color: rgba(255, 255, 255, 0.96); /* 样式 */
}

.dark .plugin-detail-label { /* 样式 */
  color: rgba(255, 255, 255, 0.5); /* 样式 */
}

.dark .plugin-detail-value { /* 样式 */
  color: rgba(255, 255, 255, 0.88); /* 样式 */
}

.dark .plugin-detail-link { /* 样式 */
  background: rgba(236, 65, 65, 0.14); /* 样式 */
  color: #ff8b8b; /* 样式 */
}

.dark .plugin-detail-link:hover { /* 样式 */
  background: rgba(236, 65, 65, 0.22); /* 样式 */
}

.dark .plugin-detail-user-vars {
  border-top-color: rgba(255, 255, 255, 0.06);
}

.dark .plugin-detail-var-label {
  color: rgba(255, 255, 255, 0.8); /* 样式 */
}

.dark .plugin-detail-var-desc {
  color: rgba(255, 255, 255, 0.4); /* 样式 */
}

.dark .plugin-detail-var-input,
.dark .plugin-detail-var-select {
  border-color: rgba(255, 255, 255, 0.1); /* 样式 */
  background: rgba(255, 255, 255, 0.05); /* 样式 */
  color: rgba(255, 255, 255, 0.9); /* 样式 */
}

.dark .plugin-detail-var-input:focus,
.dark .plugin-detail-var-select:focus {
  border-color: rgba(236, 65, 65, 0.5);
  background: rgba(236, 65, 65, 0.08);
}

.dark .plugin-detail-var-cancel {
  border-color: rgba(255, 255, 255, 0.1); /* 样式 */
  background: rgba(255, 255, 255, 0.06); /* 样式 */
  color: rgba(255, 255, 255, 0.72);
}

.dark .plugin-detail-var-cancel:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1); /* 样式 */
}
</style>
