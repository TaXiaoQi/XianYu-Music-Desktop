<template>
  <div class="settings-content">
    <div class="setting-item-group">
      <h2 class="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        {{ sectionTitle }}
      </h2>
      <button
        @click="pickAndAddFolder"
        type="button"
        :disabled="scanBusy"
        class="drop-zone"
      >
        <div class="drop-zone-inner">
          <svg
            class="drop-zone-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
            />
            <line
              x1="12" y1="11" x2="12" y2="17"
            />
            <polyline
              points="9 14 12 11 15 14"
            />
          </svg>

          <template v-if="!hasFolders">
            <p class="drop-zone-text highlight">{{ dropZoneHint }}</p>
          </template>

          <template v-else>
            <p class="drop-zone-text">{{ dropZoneHint }}</p>
          </template>
        </div>
      </button>

      <div class="network-share-row">
        <div class="network-share-copy">
          <div class="network-share-title">局域网共享文件夹</div>
          <div class="network-share-desc">支持 NAS、SMB 共享和映射网络驱动器，例如 \\NAS\Music。</div>
        </div>
        <button
          class="network-share-button"
          type="button"
          :disabled="scanBusy"
          @click="shareDialogVisible = true"
        >
          输入共享路径
        </button>
      </div>

      <div class="short-audio-filter">
        <div class="short-audio-copy">
          <div class="short-audio-title">排除短音频</div>
          <div class="short-audio-desc">低于指定秒数的音频不会加入音乐库，0 表示关闭。</div>
        </div>
        <label class="short-audio-input-wrap">
          <input
            :value="minDurationSeconds"
            @change="onMinDurationInput"
            class="h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
          />
          <span>秒</span>
        </label>
      </div>

      <div class="library-list" v-if="hasFolders">
        <div class="library-item" v-for="folder in folders" :key="folder.path">
          <div class="folder-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              />
            </svg>
          </div>
          <div class="folder-info">
            <div class="folder-path" :title="folder.path">{{ folder.path }}</div>
            <div class="folder-stats">{{ folderStatLabel(folder) }}</div>
          </div>
          <button
            title="移除文件夹"
            class="remove-btn"
            @click="askToRemoveFolder(folder.path)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline
                points="3 6 5 6 21 6"
              />
              <path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              />
              <line
                x1="10" y1="11" x2="10" y2="17"
              />
              <line
                x1="14" y1="11" x2="14" y2="17"
              />
            </svg>
          </button>
        </div>
      </div>

      <div class="scan-status-card" v-if="showScanCard">
        <div class="scan-status-header">
          <div class="scan-status-title">{{ scanPhaseLabel }}</div>
          <div class="scan-status-count" v-if="scanCountText">
            {{ scanCountText }}
          </div>
        </div>
        <div class="scan-status-bar">
          <div
            class="scan-status-bar-fill"
            :class="scanBarClass"
            :style="scanBarStyle"
          ></div>
        </div>
        <div
          class="scan-status-path"
          v-if="scanFolderPath"
          :title="scanFolderPath"
        >
          {{ scanFolderPath }}
        </div>
      </div>

      <div class="scan-error-card" v-else-if="hasScanError">
        <div class="scan-error-title">上次扫描失败</div>
        <div class="scan-error-text">{{ scanError }}</div>
      </div>
    </div>

    <SettingsRemoteLibrary/>

    <ConfirmModal
      :content="removeConfirmText"
      title="移除文件夹"
      :visible="removeConfirmVisible"
      @cancel="removeConfirmVisible = false"
      @confirm="finalizeRemove"
    />
    <ModernInputModal
      @confirm="submitSharePath"
      title="添加局域网共享文件夹"
      placeholder="\\NAS\Music"
      confirm-text="添加"
      v-model:visible="shareDialogVisible"
    />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { ref, computed } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import ModernInputModal from '../common/ModernInputModal.vue';
import SettingsRemoteLibrary from './SettingsRemoteLibrary.vue';
import { useLibraryStore } from '../../features/library/store';
import {
  normalizeLibraryMinDurationSeconds,
  useSettingsStore,
} from '../../features/settings/store';
import { usePlayer } from '../../features/playback';
import { useToast } from '../../composables/toast';

const player = usePlayer();
const toast = useToast();
const library = useLibraryStore();
const preferences = useSettingsStore();
const { addLibraryFolderLinked, removeLibraryFolderLinked } = player;
const { showToast } = toast;
const {
  libraryFolders: folders,
  libraryScanProgress: scanProgress,
  lastLibraryScanError: scanError,
} = storeToRefs(library);
const { settings } = storeToRefs(preferences);

