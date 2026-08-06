<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { FileDown, FileUp, Loader2, Trash2 } from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import { useCollectionsStore } from '../../features/collections/store';
import { useLibraryStore } from '../../features/library/store';
import { useSettings } from '../../features/settings/useSettings';
import { useApplicationLogs } from '../../services/applicationLogger';
import { getStoredAuth } from '../../services/auth/authService';
import { getStoredPlugins } from '../../services/pluginEngine';
import { submitFeedback } from '../../services/usageStats';
import {
  preparePluginBackupFile,
  type PreparedPluginBackupImport,
} from '../../services/pluginBackupImport';
import {
  exportAppBackup,
  parseAppBackup,
  importAppBackup,
  type AppBackupImportResult,
} from '../../services/appBackup';
import { readPluginFile } from '../../services/tauri/pluginApi';
import { debugApi } from '../../services/tauri/debugApi';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import BackupImportResultModal from './BackupImportResultModal.vue';
import AppBackupResultModal from './AppBackupResultModal.vue';
import LogExportActions from './LogExportActions.vue';

const { showToast } = useToast();
const { patchSettings, replaceSettings } = useSettings();
const { entries, clearLogs } = useApplicationLogs();
const collectionsStore = useCollectionsStore();
const libraryStore = useLibraryStore();
const showDeleteConfirmation = ref(false);

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

// ─── 问题反馈 ───
const feedbackTitle = ref('');
const feedbackContent = ref('');
const submittingFeedback = ref(false);
const feedbackAuth = ref(getStoredAuth());

// 登录态可能在设置页面打开后变化（如用户在其他窗口登录），聚焦时刷新一次
const refreshFeedbackAuth = () => {
  feedbackAuth.value = getStoredAuth();
};
const isFeedbackLoggedIn = computed(() => !!feedbackAuth.value?.user?.ciyuanxi_id);

// 应用备份导出/导入状态
const exportingAppBackup = ref(false);
const importingAppBackup = ref(false);
const appBackupResult = ref<AppBackupImportResult | null>(null);
const showAppBackupResult = ref(false);

const confirmDeleteLogs = () => {
  clearLogs();
  showDeleteConfirmation.value = false;
  showToast('日志已全部删除', 'success');
};

const importPluginBackup = async () => {
  if (importingBackup.value) return;

  try {
    const selected = await open({
      multiple: false,
      title: '选择备份文件',
      filters: [{ name: '音乐软件备份', extensions: ['json'] }],
    });
    if (typeof selected !== 'string') return;

    importingBackup.value = true;
    const prepared = await preparePluginBackupFile(selected, getStoredPlugins());
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

    if (prepared.importedSongCount > 0) {
      showToast(`已导入 ${prepared.importedSongCount} 首歌曲，${prepared.failures.length} 首未导入`, 'success');
    } else {
      showToast('没有歌曲可以导入，请查看缺失插件说明', 'info');
    }
  } catch (error: any) {
    showToast(`导入备份失败：${error?.message || error}`, 'error');
  } finally {
    importingBackup.value = false;
  }
};

const submitUserFeedback = async () => {
  if (submittingFeedback.value) return;

  const title = feedbackTitle.value.trim();
  const content = feedbackContent.value.trim();

  if (!title) {
    showToast('请填写反馈标题', 'error');
    return;
  }
  if (title.length > 60) {
    showToast('标题不能超过 60 字', 'error');
    return;
  }
  if (!content) {
    showToast('请填写反馈内容', 'error');
    return;
  }
  if (content.length > 1000) {
    showToast('内容不能超过 1000 字', 'error');
    return;
  }

  submittingFeedback.value = true;
  try {
    await submitFeedback(title, content);
    showToast('反馈已提交，感谢您的支持', 'success');
    feedbackTitle.value = '';
    feedbackContent.value = '';
  } catch (error: any) {
    showToast(`提交失败：${error?.message || error}`, 'error');
  } finally {
    submittingFeedback.value = false;
  }
};

