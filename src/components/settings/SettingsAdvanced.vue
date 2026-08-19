<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ChevronLeft, ChevronRight, FileDown, FileUp, History, Loader2, Plus, Trash2, UploadCloud, X } from 'lucide-vue-next';

import { useToast } from '../../composables/toast';
import { useCollectionsStore } from '../../features/collections/store';
import { useLibraryStore } from '../../features/library/store';
import { useSettings } from '../../features/settings/useSettings';
import {
  analyzeApplicationLogs,
  formatApplicationLogExport,
  useApplicationLogs,
} from '../../services/applicationLogger';
import { getStoredAuth } from '../../services/auth/authService';
import { getStoredPlugins } from '../../services/pluginEngine';
import { submitFeedback, getMyFeedback, type MyFeedbackItem } from '../../services/usageStats';
import {
  describeBackupVersion,
  preparePluginBackupImport,
  type PreparedPluginBackupImport,
} from '../../services/pluginBackupImport';
import {
  exportAppBackup,
  parseAppBackup,
  importAppBackup,
  type AppBackupImportResult,
} from '../../services/appBackup';
import { readPluginFile, readFileBytes } from '../../services/tauri/pluginApi';
import { extractJsonFromZip } from '../../services/zipReader';
import { gunzipSync } from '../../services/pureInflate';
import { debugApi } from '../../services/tauri/debugApi';
import { modalDragInterceptActive } from '../../composables/dragState';
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
// 反馈类型二选一：problem（问题反馈）/ suggestion（功能建议）
const feedbackType = ref<'problem' | 'suggestion'>('problem');
const feedbackContent = ref('');
const submittingFeedback = ref(false);
const feedbackAuth = ref(getStoredAuth());
const attachErrorLogs = ref(false);
const attachAllLogs = ref(false);
// 功能建议上传图片（压缩后的 data URL）
const feedbackImages = ref<string[]>([]);
const maxFeedbackImages = 6;
const feedbackImageInput = ref<HTMLInputElement | null>(null);
const compressingImage = ref(false);
// 我的反馈
const showMyFeedback = ref(false);
const myFeedbackList = ref<MyFeedbackItem[]>([]);
const loadingMyFeedback = ref(false);
// 我的反馈图片查看器
const fbViewerVisible = ref(false);
const fbViewerList = ref<string[]>([]);
const fbViewerIndex = ref(0);

// 登录态可能在设置页面打开后变化（如用户在其他窗口登录），聚焦时刷新一次
const refreshFeedbackAuth = () => {
  feedbackAuth.value = getStoredAuth();
};
const isFeedbackLoggedIn = computed(() => !!feedbackAuth.value?.user?.ciyuanxi_id);

// 是否有日志（用于控制「附上全部日志」勾选框显示）
const hasAnyLogs = computed(() => entries.value.length > 0);
// 是否有错误日志（用于控制「附上错误日志」勾选框显示）
const hasErrorLogs = computed(() => entries.value.some(e => e.level === 'error'));

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

/** 压缩图片为 data URL（JPEG），最大宽度 1600，质量 0.82 */
const compressImageToDataUrl = (file: File, maxWidth = 1600, quality = 0.82): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 上下文不可用'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        canvas.width = 0;
        canvas.height = 0;
        img.onload = null;
        img.onerror = null;
        img.src = '';
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
};

const triggerFeedbackImageSelect = () => {
  feedbackImageInput.value?.click();
};

const onFeedbackImageChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0) return;
  if (feedbackImages.value.length + files.length > maxFeedbackImages) {
    showToast(`最多上传 ${maxFeedbackImages} 张图片`, 'error');
    return;
  }
  compressingImage.value = true;
  try {
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        showToast(`图片 ${file.name} 超过 8MB，已跳过`, 'error');
        continue;
      }
      const dataUrl = await compressImageToDataUrl(file);
      feedbackImages.value.push(dataUrl);
    }
  } catch (error: any) {
    showToast(`图片处理失败：${error?.message || error}`, 'error');
  } finally {
    compressingImage.value = false;
  }
};

const removeFeedbackImage = (index: number) => {
  feedbackImages.value.splice(index, 1);
};

