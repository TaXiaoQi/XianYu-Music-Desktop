<script setup lang="ts">
import { ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { FileUp, Loader2, Trash2 } from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import { useCollectionsStore } from '../../features/collections/store';
import { useLibraryStore } from '../../features/library/store';
import { useSettings } from '../../features/settings/useSettings';
import { useApplicationLogs } from '../../services/applicationLogger';
import { getStoredPlugins } from '../../services/pluginEngine';
import {
  preparePluginBackupFile,
  type PreparedPluginBackupImport,
} from '../../services/pluginBackupImport';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import BackupImportResultModal from './BackupImportResultModal.vue';
import LogExportActions from './LogExportActions.vue';

const { showToast } = useToast();
const { settings, patchSettings } = useSettings();
const { entries, clearLogs } = useApplicationLogs();
const collectionsStore = useCollectionsStore();
const libraryStore = useLibraryStore();
const showDeleteConfirmation = ref(false);
const retentionOptions = [1, 3, 7, 14, 30, 90];
const importingBackup = ref(false);
const backupImportResult = ref<PreparedPluginBackupImport | null>(null);
const createdPlaylistCount = ref(0);
const showBackupImportResult = ref(false);

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
      title: '选择 BakaMusic 或 MusicFree 备份文件',
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
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">高级设置</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-white/45">面向问题排查与数据管理的高级功能。</p>
    </div>

    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">备份与恢复</h3>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
          从 BakaMusic 或 MusicFree 的 JSON 备份恢复歌单。系统会按歌曲来源检查已安装插件，只导入能够关联到插件的歌曲。
        </p>
      </div>
      <button
        type="button"
        :disabled="importingBackup"
        class="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white/55 px-4 py-3 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/80 disabled:cursor-wait disabled:opacity-55 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/8"
        @click="importPluginBackup"
      >
        <Loader2 v-if="importingBackup" class="h-4 w-4 animate-spin" />
        <FileUp v-else class="h-4 w-4 text-[#EC4141]" />
        {{ importingBackup ? '正在检查插件并导入…' : '从 BakaMusic 或 MusicFree 软件导入歌单' }}
      </button>
      <p class="text-[11px] leading-5 text-gray-400 dark:text-white/35">
        导入完成后会统一列出成功关联的插件、缺失插件，以及所有未能导入的歌曲。
      </p>
    </section>

    <section class="space-y-3 border-t border-black/10 pt-6 dark:border-white/10">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">日志保留</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">超过保留时长的日志会自动清理。</p>
      </div>
      <label class="block max-w-sm">
        <span class="text-xs text-gray-500 dark:text-white/45">日志保留时长</span>
        <select
          :value="settings.logging.retentionDays"
          class="mt-2 h-9 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-sm text-gray-800 outline-none dark:border-white/10 dark:bg-black/20 dark:text-gray-100"
          @change="patchSettings({ logging: { retentionDays: Number(($event.target as HTMLSelectElement).value) } })"
        >
          <option v-for="days in retentionOptions" :key="days" :value="days">{{ days }} 天</option>
        </select>
      </label>
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
        :disabled="entries.length === 0"
        class="inline-flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.04] px-4 py-3 text-sm font-medium text-rose-600 transition hover:bg-rose-500/[0.09] disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"
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
  </div>
</template>