// ==================== 应用备份导出 ====================

const handleExportAppBackup = async () => {
  if (exportingAppBackup.value) return;

  try {
    const filePath = await saveDialog({
      defaultPath: `xianyu-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: '应用备份文件', extensions: ['json'] }],
    });
    if (!filePath) return;

    exportingAppBackup.value = true;

    const { json, summary } = await exportAppBackup(collectionsStore.playlists, {
      includePlugins: true,
      includeSettings: true,
      resolveSongsByPaths: libraryStore.resolveSongsByPaths,
    });

    await debugApi.writeLogExport(filePath, json);

    showToast(
      `已导出 ${summary.playlistCount} 个歌单、${summary.pluginCount} 个插件${summary.hasSettings ? '及设置' : ''}`,
      'success',
    );
  } catch (error: any) {
    showToast(`导出备份失败：${error?.message || error}`, 'error');
  } finally {
    exportingAppBackup.value = false;
  }
};

// ==================== 应用备份导入 ====================

const handleImportAppBackup = async () => {
  if (importingAppBackup.value) return;

  try {
    const selected = await open({
      multiple: false,
      title: '选择应用备份文件',
      filters: [{ name: '应用备份文件', extensions: ['json'] }],
    });
    if (typeof selected !== 'string') return;

    importingAppBackup.value = true;

    const content = await readPluginFile(selected);
    const backup = parseAppBackup(content);

    const result = await importAppBackup(backup, collectionsStore, libraryStore, {
      patchSettings,
      replaceSettings,
    }, {
      includePlaylists: true,
      includePlugins: true,
      includeSettings: true,
    });

    appBackupResult.value = result;
    showAppBackupResult.value = true;

    const parts: string[] = [];
    if (result.importedPlaylists > 0) parts.push(`${result.importedPlaylists} 个歌单`);
    if (result.importedPlugins > 0) parts.push(`${result.importedPlugins} 个插件`);
    if (result.settingsApplied) parts.push('设置');
    if (parts.length > 0) {
      showToast(`已导入 ${parts.join('、')}`, 'success');
    } else {
      showToast('备份中无新数据可导入', 'info');
    }
  } catch (error: any) {
    showToast(`导入备份失败：${error?.message || error}`, 'error');
  } finally {
    importingAppBackup.value = false;
  }
};
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">高级设置</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-white/45">面向问题排查与数据管理的高级功能。</p>
    </div>

    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">应用备份</h3>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
          将歌单（自动区分本地/在线/混合）、插件和本地设置导出为单个 JSON 文件，可快速导入恢复。
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          :disabled="exportingAppBackup"
          class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-6 py-3 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/30 disabled:cursor-wait disabled:opacity-55 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/8"
          @click="handleExportAppBackup"
        >
          <Loader2 v-if="exportingAppBackup" class="h-4 w-4 animate-spin" />
          <FileUp v-else class="h-4 w-4 text-[#EC4141]" />
          {{ exportingAppBackup ? '正在导出…' : '导出备份' }}
        </button>
        <button
          type="button"
          :disabled="importingAppBackup"
          class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-6 py-3 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/30 disabled:cursor-wait disabled:opacity-55 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/8"
          @click="handleImportAppBackup"
        >
          <Loader2 v-if="importingAppBackup" class="h-4 w-4 animate-spin" />
          <FileDown v-else class="h-4 w-4 text-[#EC4141]" />
          {{ importingAppBackup ? '正在导入…' : '导入备份' }}
        </button>
      </div>
      <p class="text-[11px] leading-5 text-gray-400 dark:text-white/35">
        导入时会自动恢复歌单、插件（跳过已存在的）和应用设置；在线歌曲需对应插件已安装才能播放。
      </p>
    </section>

    <section class="space-y-3 border-t border-black/10 pt-6 dark:border-white/10">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">从其他软件导入</h3>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
          从 BakaMusic 或 MusicFree 软件导入歌单。系统会按歌曲来源检查已安装插件，只导入能够关联到插件的歌曲。
        </p>
      </div>
      <button
        type="button"
        :disabled="importingBackup"
        class="inline-flex items-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-4 py-3 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/30 disabled:cursor-wait disabled:opacity-55 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/8"
        @click="importPluginBackup"
      >
        <Loader2 v-if="importingBackup" class="h-4 w-4 animate-spin" />
        <FileDown v-else class="h-4 w-4 text-[#EC4141]" />
        {{ importingBackup ? '正在检查插件并导入…' : '从其他软件导入歌单' }}
      </button>
      <p class="text-[11px] leading-5 text-gray-400 dark:text-white/35">
        导入完成后会统一列出成功关联的插件、缺失插件，以及所有未能导入的歌曲。
      </p>
    </section>

    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">导出日志</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">导出本机保留的应用日志，便于反馈问题或自行排查。</p>
      </div>
      <LogExportActions />
    </section>

    <section class="space-y-3 border-t border-black/10 pt-6 dark:border-white/10">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">日志管理</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">删除后无法恢复，建议先导出需要保留的日志。</p>
      </div>
      <button
        type="button"
        :disabled="entryCount === 0"
        class="inline-flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.04] px-4 py-3 text-sm font-medium text-rose-600 transition hover:bg-rose-500/[0.09] disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"
        @click="showDeleteConfirmation = true"
      >
        <Trash2 class="h-4 w-4" />
        删除全部日志
      </button>
    </section>

    <section
      class="space-y-3 rounded-xl border border-gray-200/40 bg-white/20 p-5 shadow-sm backdrop-blur-md dark:border-gray-800/40 dark:bg-black/10"
      @focusin="refreshFeedbackAuth"
    >
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">问题反馈</h3>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
          提交使用中遇到的问题或功能建议，我们会认真查看每一条反馈。
        </p>
      </div>

      <!-- 未登录提示 -->
      <div
        v-if="!isFeedbackLoggedIn"
        class="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-700 dark:text-amber-300"
      >
        请先登录账号后再提交反馈。
      </div>

      <!-- 反馈表单（未登录时禁用） -->
      <div class="space-y-3" :class="{ 'pointer-events-none opacity-50': !isFeedbackLoggedIn }">
        <label class="block">
          <span class="text-xs text-gray-500 dark:text-white/45">标题</span>
          <input
            v-model="feedbackTitle"
            type="text"
            maxlength="60"
            placeholder="一句话描述问题或建议"
            class="mt-2 h-9 w-full rounded-lg border border-gray-200/40 bg-white/20 px-3 text-sm text-gray-800 shadow-sm backdrop-blur-md outline-none transition focus:border-[#EC4141]/40 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100"
          />
          <span class="mt-1 block text-right text-[11px] text-gray-400 dark:text-white/35">
            {{ feedbackTitle.length }} / 60
          </span>
        </label>

        <label class="block">
          <span class="text-xs text-gray-500 dark:text-white/45">详细内容</span>
          <textarea
            v-model="feedbackContent"
            rows="5"
            maxlength="1000"
            placeholder="请详细描述问题现象、复现步骤或建议内容"
            class="mt-2 w-full resize-y rounded-lg border border-gray-200/40 bg-white/20 px-3 py-2 text-sm leading-6 text-gray-800 shadow-sm backdrop-blur-md outline-none transition focus:border-[#EC4141]/40 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100"
          />
          <span class="mt-1 block text-right text-[11px] text-gray-400 dark:text-white/35">
            {{ feedbackContent.length }} / 1000
          </span>
        </label>

        <button
          type="button"
          :disabled="submittingFeedback"
          class="inline-flex items-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-4 py-3 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/30 disabled:cursor-wait disabled:opacity-55 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/8"
          @click="submitUserFeedback"
        >
          <Loader2 v-if="submittingFeedback" class="h-4 w-4 animate-spin" />
          {{ submittingFeedback ? '正在提交…' : '提交反馈' }}
        </button>
      </div>
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
  </div>
</template>