const submitUserFeedback = async () => {
  if (submittingFeedback.value) return;

  const content = feedbackContent.value.trim();
  const title = feedbackType.value === 'suggestion' ? '功能建议' : '问题反馈';

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
    let errorLogsText: string | undefined;
    let allLogsText: string | undefined;
    if (feedbackType.value === 'problem' && (attachErrorLogs.value || attachAllLogs.value)) {
      const analysis = analyzeApplicationLogs(entries.value);
      if (attachErrorLogs.value) {
        errorLogsText = formatApplicationLogExport(entries.value, 'error', analysis);
      }
      if (attachAllLogs.value) {
        allLogsText = formatApplicationLogExport(entries.value, 'all', analysis);
      }
    }
    await submitFeedback(title, content, {
      feedbackType: feedbackType.value,
      errorLogs: errorLogsText,
      allLogs: allLogsText,
      images: feedbackType.value === 'suggestion' ? [...feedbackImages.value] : undefined,
    });
    showToast('反馈已提交，感谢您的支持', 'success');
    feedbackContent.value = '';
    feedbackImages.value = [];
    attachErrorLogs.value = false;
    attachAllLogs.value = false;
  } catch (error: any) {
    showToast(`提交失败：${error?.message || error}`, 'error');
  } finally {
    submittingFeedback.value = false;
  }
};

// ===== 我的反馈 =====
const openMyFeedback = async () => {
  if (!isFeedbackLoggedIn.value) {
    showToast('请先登录后再查看反馈', 'error');
    return;
  }
  showMyFeedback.value = true;
  loadingMyFeedback.value = true;
  try {
    myFeedbackList.value = await getMyFeedback();
  } catch (error: any) {
    showToast(`获取反馈失败：${error?.message || error}`, 'error');
  } finally {
    loadingMyFeedback.value = false;
  }
};

const closeMyFeedback = () => {
  if (loadingMyFeedback.value) return;
  showMyFeedback.value = false;
};

// 我的反馈图片查看器
const openFbViewer = (imgs: string[], index: number) => {
  fbViewerList.value = imgs;
  fbViewerIndex.value = index;
  fbViewerVisible.value = true;
};
const closeFbViewer = () => {
  fbViewerVisible.value = false;
  fbViewerList.value = [];
};
const fbViewerPrev = () => {
  if (fbViewerList.value.length === 0) return;
  fbViewerIndex.value = (fbViewerIndex.value - 1 + fbViewerList.value.length) % fbViewerList.value.length;
};
const fbViewerNext = () => {
  if (fbViewerList.value.length === 0) return;
  fbViewerIndex.value = (fbViewerIndex.value + 1) % fbViewerList.value.length;
};
// 堆叠样式：仅第一张完整显示，其余叠压其后
const fbStackStyle = (i: number, total: number): Record<string, string> => {
  if (total <= 1) return {};
  const offset = Math.min(i, 3) * 5;
  return {
    left: `${offset}px`,
    top: `${offset}px`,
    zIndex: String(total - i),
  };
};

const myFeedbackStatusLabel = (status: string): { text: string; cls: string } => {
  switch (status) {
    case 'pending':
      return { text: '已发送', cls: 'fb-status-pending' };
    case 'processing':
      return { text: '处理中', cls: 'fb-status-processing' };
    case 'resolved':
      return { text: '已处理', cls: 'fb-status-resolved' };
    case 'rejected':
      return { text: '已拒绝', cls: 'fb-status-rejected' };
    default:
      return { text: status, cls: '' };
  }
};

