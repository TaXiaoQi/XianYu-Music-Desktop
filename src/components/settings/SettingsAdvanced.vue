<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { FileDown, FileUp, Loader2, Trash2, UploadCloud, X } from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import { useCollectionsStore } from '../../features/collections/store';
import { useDlnaCastStore } from '../../features/playback/castStore';
import { useLibraryStore } from '../../features/library/store';
import { useSettings } from '../../features/settings/useSettings';
import { useApplicationLogs } from '../../services/applicationLogger';
import { getStoredPlugins } from '../../services/domain/pluginEngine';
import {
  describeBackupVersion,
  preparePluginBackupImport,
  type PreparedPluginBackupImport,
} from '../../services/domain/pluginBackupImport';
import {
  exportAppBackup,
  parseAppBackup,
  importAppBackup,
  type AppBackupImportResult,
} from '../../services/domain/appBackup';
import { readPluginFile, readFileBytes } from '../../services/tauri/pluginApi';
import { extractJsonFromZip } from '../../services/zipReader';
import { gunzipSync } from '../../services/pureInflate';
import { debugApi } from '../../services/tauri/debugApi';
import { modalDragInterceptActive } from '../../composables/dragState';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import BackupImportResultModal from './BackupImportResultModal.vue';
import AppBackupResultModal from './AppBackupResultModal.vue';
import LogExportActions from './LogExportActions.vue';
import ExportBackupDialog, {
  type ExportSelection,
} from './ExportBackupDialog.vue';

const { showToast } = useToast();
const { settings, patchSettings, replaceSettings } = useSettings();
const { entries, clearLogs } = useApplicationLogs();
const collectionsStore = useCollectionsStore();
const libraryStore = useLibraryStore();
const showDeleteConfirmation = ref(false);

// ─── DLNA 渲染器（接收端） ───
const dlnaCast = useDlnaCastStore();
// 开关变化 → 按设置幂等启停渲染器（名称变更时同样幂等重建）
watch(
  () => settings.value.dlnaRendererEnabled,
  () => { void dlnaCast.applyRendererSetting(); },
);
const onRendererNameChanged = () => {
  if (dlnaCast.rendererRunning) void dlnaCast.applyRendererSetting();
};

// 使用本地 ref 存储 entryCount，避免模板直接依赖 entries 响应式源
const entryCount = ref(entries.value.length);
watch(
  () => entries.value.length,
  () => { entryCount.value = entries.value.length; },
  { flush: 'post' },
);
const importingBackup = ref(false);
const backupImportResult = ref<PreparedPluginBackupImport | null>(null);
const createdPlaylistCount = ref(0);
const showBackupImportResult = ref(false);

// 应用备份导出/导入状态
const exportingAppBackup = ref(false);
const importingAppBackup = ref(false);
const appBackupResult = ref<AppBackupImportResult | null>(null);
const showAppBackupResult = ref(false);

// 备份导入弹窗（支持拖放 .json / .zip）
const showImportModal = ref(false);
const importMode = ref<'app' | 'plugin'>('app');
const isDragOver = ref(false);
const importModalBusy = ref(false);
let unlistenDragDrop: UnlistenFn | null = null;
let unlistenDragOver: UnlistenFn | null = null;
let unlistenDragLeave: UnlistenFn | null = null;

const confirmDeleteLogs = () => {
  clearLogs();
  showDeleteConfirmation.value = false;
  showToast('日志已全部删除', 'success');
};

// ==================== 应用备份导出 ====================

const showExportDialog = ref(false);