// 页面固定文案
const sectionTitle = '添加本地音乐';
const dropZoneHint = '点击导入文件夹，或拖入音频文件/文件夹';

type LibraryFolderRow = (typeof folders.value)[number];
const folderStatLabel = (folder: LibraryFolderRow) => `${folder.song_count} 首歌曲`;

// 是否仍有扫描任务在跑
const scanBusy = computed(() => {
  const progress = scanProgress.value;
  return progress != null && !progress.done && !progress.failed;
});

const hasFolders = computed(() => folders.value.length > 0);

// 短音频时长阈值的双向绑定
const minDurationSeconds = computed({
  get: () => settings.value.libraryMinDurationSeconds,
  set: next => {
    settings.value.libraryMinDurationSeconds = normalizeLibraryMinDurationSeconds(next);
  },
});

const onMinDurationInput = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const normalized = normalizeLibraryMinDurationSeconds(Number.parseFloat(input.value));
  input.value = `${normalized}`;
  minDurationSeconds.value = normalized;
};

// 扫描阶段 -> 提示文案
const SCAN_PHASE_LABELS: Record<string, string> = {
  collecting: '正在扫描文件',
  parsing: '正在解析歌曲信息',
  writing: '正在写入音乐库',
  complete: '扫描完成',
  error: '扫描失败',
};
const scanPhaseLabel = computed(() => {
  const phase = scanProgress.value?.phase;
  return (phase != null && SCAN_PHASE_LABELS[phase]) || '等待扫描';
});

const showScanCard = computed(() => scanBusy.value && scanProgress.value != null);
const hasScanError = computed(() => !!scanError.value);

const scanCountText = computed(() => {
  const progress = scanProgress.value;
  if (!progress || progress.total <= 0) {
    return '';
  }
  return `${progress.current}/${progress.total}`;
});

const scanBarClass = computed(() => ({
  indeterminate: (scanProgress.value?.total ?? 0) <= 0,
}));

const scanBarStyle = computed(() => {
  const progress = scanProgress.value;
  const ratio =
    progress && progress.total > 0
      ? Math.min(100, Math.max(8, (progress.current / progress.total) * 100))
      : 24;
  return { width: `${ratio}%` };
});

const scanFolderPath = computed(() => scanProgress.value?.folder_path ?? '');

// 移除确认弹窗状态
const removeConfirmVisible = ref(false);
const targetRemovePath = ref('');
const removeConfirmText = ref('');
// 局域网共享路径弹窗
const shareDialogVisible = ref(false);

const pickAndAddFolder = async () => {
  if (scanBusy.value) {
    return;
  }
  const picked = await open({ directory: true, multiple: false, title: '选择音乐文件夹' });
  if (typeof picked !== 'string' || !picked) {
    return;
  }
  const firstImport = folders.value.length === 0;
  await addLibraryFolderLinked(picked, {
    showToast: !firstImport,
    scanOptions: {
      trigger: firstImport ? 'first-import' : 'folder-add',
      visibility: firstImport ? 'hero' : 'silent',
      sourcePath: picked,
    },
  });
};

const submitSharePath = async (rawPath: string) => {
  const path = rawPath.trim().replace(/^"|"$/g, '');
  const looksLikeUnc = path.startsWith('\\\\') || path.startsWith('//');
  if (!looksLikeUnc) {
    showToast('请输入 UNC 共享路径，例如 \\\\NAS\\Music', 'error');
    return;
  }
  try {
    const firstImport = folders.value.length === 0;
    await addLibraryFolderLinked(path, {
      showToast: true,
      scanOptions: {
        trigger: firstImport ? 'first-import' : 'folder-add',
        visibility: firstImport ? 'hero' : 'silent',
        sourcePath: path,
      },
    });
  } catch (err) {
    console.error('Failed to add network share:', err);
    showToast(`添加局域网共享失败: ${err}`, 'error');
  }
};

const askToRemoveFolder = (path: string) => {
  targetRemovePath.value = path;
  removeConfirmText.value = `确定要从音乐库中移除 "${path}" 吗？\n歌曲会从“本地音乐”视图中消失。`;
  removeConfirmVisible.value = true;
};

const finalizeRemove = async () => {
  removeConfirmVisible.value = false;
  const path = targetRemovePath.value;
  if (!path) {
    return;
  }
  await removeLibraryFolderLinked(path);
  targetRemovePath.value = '';
};
</script>

<style scoped>
.settings-content { padding: 0 10px; }

.setting-item-group { border-radius: 12px; }