const myFeedbackTypeLabel = (type: string): string => {
  return type === 'suggestion' ? '功能建议' : '问题反馈';
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
      includeFavorites: true,
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
          @click="handleExportAppBackup"
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

    <div class="space-y-3 border-t border-black/10 pt-6 dark:border-white/10">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          问题反馈
        </h2>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
          提交使用中遇到的问题或功能建议，我们会认真查看每一条反馈。
        </p>
      </div>

      <section
        class="space-y-3 rounded-xl border border-gray-200/40 bg-white/20 p-5 dark:border-gray-800/40 dark:bg-black/10"
        @focusin="refreshFeedbackAuth"
      >
      <!-- 未登录提示 -->
      <div
        v-if="!isFeedbackLoggedIn"
        class="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-700 dark:text-amber-300"
      >
        请先登录账号后再提交反馈。
      </div>

      <!-- 反馈表单（未登录时禁用） -->
      <div class="space-y-3" :class="{ 'pointer-events-none opacity-50': !isFeedbackLoggedIn }">
        <!-- 反馈类型二选一 -->
        <div>
          <span class="text-xs text-gray-500 dark:text-white/45">反馈类型</span>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              :class="feedbackType === 'problem' ? 'fb-type-btn fb-type-btn--active' : 'fb-type-btn'"
              @click="feedbackType = 'problem'"
            >
              问题反馈
            </button>
            <button
              type="button"
              :class="feedbackType === 'suggestion' ? 'fb-type-btn fb-type-btn--active' : 'fb-type-btn'"
              @click="feedbackType = 'suggestion'"
            >
              功能建议
            </button>
          </div>
        </div>

        <label class="block">
          <span class="text-xs text-gray-500 dark:text-white/45">详细内容</span>
          <textarea
            v-model="feedbackContent"
            rows="5"
            maxlength="1000"
            :placeholder="feedbackType === 'suggestion' ? '请描述你希望新增或改进的功能' : '请详细描述问题现象、复现步骤'"
            class="mt-2 w-full resize-y rounded-lg border border-black/10 bg-white/45 px-3 py-2 text-sm leading-6 text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
          />
          <span class="mt-1 block text-right text-[11px] text-gray-400 dark:text-white/35">
            {{ feedbackContent.length }} / 1000
          </span>
        </label>

        <!-- 日志附送勾选：仅问题反馈可选，且无对应日志时不显示 -->
        <div v-if="feedbackType === 'problem' && (hasErrorLogs || hasAnyLogs)" class="flex flex-wrap items-center gap-4">
          <label v-if="hasErrorLogs" class="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-white/55">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 rounded border-gray-300 text-[#EC4141] focus:ring-[#EC4141]/30 dark:border-gray-600 dark:bg-gray-700"
              :checked="attachErrorLogs"
              @change="attachErrorLogs = ($event.target as HTMLInputElement).checked"
            />
            附上错误日志
          </label>
          <label v-if="hasAnyLogs" class="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-white/55">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 rounded border-gray-300 text-[#EC4141] focus:ring-[#EC4141]/30 dark:border-gray-600 dark:bg-gray-700"
              :checked="attachAllLogs"
              @change="attachAllLogs = ($event.target as HTMLInputElement).checked"
            />
            附上全部日志
          </label>
        </div>

        <!-- 图片上传：仅功能建议支持 -->
        <div v-if="feedbackType === 'suggestion'" class="feedback-images">
          <div class="fb-img-head">
            <span class="text-xs text-gray-500 dark:text-white/45">
              上传图片（可选，最多 {{ maxFeedbackImages }} 张）
            </span>
            <button
              type="button"
              :disabled="compressingImage || feedbackImages.length >= maxFeedbackImages"
              class="fb-img-add-btn"
              @click="triggerFeedbackImageSelect"
            >
              <Plus v-if="!compressingImage" class="h-3.5 w-3.5" />
              <Loader2 v-else class="h-3.5 w-3.5 animate-spin" />
              {{ compressingImage ? '处理中…' : '添加图片' }}
            </button>
          </div>
          <div v-if="feedbackImages.length > 0" class="fb-img-grid">
            <div v-for="(img, idx) in feedbackImages" :key="idx" class="fb-img-item">
              <img :src="img" alt="反馈图片预览" class="fb-img-preview" />
              <button type="button" class="fb-img-remove" @click="removeFeedbackImage(idx)">
                <X class="h-3 w-3" />
              </button>
            </div>
          </div>
          <input
            ref="feedbackImageInput"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            @change="onFeedbackImageChange"
          />
        </div>

        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            :disabled="submittingFeedback"
            class="inline-flex items-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/30 disabled:cursor-wait disabled:opacity-55 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/8"
            @click="submitUserFeedback"
          >
            <Loader2 v-if="submittingFeedback" class="h-4 w-4 animate-spin" />
            {{ submittingFeedback ? '正在提交…' : '提交反馈' }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-xl border border-gray-200/40 bg-white/20 px-4 py-2 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/30 dark:border-gray-800/40 dark:bg-black/10 dark:text-gray-100 dark:hover:bg-white/8"
            @click="openMyFeedback"
          >
            <History class="h-4 w-4 text-[#EC4141]" />
            查看我的反馈
          </button>
        </div>
      </div>
    </section>
    </div>

    <section class="space-y-3 border-t border-black/10 pt-6 dark:border-white/10">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          导出日志
        </h2>
        <p class="mt-1 text-xs text-gray-500 dark:text-white/45">导出本机保留的应用日志，便于反馈问题或自行排查。</p>
      </div>
      <LogExportActions />
    </section>

    <section class="space-y-3 border-t border-black/10 pt-6 dark:border-white/10">
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

    <!-- 我的反馈弹窗 -->
    <Teleport to="body">
      <transition name="modal-fade">
        <div v-if="showMyFeedback" class="fb-modal-overlay" @click.self="closeMyFeedback">
          <div class="fb-modal">
            <div class="fb-modal-head">
              <h3>我的反馈</h3>
              <button type="button" class="fb-modal-close" @click="closeMyFeedback">
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="fb-modal-body">
              <div v-if="loadingMyFeedback" class="fb-my-loading">
                <Loader2 class="h-5 w-5 animate-spin" />
                <span>加载中...</span>
              </div>
              <div v-else-if="myFeedbackList.length === 0" class="fb-my-empty">
                <p>暂无反馈记录</p>
                <span>提交的反馈将显示在这里，可随时查看处理进度</span>
              </div>
              <div v-else class="fb-my-list">
                <div v-for="item in myFeedbackList" :key="item.id" class="fb-my-item">
                  <div class="fb-my-top">
                    <span class="fb-my-type">{{ myFeedbackTypeLabel(item.feedbackType) }}</span>
                    <span class="fb-status" :class="myFeedbackStatusLabel(item.status).cls">
                      {{ myFeedbackStatusLabel(item.status).text }}
                    </span>
                  </div>
                  <div class="fb-my-main">
                    <div class="fb-my-left">
                      <p class="fb-my-content">{{ item.content }}</p>
                      <div v-if="item.status === 'resolved' && item.resolveNote" class="fb-my-reply">
                        <span class="fb-my-reply-label">处理说明（{{ item.repliedBy || item.assignee || '管理员' }}）</span>
                        <span>{{ item.resolveNote }}</span>
                      </div>
                      <div v-else-if="item.status === 'rejected' && item.rejectReason" class="fb-my-reply fb-my-reply-reject">
                        <span class="fb-my-reply-label">拒绝理由（{{ item.repliedBy || item.assignee || '管理员' }}）</span>
                        <span>{{ item.rejectReason }}</span>
                      </div>
                      <div class="fb-my-meta">
                        <span>{{ item.createdAt }}</span>
                      </div>
                    </div>
                    <div v-if="item.images && item.images.length > 0" class="fb-my-right" @click="openFbViewer(item.images, 0)">
                      <img
                        v-for="(img, i) in item.images"
                        :key="i"
                        :src="img"
                        alt="反馈图片"
                        class="fb-my-img"
                        :style="fbStackStyle(i, item.images.length)"
                      />
                      <span v-if="item.images.length > 1" class="fb-my-count">{{ item.images.length }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="!loadingMyFeedback && myFeedbackList.length > 0" class="fb-modal-foot">
              <button type="button" class="fb-modal-done" @click="closeMyFeedback">关闭</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 我的反馈图片查看器 -->
    <Teleport to="body">
      <transition name="viewer-fade">
        <div v-if="fbViewerVisible" class="fb-viewer-overlay" @click.self="closeFbViewer">
          <button type="button" class="fb-viewer-close" @click="closeFbViewer">
            <X class="h-6 w-6" />
          </button>
          <button
            v-if="fbViewerList.length > 1"
            type="button"
            class="fb-viewer-nav fb-viewer-prev"
            @click="fbViewerPrev"
          >
            <ChevronLeft class="h-7 w-7" />
          </button>
          <img
            v-if="fbViewerList[fbViewerIndex]"
            :src="fbViewerList[fbViewerIndex]"
            alt="反馈图片预览"
            class="fb-viewer-img"
          />
          <button
            v-if="fbViewerList.length > 1"
            type="button"
            class="fb-viewer-nav fb-viewer-next"
            @click="fbViewerNext"
          >
            <ChevronRight class="h-7 w-7" />
          </button>
          <div v-if="fbViewerList.length > 1" class="fb-viewer-counter">{{ fbViewerIndex + 1 }} / {{ fbViewerList.length }}</div>
        </div>
      </transition>
    </Teleport>

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
/* ─── 反馈类型二选一按钮 ─── */
.fb-type-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.2);
  color: rgba(0, 0, 0, 0.65);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
  cursor: pointer;
}
:global(.dark) .fb-type-btn,
.dark .fb-type-btn {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
}
.fb-type-btn:hover {
  border-color: rgba(236, 65, 65, 0.3);
  background: rgba(255, 255, 255, 0.3);
}
.fb-type-btn--active {
  border-color: rgba(236, 65, 65, 0.55);
  color: #ec4141;
  background: rgba(236, 65, 65, 0.08);
  box-shadow: 0 0 0 1px rgba(236, 65, 65, 0.15);
}
:global(.dark) .fb-type-btn--active,
.dark .fb-type-btn--active {
  border-color: rgba(236, 65, 65, 0.6);
  color: #ff6b6b;
  background: rgba(236, 65, 65, 0.16);
}

/* ─── 功能建议图片上传 ─── */
.feedback-images {
  margin-top: 4px;
}
.fb-img-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.fb-img-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px dashed rgba(236, 65, 65, 0.45);
  border-radius: 8px;
  background: rgba(236, 65, 65, 0.05);
  color: #ec4141;
  font-size: 12px;
  transition: all 0.2s ease;
  cursor: pointer;
}
:global(.dark) .fb-img-add-btn,
.dark .fb-img-add-btn {
  color: #ff6b6b;
  background: rgba(236, 65, 65, 0.1);
}
.fb-img-add-btn:hover:enabled {
  background: rgba(236, 65, 65, 0.12);
}
.fb-img-add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.fb-img-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.fb-img-item {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
:global(.dark) .fb-img-item,
.dark .fb-img-item {
  border-color: rgba(255, 255, 255, 0.1);
}
.fb-img-preview {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  display: block;
}
.fb-img-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s ease;
}
.fb-img-remove:hover {
  background: rgba(0, 0, 0, 0.75);
}

/* ─── 我的反馈弹窗 ─── */
.fb-modal-overlay {
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
.fb-modal {
  width: 420px;
  max-width: 92vw;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
:global(.dark) .fb-modal,
.dark .fb-modal {
  background: #262626;
}
.fb-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
}
.fb-modal-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
}
:global(.dark) .fb-modal-head h3,
.dark .fb-modal-head h3 {
  color: rgba(255, 255, 255, 0.9);
}
.fb-modal-close {
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
:global(.dark) .fb-modal-close,
.dark .fb-modal-close {
  color: rgba(255, 255, 255, 0.55);
}
.fb-modal-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.85);
}
:global(.dark) .fb-modal-close:hover,
.dark .fb-modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}
.fb-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 18px 16px;
}
.fb-my-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
:global(.dark) .fb-my-loading,
.dark .fb-my-loading {
  color: rgba(255, 255, 255, 0.45);
}
.fb-my-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 44px 0;
  text-align: center;
}
.fb-my-empty p {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.55);
}
:global(.dark) .fb-my-empty p,
.dark .fb-my-empty p {
  color: rgba(255, 255, 255, 0.55);
}
.fb-my-empty span {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.35);
}
:global(.dark) .fb-my-empty span,
.dark .fb-my-empty span {
  color: rgba(255, 255, 255, 0.35);
}
.fb-my-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fb-my-item {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 12px 14px;
  background: rgba(0, 0, 0, 0.02);
}
:global(.dark) .fb-my-item,
.dark .fb-my-item {
  border-color: rgba(255, 255, 255, 0.09);
  background: rgba(255, 255, 255, 0.03);
}
.fb-my-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.fb-my-type {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
}
:global(.dark) .fb-my-type,
.dark .fb-my-type {
  background: rgba(236, 65, 65, 0.16);
  color: #ff6b6b;
}
.fb-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}
.fb-status-pending {
  background: rgba(236, 65, 65, 0.1);
  color: #ec4141;
}
:global(.dark) .fb-status-pending,
.dark .fb-status-pending {
  background: rgba(236, 65, 65, 0.18);
  color: #ff6b6b;
}
.fb-status-processing {
  background: rgba(240, 150, 60, 0.12);
  color: #e8912d;
}
:global(.dark) .fb-status-processing,
.dark .fb-status-processing {
  background: rgba(240, 150, 60, 0.2);
  color: #ffb066;
}
.fb-status-resolved {
  background: rgba(52, 199, 89, 0.12);
  color: #34c759;
}
:global(.dark) .fb-status-resolved,
.dark .fb-status-resolved {
  background: rgba(52, 199, 89, 0.2);
  color: #5fe589;
}
.fb-status-rejected {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.5);
}
:global(.dark) .fb-status-rejected,
.dark .fb-status-rejected {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.5);
}
.fb-my-content {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(0, 0, 0, 0.75);
  word-break: break-word;
  white-space: pre-wrap;
}
:global(.dark) .fb-my-content,
.dark .fb-my-content {
  color: rgba(255, 255, 255, 0.75);
}
.fb-my-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 8px;
}
.fb-my-left {
  flex: 1;
  min-width: 0;
}
.fb-my-right {
  position: relative;
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  cursor: zoom-in;
}
.fb-my-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
}
:global(.dark) .fb-my-img,
.dark .fb-my-img {
  border-color: rgba(255, 255, 255, 0.1);
  background: #262626;
}
.fb-my-count {
  position: absolute;
  right: -6px;
  bottom: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 20px;
  text-align: center;
  z-index: 20;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}