const handleExportAppBackup = async (selection: ExportSelection) => {
  if (exportingAppBackup.value) return;
  showExportDialog.value = false;

  try {
    const filePath = await saveDialog({
      defaultPath: `xianyu-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: '应用备份文件', extensions: ['json'] }],
    });
    if (!filePath) return;

    exportingAppBackup.value = true;

    const { json, summary } = await exportAppBackup(collectionsStore.playlists, {
      includePlaylists: selection.playlists,
      includePlugins: selection.plugins,
      includeSettings: selection.settings,
      includeFavorites: selection.favorites,
      favorites: {
        paths: collectionsStore.favoritePaths,
        songMeta: collectionsStore.favoriteSongMeta,
      },
      resolveSongsByPaths: libraryStore.resolveSongsByPaths,
    });

    await debugApi.writeLogExport(filePath, json);

    const parts: string[] = [];
    if (summary.playlistCount > 0) parts.push(`${summary.playlistCount} 个歌单`);
    if (summary.favoriteCount > 0) parts.push(`收藏 ${summary.favoriteCount} 首`);
    if (summary.pluginCount > 0) parts.push(`${summary.pluginCount} 个插件`);
    if (parts.length === 0) parts.push('无数据');
    if (summary.hasSettings) parts.push('设置');
    showToast(
      `已导出${parts.join('、')}`,
      'success',
    );
  } catch (error: any) {
    showToast(`导出备份失败：${error?.message || error}`, 'error');
  } finally {
    exportingAppBackup.value = false;
  }
};

// ==================== 应用备份导入 ====================

const handleImportAppBackup = () => {
  openImportModal('app');
};

// ==================== 备份导入弹窗（拖放 + ZIP 支持）====================

function openImportModal(mode: 'app' | 'plugin') {
  importMode.value = mode;
  showImportModal.value = true;
  isDragOver.value = false;
  importModalBusy.value = false;
  // 拦截全局拖放，避免 useExternalPathBridge 把备份文件当音乐文件处理
  modalDragInterceptActive.value = true;
}

function closeImportModal() {
  if (importModalBusy.value) return;
  showImportModal.value = false;
  isDragOver.value = false;
  modalDragInterceptActive.value = false;
}

async function handleImportFilePick() {
  if (importModalBusy.value) return;
  try {
    const selected = await open({
      multiple: false,
      title: importMode.value === 'app' ? '选择应用备份文件' : '选择备份文件',
      filters: [{ name: '备份文件', extensions: ['json', 'zip', 'lxmc'] }],
    });
    if (typeof selected !== 'string') return;
    await processImportFile(selected);
  } catch (error: any) {
    showToast(`导入失败：${error?.message || error}`, 'error');
  }
}

async function processImportFile(filePath: string) {
  if (importModalBusy.value) return;
  importModalBusy.value = true;

  if (importMode.value === 'app') {
    importingAppBackup.value = true;
  } else {
    importingBackup.value = true;
  }

  try {
    const ext = filePath.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
    let jsonContent: string;

    if (ext === 'zip') {
      const bytes = await readFileBytes(filePath);
      jsonContent = extractJsonFromZip(bytes);
    } else if (ext === 'lxmc') {
      const bytes = await readFileBytes(filePath);
      jsonContent = new TextDecoder().decode(gunzipSync(bytes));
    } else {
      jsonContent = await readPluginFile(filePath);
    }

    if (importMode.value === 'app') {
      const backup = parseAppBackup(jsonContent);
      const result = await importAppBackup(backup, collectionsStore, libraryStore, {
        patchSettings,
        replaceSettings,
      }, {
        includePlaylists: true,
        includeFavorites: true,
        includePlugins: true,
        includeSettings: true,
      });

      appBackupResult.value = result;
      showAppBackupResult.value = true;

      const parts: string[] = [];
      if (result.importedPlaylists > 0) parts.push(`${result.importedPlaylists} 个歌单`);
      if (result.importedFavorites > 0) parts.push(`收藏 ${result.importedFavorites} 首`);
      if (result.importedPlugins > 0) parts.push(`${result.importedPlugins} 个插件`);
      if (result.settingsApplied) parts.push('设置');
      if (parts.length > 0) {
        showToast(`已导入 ${parts.join('、')}`, 'success');
      } else {
        showToast('备份中无新数据可导入', 'info');
      }
    } else {
      const prepared = await preparePluginBackupImport(jsonContent, getStoredPlugins());
      let created = 0;

      for (const playlist of prepared.playlists) {
        if (playlist.songs.length === 0) continue;
        const paths = playlist.songs.map(song => song.path);
        libraryStore.setExtraSongs(playlist.songs);
        const playlistId = collectionsStore.createPlaylist(playlist.name, paths, playlist.songs);
        if (playlistId) created += 1;
      }

      backupImportResult.value = prepared;
      createdPlaylistCount.value = created;
      showBackupImportResult.value = true;

      const versionNote = describeBackupVersion(prepared);
      if (prepared.importedSongCount > 0) {
        showToast(
          `${versionNote}｜已导入 ${prepared.importedSongCount} 首歌曲，${prepared.failures.length} 首未导入`,
          'success',
        );
      } else {
        showToast(`${versionNote}｜没有歌曲可以导入，请查看缺失插件说明`, 'info');
      }
    }

    showImportModal.value = false;
    modalDragInterceptActive.value = false;
  } catch (error: any) {
    showToast(`导入备份失败：${error?.message || error}`, 'error');
  } finally {
    importModalBusy.value = false;
    importingAppBackup.value = false;
    importingBackup.value = false;
  }
}

onMounted(async () => {
  unlistenDragOver = await listen('tauri://drag-over', () => {
    if (showImportModal.value) isDragOver.value = true;
  });
  unlistenDragLeave = await listen('tauri://drag-leave', () => {
    isDragOver.value = false;
  });
  unlistenDragDrop = await listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
    isDragOver.value = false;
    if (!showImportModal.value || importModalBusy.value) return;

    const paths = event.payload?.paths ?? [];
    const supported = paths.find((p) => {
      const ext = p.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
      return ext === 'json' || ext === 'zip' || ext === 'lxmc';
    });
    if (supported) {
      await processImportFile(supported);
    } else if (paths.length > 0) {
      showToast('请拖入 .json / .zip / .lxmc 格式的备份文件', 'error');
    }
  });
});

onUnmounted(() => {
  unlistenDragDrop?.();
  unlistenDragOver?.();
  unlistenDragLeave?.();
  modalDragInterceptActive.value = false;
});
</script>

<template>
  <div class="space-y-8">
    <section class="space-y-3">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          应用备份
        </h2>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
          将歌单（自动区分本地/在线/混合）、收藏歌曲、插件和本地设置导出为单个 JSON 文件，可快速导入恢复。
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          :disabled="exportingAppBackup"
          class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/30 disabled:cursor-wait disabled:opacity-55 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/8"
          @click="showExportDialog = true"
        >
          <Loader2 v-if="exportingAppBackup" class="h-4 w-4 animate-spin" />
          <FileUp v-else class="h-4 w-4 text-[#EC4141]" />
          {{ exportingAppBackup ? '正在导出…' : '导出备份' }}
        </button>
        <button
          type="button"
          :disabled="importingAppBackup"
          class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/30 disabled:cursor-wait disabled:opacity-55 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/8"
          @click="handleImportAppBackup"
        >
          <Loader2 v-if="importingAppBackup" class="h-4 w-4 animate-spin" />
          <FileDown v-else class="h-4 w-4 text-[#EC4141]" />
          {{ importingAppBackup ? '正在导入…' : '导入备份' }}
        </button>
      </div>
      <p class="text-[11px] leading-5 text-gray-400 dark:text-white/35">
        导入时会自动恢复歌单、收藏、插件（跳过已存在的）和应用设置；支持拖入 .json 或 .zip 压缩包。
      </p>
    </section>

    <!-- DLNA 渲染器（接收端） -->
    <section class="space-y-3">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          DLNA 渲染器
        </h2>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
          开启后本机将作为 DLNA 设备出现在局域网中，其它 App（如 QQ 音乐、网易云音乐）可直接投歌到弦予播放。
        </p>
      </div>
      <section class="rounded-xl border border-gray-200/40 bg-white/20 p-5 dark:border-gray-800/40 dark:bg-black/10">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">接收其它设备投屏</div>
            <div class="mt-0.5 text-[11px] text-gray-400 dark:text-white/35">
              {{ dlnaCast.rendererRunning
                ? `运行中 · 端口 ${dlnaCast.rendererPort}`
                : '未运行（需与投送端在同一局域网）' }}
            </div>
          </div>
          <button
            type="button"
            class="glass-switch"
            :class="{ 'is-checked': settings.dlnaRendererEnabled }"
            @click="settings.dlnaRendererEnabled = !settings.dlnaRendererEnabled"
          ></button>
        </div>
        <label class="mt-4 block">
          <span class="text-xs text-gray-500 dark:text-white/45">设备名称（投送端看到的名字）</span>
          <input
            v-model="settings.dlnaRendererName"
            type="text"
            maxlength="40"
            placeholder="弦予音乐"
            class="mt-2 w-full rounded-lg border border-black/10 bg-white/45 px-3 py-2 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/30 dark:focus:bg-white/10"
            @change="onRendererNameChanged"
          />
        </label>
        <p class="mt-3 text-[11px] leading-5 text-gray-400 dark:text-white/35">
          首次开启时 Windows 可能弹出防火墙授权，请允许「专用网络」访问，否则设备将无法被发现。
        </p>
      </section>
    </section>

    <section class="space-y-3">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          导出日志
        </h2>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">导出本机保留的应用日志，便于反馈问题或自行排查。</p>
      </div>
      <LogExportActions />
    </section>

    <section class="space-y-3">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          日志管理
        </h2>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">删除后无法恢复，建议先导出需要保留的日志。</p>
      </div>
      <button
        type="button"
        :disabled="entryCount === 0"
        class="inline-flex items-center gap-2 rounded-xl border border-[#EC4141]/50 bg-[#EC4141] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#d13b3b] disabled:cursor-not-allowed disabled:opacity-40"
        @click="showDeleteConfirmation = true"
      >
        <Trash2 class="h-4 w-4" />
        删除全部日志
      </button>
    </section>

    <ConfirmModal
      :visible="showDeleteConfirmation"
      title="确认删除全部日志"
      content="此操作会永久删除当前设备上保存的全部应用日志，且无法恢复。确定继续吗？"
      @confirm="confirmDeleteLogs"
      @cancel="showDeleteConfirmation = false"
    />

    <BackupImportResultModal
      :visible="showBackupImportResult"
      :result="backupImportResult"
      :created-playlist-count="createdPlaylistCount"
      @close="showBackupImportResult = false"
    />

    <AppBackupResultModal
      :visible="showAppBackupResult"
      :result="appBackupResult"
      @close="showAppBackupResult = false"
    />

    <ExportBackupDialog
      :visible="showExportDialog"
      @close="showExportDialog = false"
      @confirm="handleExportAppBackup"
    />

    <!-- 备份导入弹窗（拖放 .json / .zip） -->
    <Teleport to="body">
      <transition name="modal-fade">
        <div v-if="showImportModal" class="import-modal-overlay" @click.self="closeImportModal">
          <div class="import-modal">
            <div class="import-modal-head">
              <h3>{{ importMode === 'app' ? '导入应用备份' : '导入歌单备份' }}</h3>
              <button type="button" class="import-modal-close" @click="closeImportModal">
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="import-modal-body">
              <button
                type="button"
                :disabled="importModalBusy"
                class="import-dropzone"
                :class="{ 'import-dropzone--active': isDragOver }"
                @click="handleImportFilePick"
              >
                <Loader2 v-if="importModalBusy" class="h-8 w-8 animate-spin text-[#EC4141]" />
                <UploadCloud v-else class="h-8 w-8 text-[#EC4141]" />
                <p v-if="importModalBusy" class="import-dropzone-text">正在导入…</p>
                <p v-else class="import-dropzone-text">拖入文件或点击选择</p>
                <p class="import-dropzone-hint">支持 .json / .zip 压缩包 / .lxmc（洛雪音乐备份）</p>
              </button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* 弹窗淡入淡出 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

/* ─── 备份导入弹窗 ─── */
.import-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  padding: 24px;
}
.import-modal {
  width: 380px;
  max-width: 92vw;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
:global(.dark) .import-modal,
.dark .import-modal {
  background: #262626;
}
.import-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
}
.import-modal-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
}
:global(.dark) .import-modal-head h3,
.dark .import-modal-head h3 {
  color: rgba(255, 255, 255, 0.9);
}
.import-modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: rgba(0, 0, 0, 0.5);
  cursor: pointer;
  transition: all 0.2s ease;
}
:global(.dark) .import-modal-close,
.dark .import-modal-close {
  color: rgba(255, 255, 255, 0.55);
}
.import-modal-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.85);
}
:global(.dark) .import-modal-close:hover,
.dark .import-modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}
.import-modal-body {
  padding: 4px 18px 20px;
}
.import-dropzone {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 20px;
  border-radius: 12px;
  border: 2px dashed rgba(0, 0, 0, 0.15);
  background: rgba(0, 0, 0, 0.02);
  cursor: pointer;
  transition: all 0.2s ease;
}
:global(.dark) .import-dropzone,
.dark .import-dropzone {
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.03);
}
.import-dropzone:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.4);
  background: rgba(236, 65, 65, 0.04);
}
.import-dropzone--active {
  border-color: rgba(236, 65, 65, 0.6);
  background: rgba(236, 65, 65, 0.08);
  transform: scale(1.01);
}
.import-dropzone:disabled {
  cursor: wait;
  opacity: 0.7;
}
.import-dropzone-text {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.7);
}
:global(.dark) .import-dropzone-text,
.dark .import-dropzone-text {
  color: rgba(255, 255, 255, 0.7);
}
.import-dropzone-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.4);
}
:global(.dark) .import-dropzone-hint,
.dark .import-dropzone-hint {
  color: rgba(255, 255, 255, 0.4);
}
</style>