.drop-zone {
  width: 100%; padding: 20px; border: none; border-radius: 12px;
  display: flex; flex-direction: column; margin-bottom: 16px;
  background: rgba(0, 0, 0, 0.04); color: inherit; cursor: pointer; font: inherit;
  transition: background 0.2s ease, transform 0.2s ease;
}

.drop-zone:hover:not(:disabled) {
  transform: translateY(-1px); background: rgba(0, 0, 0, 0.07);
}

.drop-zone:disabled {
  opacity: 0.62; transform: none; cursor: not-allowed;
}

.drop-zone-inner {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 30px 0 20px;
}

.drop-zone-icon {
  opacity: 0.5; color: var(--text-secondary); margin-bottom: 12px;
}

.drop-zone-text {
  color: var(--text-secondary); margin: 0; text-align: center; font-size: 0.95rem;
}

.drop-zone-text.highlight {
  font-weight: 600; color: #ec4141; font-size: 1rem;
}

.library-list {
  gap: 10px; margin-bottom: 16px; display: flex; flex-direction: column;
}

.network-share-row {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 12px 14px; margin-bottom: 16px; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.04);
}

.network-share-copy { min-width: 0; }

.network-share-title {
  font-weight: 600; color: var(--text-primary); margin-bottom: 3px; font-size: 0.9rem;
}

.network-share-desc {
  line-height: 1.4; font-size: 0.78rem; color: var(--text-secondary);
}

.network-share-button {
  flex-shrink: 0; cursor: pointer; padding: 7px 12px; border-radius: 8px;
  border: 1px solid rgba(236, 65, 65, 0.28); font: inherit; font-size: 0.82rem;
  background: rgba(236, 65, 65, 0.08); color: #ec4141;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.network-share-button:hover:not(:disabled) {
  background: rgba(236, 65, 65, 0.14); border-color: rgba(236, 65, 65, 0.5);
}

.network-share-button:disabled {
  cursor: not-allowed; opacity: 0.5;
}

.short-audio-filter {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 12px 14px; margin-bottom: 16px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08);
}

.short-audio-copy { min-width: 0; }

.short-audio-title {
  color: var(--text-primary); font-weight: 600; margin-bottom: 3px; font-size: 0.9rem;
}

.short-audio-desc {
  color: var(--text-secondary); line-height: 1.4; font-size: 0.78rem;
}

.short-audio-input-wrap {
  display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;
  color: var(--text-secondary); font-size: 0.85rem;
}

.library-item {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(0, 0, 0, 0.2); transition: all 0.2s;
}

.library-item:hover {
  border-color: rgba(255, 255, 255, 0.12); background: rgba(0, 0, 0, 0.3);
}

.folder-icon {
  flex-shrink: 0; opacity: 0.6; color: var(--text-secondary);
  display: flex; align-items: center;
}

.folder-info {
  min-width: 0; flex: 1;
}

.folder-path {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--text-primary); margin-bottom: 3px; font-size: 0.95rem;
}

.folder-stats {
  font-size: 0.8rem; color: var(--text-secondary);
}

.remove-btn {
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  cursor: pointer; padding: 8px; border: none; border-radius: 8px;
  background: transparent; color: var(--text-secondary); transition: all 0.2s;
}

.remove-btn:hover {
  color: #ff4d4f; background: rgba(255, 0, 0, 0.12);
}

.scan-status-card,
.scan-error-card {
  padding: 14px 16px; margin-top: 14px; border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.04);
}

.scan-status-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}

.scan-status-title,
.scan-error-title {
  color: var(--text-primary); font-weight: 600; font-size: 0.9rem;
}

.scan-status-count {
  color: var(--text-secondary); font-size: 0.8rem;
}

.scan-status-bar {
  height: 8px; margin-top: 10px; overflow: hidden; border-radius: 9999px;
  background: rgba(255, 255, 255, 0.08);
}

.scan-status-bar-fill {
  height: 100%; border-radius: 9999px; transition: width 0.25s ease;
  background: linear-gradient(90deg, #ec4141, #ff7b63, #f7b267);
}

.scan-status-bar-fill.indeterminate {
  min-width: 24%; animation: scan-status-indeterminate 1.1s ease-in-out infinite alternate;
}

.scan-status-path,
.scan-error-text {
  word-break: break-all; margin-top: 10px; opacity: 0.82;
  color: var(--text-secondary); font-size: 0.82rem;
}

.scan-error-card {
  background: rgba(236, 65, 65, 0.08); border-color: rgba(236, 65, 65, 0.22);
}

@keyframes scan-status-indeterminate {
  from { transform: translateX(-16%); }
  to { transform: translateX(16%); }
}
</style>