.fb-my-reply {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(52, 199, 89, 0.08);
  border: 1px solid rgba(52, 199, 89, 0.18);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
:global(.dark) .fb-my-reply,
.dark .fb-my-reply {
  background: rgba(52, 199, 89, 0.12);
  border-color: rgba(52, 199, 89, 0.25);
}
.fb-my-reply-label {
  font-size: 11px;
  font-weight: 600;
  color: #34c759;
}
:global(.dark) .fb-my-reply-label,
.dark .fb-my-reply-label {
  color: #5fe589;
}
.fb-my-reply-reject {
  background: rgba(255, 59, 48, 0.08);
  border-color: rgba(255, 59, 48, 0.18);
}
:global(.dark) .fb-my-reply-reject,
.dark .fb-my-reply-reject {
  background: rgba(255, 59, 48, 0.14);
  border-color: rgba(255, 59, 48, 0.28);
}
.fb-my-reply-reject .fb-my-reply-label {
  color: #ff3b30;
}
:global(.dark) .fb-my-reply-reject .fb-my-reply-label,
.dark .fb-my-reply-reject .fb-my-reply-label {
  color: #ff6b62;
}
.fb-my-reply span:last-child {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.7);
}
:global(.dark) .fb-my-reply span:last-child,
.dark .fb-my-reply span:last-child {
  color: rgba(255, 255, 255, 0.7);
}
.fb-my-meta {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.35);
}
:global(.dark) .fb-my-meta,
.dark .fb-my-meta {
  color: rgba(255, 255, 255, 0.35);
}
.fb-modal-foot {
  padding: 12px 18px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  justify-content: flex-end;
}
:global(.dark) .fb-modal-foot,
.dark .fb-modal-foot {
  border-top-color: rgba(255, 255, 255, 0.08);
}
.fb-modal-done {
  padding: 7px 18px;
  border-radius: 9px;
  background: #ec4141;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s ease;
}
.fb-modal-done:hover {
  opacity: 0.9;
}

/* 弹窗淡入淡出 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

/* ─── 我的反馈图片查看器 ─── */
.fb-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.fb-viewer-img {
  max-width: 88vw;
  max-height: 84vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.fb-viewer-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s ease;
}
.fb-viewer-close:hover {
  background: rgba(255, 255, 255, 0.24);
}
.fb-viewer-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s ease;
}
.fb-viewer-nav:hover {
  background: rgba(255, 255, 255, 0.24);
}
.fb-viewer-prev {
  left: 18px;
}
.fb-viewer-next {
  right: 18px;
}
.fb-viewer-counter {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 14px;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
}
.viewer-fade-enter-active,
.viewer-fade-leave-active {
  transition: opacity 0.2s ease;
}
.viewer-fade-enter-from,
.viewer-fade-leave-to {
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
