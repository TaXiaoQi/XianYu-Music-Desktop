<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { Loader2, FileJson, FolderOpen, FileUp } from 'lucide-vue-next';
import type { Playlist, Song } from '../../types';
import { getImportSourcesFromPlugins, importPlaylist, importPlaylistFromMusicFreePlugin } from '../../services/playlistImport';
import type { PlaylistImportResult, PlaylistSource } from '../../services/playlistImport';
import { importBackupFile, SUPPORTED_IMPORT_EXTENSIONS } from '../../services/backupImport';
import type { ImportedPlaylist } from '../../services/backupImport';
import { fileApi } from '../../services/tauri/fileApi';
import { useToast } from '../../composables/toast';
import { modalDragInterceptActive } from '../../composables/dragState';
import { pluginsVersion } from '../../services/pluginEngine';

type TabType = 'create' | 'networkImport' | 'localFolderImport' | 'backupImport';

const props = defineProps<{
  visible: boolean;
  playlists: Playlist[];
}>();

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void;
  (event: 'create', name: string): void;
  (
    event: 'import',
    payload: { result: PlaylistImportResult; rename?: string },
  ): void;
  (event: 'import-local', payload: { name: string; songs: Song[] }): void;
  (event: 'import-backup', payload: ImportedPlaylist[]): void;
}>();

const { showToast } = useToast();

const activeTab = ref<TabType>('create');
const isClosing = ref(false);

// 新建歌单
const createName = ref('');
const createInputRef = ref<HTMLInputElement | null>(null);

// 云端导入
const importInput = ref('');
const importInputRef = ref<HTMLInputElement | null>(null);
const importSources = ref<PlaylistSource[]>(getImportSourcesFromPlugins());
const selectedSource = ref<string>('auto');
const sourceDropdownOpen = ref(false);
const importRename = ref('');
const importRenameRef = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importError = ref('');

// 从本地文件夹导入歌单
const localPlaylistName = ref('');
const localPlaylistNameRef = ref<HTMLInputElement | null>(null);
const localFolderPath = ref('');
const localImportError = ref('');

// 备份文件导入
const backupFilePath = ref('');
const backupFileName = ref('');
const backupDetectedFormat = ref('');
const backupPreviewPlaylists = ref<ImportedPlaylist[]>([]);
const backupImportError = ref('');

// 拖放状态
const isDragOver = ref(false);
let unlistenDragDrop: (() => void) | null = null;
let unlistenDragOver: (() => void) | null = null;
let unlistenDragLeave: (() => void) | null = null;

const tabs: { type: TabType; label: string }[] = [
  { type: 'create', label: '新建歌单' },
  { type: 'backupImport', label: '备份导入' },
  { type: 'localFolderImport', label: '本地导入' },
  { type: 'networkImport', label: '云端导入' },
];

// ==================== 拖放事件监听 ====================

/** 当前标签页是否接受拖放 */
const tabAcceptsDrag = computed(
  () => activeTab.value === 'localFolderImport' || activeTab.value === 'backupImport',
);

/** 设置拖放拦截并注册 Tauri 事件 */
async function setupDragListeners() {
  modalDragInterceptActive.value = true;

  unlistenDragDrop = await listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
    isDragOver.value = false;
    const paths = event.payload?.paths ?? [];
    if (paths.length === 0) return;
    await handleDropPaths(paths);
  });

  unlistenDragOver = await listen('tauri://drag-over', () => {
    if (tabAcceptsDrag.value) isDragOver.value = true;
  });

  unlistenDragLeave = await listen('tauri://drag-leave', () => {
    isDragOver.value = false;
  });
}

/** 移除拖放拦截和事件监听 */
function teardownDragListeners() {
  modalDragInterceptActive.value = false;
  isDragOver.value = false;
  unlistenDragDrop?.();
  unlistenDragOver?.();
  unlistenDragLeave?.();
  unlistenDragDrop = null;
  unlistenDragOver = null;
  unlistenDragLeave = null;
}

/** 处理拖放的路径，根据当前标签页分发 */
async function handleDropPaths(paths: string[]) {
  if (activeTab.value === 'backupImport') {
    // 找到第一个支持的文件
    const supportedFile = paths.find((p) => {
      const ext = p.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
      return SUPPORTED_IMPORT_EXTENSIONS.includes(ext);
    });
    if (supportedFile) {
      await loadBackupFile(supportedFile);
    } else {
      backupImportError.value = `请拖入支持的文件格式（${SUPPORTED_IMPORT_EXTENSIONS.map((e) => '.' + e).join(' / ')}）`;
    }
  } else if (activeTab.value === 'localFolderImport') {
    // 找到第一个文件夹
    for (const p of paths) {
      try {
        const isDir = await fileApi.isDirectory(p);
        if (isDir) {
          localFolderPath.value = p;
          localImportError.value = '';
          break;
        }
      } catch {
        // 忽略判断失败的路径
      }
    }
    if (!localFolderPath.value) {
      localImportError.value = '请拖入文件夹';
    }
  }
}

// ==================== 弹窗生命周期 ====================

// 弹窗打开时重置状态
watch(
  () => props.visible,
  async (val) => {
    if (val) {
      createName.value = '';
      importInput.value = '';
      importRename.value = '';
      importError.value = '';
      localPlaylistName.value = '';
      localFolderPath.value = '';
      localImportError.value = '';
      backupFilePath.value = '';
      backupFileName.value = '';
      backupDetectedFormat.value = '';
      backupPreviewPlaylists.value = [];
      backupImportError.value = '';
      importing.value = false;
      selectedSource.value = 'auto';
      sourceDropdownOpen.value = false;
      await setupDragListeners();
      await nextTick();
      focusCurrentTab();
    } else {
      isClosing.value = false;
      teardownDragListeners();
    }
  },
);

// 组件卸载时清理
onUnmounted(() => {
  teardownDragListeners();
});

// 插件变更时刷新音源列表，保留仍存在的选中项
watch(pluginsVersion, () => {
  const prevSelected = selectedSource.value;
  importSources.value = getImportSourcesFromPlugins();
  const stillExists = importSources.value.some(s => s.key === prevSelected);
  if (!stillExists && importSources.value.length > 0) {
    selectedSource.value = importSources.value[0].key;
  }
});

// 切换 tab 时聚焦对应输入框
watch(activeTab, async () => {
  await nextTick();
  focusCurrentTab();
});

const focusCurrentTab = () => {
  if (activeTab.value === 'create' && createInputRef.value) {
    createInputRef.value.focus();
  } else if (activeTab.value === 'networkImport' && importInputRef.value) {
    importInputRef.value.focus();
  } else if (activeTab.value === 'localFolderImport' && localPlaylistNameRef.value) {
    localPlaylistNameRef.value.focus();
  }
};

const handleSelectSource = (key: string) => {
  selectedSource.value = key;
  sourceDropdownOpen.value = false;
  importError.value = '';
};

/** 当前选中音源的类型（LX 直连 / MusicFree 插件） */
const currentSourceType = computed(() => {
  const src = importSources.value.find(s => s.key === selectedSource.value);
  return src?.type ?? 'lx';
});

/** 当前选中音源的显示名称 */
const selectedSourceName = computed(() => {
  const src = importSources.value.find(s => s.key === selectedSource.value);
  return src?.name ?? '自动识别';
});

/** 切换下拉列表开关 */
const toggleSourceDropdown = () => {
  sourceDropdownOpen.value = !sourceDropdownOpen.value;
};

/** 点击外部关闭下拉 */
const closeSourceDropdown = () => {
  sourceDropdownOpen.value = false;
};

const handleClose = () => {
  if (importing.value) return; // 导入中不允许关闭
  isClosing.value = true;
  setTimeout(() => {
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
};

// ==================== 文件/文件夹选择 ====================

const handleChooseLocalFolder = async () => {
  if (importing.value) return;

  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择包含音乐的文件夹',
    });
    if (typeof selected === 'string') {
      localFolderPath.value = selected;
      localImportError.value = '';
    }
  } catch (e: any) {
    localImportError.value = `选择文件夹失败: ${e?.message || e}`;
  }
};

const handleChooseBackupFile = async () => {
  if (importing.value) return;

  try {
    const selected = await open({
      multiple: false,
      title: '选择备份/播放列表文件',
      filters: [
        { name: '所有支持的格式', extensions: SUPPORTED_IMPORT_EXTENSIONS },
        { name: 'JSON 备份', extensions: ['json'] },
        { name: 'M3U 播放列表', extensions: ['m3u', 'm3u8'] },
        { name: '椒盐音乐导出', extensions: ['txt'] },
      ],
    });
    if (typeof selected === 'string') {
      await loadBackupFile(selected);
    }
  } catch (e: any) {
    backupImportError.value = `选择文件失败: ${e?.message || e}`;
  }
};

/** 加载并解析备份文件 */
async function loadBackupFile(filePath: string) {
  backupFilePath.value = filePath;
  backupFileName.value = filePath.split(/[\\/]/).pop() || filePath;
  backupImportError.value = '';
  backupPreviewPlaylists.value = [];
  backupDetectedFormat.value = '';
  importing.value = true;

  try {
    const playlists = await importBackupFile(filePath);
    backupPreviewPlaylists.value = playlists;
    const totalSongs = playlists.reduce((sum, p) => sum + p.songs.length, 0);
    backupDetectedFormat.value = `${playlists.length} 个歌单 · ${totalSongs} 首歌曲`;
  } catch (e: any) {
    backupImportError.value = `解析失败: ${e?.message || e}`;
    backupFilePath.value = '';
    backupFileName.value = '';
  } finally {
    importing.value = false;
  }
}

// ==================== 确认操作 ====================

const handleConfirm = async () => {
  if (activeTab.value === 'create') {
    if (!createName.value.trim()) return;
    isClosing.value = true;
    setTimeout(() => {
      emit('create', createName.value.trim());
      emit('update:visible', false);
      isClosing.value = false;
    }, 200);
  } else if (activeTab.value === 'networkImport') {
    if (!importInput.value.trim() || importing.value) return;
    importError.value = '';
    importing.value = true;

    try {
      // 根据来源类型选择导入方式
      const currentSource = importSources.value.find(s => s.key === selectedSource.value);
      let result: PlaylistImportResult;

      if (currentSource?.type === 'musicfree' && currentSource.pluginSource) {
        // MusicFree 插件导入：通过插件搜索歌单并获取详情
        result = await importPlaylistFromMusicFreePlugin(
          currentSource.pluginSource,
          importInput.value.trim(),
        );
      } else {
        // LX 音源导入：直接 HTTP 请求
        result = await importPlaylist(selectedSource.value, importInput.value.trim());
      }

      if (result.songs.length === 0) {
        importError.value = '导入失败或歌单为空，请检查链接是否正确';
        showToast('导入失败或歌单为空', 'error');
      } else {
        const rename = importRename.value.trim();
        showToast(`成功导入 ${result.songs.length} 首歌曲`, 'success');
        isClosing.value = true;
        setTimeout(() => {
          emit('import', {
            result,
            rename: rename.length > 0 ? rename : undefined,
          });
          emit('update:visible', false);
          isClosing.value = false;
        }, 200);
      }
    } catch (e: any) {
      importError.value = `导入失败: ${e?.message || e}`;
      showToast(`导入失败: ${e?.message || e}`, 'error');
    } finally {
      importing.value = false;
    }
  } else if (activeTab.value === 'localFolderImport') {
    const name = localPlaylistName.value.trim();
    if (!name || !localFolderPath.value || importing.value) return;

    localImportError.value = '';
    importing.value = true;
    try {
      const songs = await fileApi.parseMusicFolder(localFolderPath.value);
      if (songs.length === 0) {
        localImportError.value = '所选文件夹中未读取到支持的音乐文件';
        showToast('所选文件夹中未读取到支持的音乐文件', 'error');
        return;
      }

      showToast(`成功读取 ${songs.length} 首歌曲`, 'success');
      isClosing.value = true;
      setTimeout(() => {
        emit('import-local', { name, songs });
        emit('update:visible', false);
        isClosing.value = false;
      }, 200);
    } catch (e: any) {
      localImportError.value = `读取文件夹失败: ${e?.message || e}`;
      showToast(`读取文件夹失败: ${e?.message || e}`, 'error');
    } finally {
      importing.value = false;
    }
  } else if (activeTab.value === 'backupImport') {
    if (backupPreviewPlaylists.value.length === 0 || importing.value) return;

    const totalSongs = backupPreviewPlaylists.value.reduce(
      (sum, p) => sum + p.songs.length, 0,
    );
    showToast(
      `成功导入 ${backupPreviewPlaylists.value.length} 个歌单，共 ${totalSongs} 首歌曲`,
      'success',
    );
    isClosing.value = true;
    setTimeout(() => {
      emit('import-backup', backupPreviewPlaylists.value);
      emit('update:visible', false);
      isClosing.value = false;
    }, 200);
  }
};

const canConfirm = computed(() => {
  if (activeTab.value === 'create') return createName.value.trim().length > 0;
  if (activeTab.value === 'networkImport') {
    return importInput.value.trim().length > 0 && !importing.value;
  }
  if (activeTab.value === 'localFolderImport') {
    return localPlaylistName.value.trim().length > 0
      && localFolderPath.value.length > 0
      && !importing.value;
  }
  if (activeTab.value === 'backupImport') {
    return backupPreviewPlaylists.value.length > 0 && !importing.value;
  }
  return false;
});

const confirmText = computed(() => {
  if (activeTab.value === 'create') return '创建';
  if (activeTab.value === 'localFolderImport') {
    return importing.value ? '读取中…' : '读取并创建';
  }
  if (activeTab.value === 'backupImport') {
    return importing.value ? '解析中…' : '导入歌单';
  }
  if (importing.value) return '导入中…';
  return '导入';
});

const handleKeydown = (e: KeyboardEvent) => {
  if (!props.visible) return;
  if (e.key === 'Escape' && !importing.value) {
    handleClose();
  } else if (e.key === 'Enter' && !sourceDropdownOpen.value && !importing.value) {
    handleConfirm();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      :class="{ 'pointer-events-none': isClosing }"
    >
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- Modal Card -->
      <div
        class="relative bg-white/80 dark:bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all duration-300"
        style="transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1)"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0',
          'border border-white/20 ring-1 ring-black/5'
        ]"
      >
        <!-- Tab 头部 -->
        <div class="relative px-6 pt-5 pb-0 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-4">
            <button
              v-for="tab in tabs"
              :key="tab.type"
              type="button"
              class="relative whitespace-nowrap pb-3 text-sm font-medium transition-colors"
              :class="activeTab === tab.type
                ? 'text-[#EC4141]'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
              @click="activeTab = tab.type"
            >
              {{ tab.label }}
              <span
                class="absolute left-0 right-0 -bottom-px h-[2px] bg-[#EC4141] rounded-full transition-all duration-300 ease-out"
                :class="activeTab === tab.type ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
              ></span>
            </button>
          </div>
        </div>

        <!-- 内容区域（带过渡动画） -->
        <div class="relative px-6 py-5 min-h-[140px]">
          <Transition name="tab-fade" mode="out-in">
            <!-- 新建歌单 -->
            <div v-if="activeTab === 'create'" key="create" class="space-y-2">
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">歌单名称</label>
              <input
                ref="createInputRef"
                v-model="createName"
                type="text"
                placeholder="请输入歌单名称"
                class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm"
              />
            </div>

            <!-- 云端导入歌单 -->
            <div v-else-if="activeTab === 'networkImport'" key="network-import" class="space-y-3">
              <!-- 音源选择（下拉） -->
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">选择音源</label>
                <div class="relative">
                  <button
                    type="button"
                    :disabled="importing"
                    class="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 text-sm transition-all hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-50"
                    @click="toggleSourceDropdown"
                  >
                    <span class="text-gray-900 dark:text-white">{{ selectedSourceName }}</span>
                    <svg
                      class="w-4 h-4 text-gray-400 transition-transform duration-200"
                      :class="{ 'rotate-180': sourceDropdownOpen }"
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  <!-- 下拉列表 -->
                  <Transition name="dropdown-fade">
                    <div
                      v-if="sourceDropdownOpen"
                      class="absolute z-20 left-0 right-0 mt-1 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden max-h-60 overflow-y-auto"
                    >
                      <button
                        v-for="src in importSources"
                        :key="src.key"
                        type="button"
                        class="w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors"
                        :class="selectedSource === src.key
                          ? 'bg-red-50 dark:bg-red-500/10 text-[#EC4141] font-medium'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'"
                        @click="handleSelectSource(src.key)"
                      >
                        <span>{{ src.name }}</span>
                        <svg
                          v-if="selectedSource === src.key"
                          class="w-4 h-4"
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                    </div>
                  </Transition>

                  <!-- 点击外部关闭 -->
                  <div
                    v-if="sourceDropdownOpen"
                    class="fixed inset-0 z-10"
                    @click="closeSourceDropdown"
                  ></div>
                </div>
              </div>

              <!-- 歌单链接 -->
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">
                  {{ currentSourceType === 'musicfree' ? '歌单名称或关键词' : '歌单链接或 ID' }}
                </label>
                <input
                  ref="importInputRef"
                  v-model="importInput"
                  type="text"
                  :disabled="importing"
                  :placeholder="currentSourceType === 'musicfree'
                    ? '输入歌单名称搜索并导入'
                    : '粘贴歌单分享链接或输入歌单 ID'"
                  class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
              </div>

              <!-- 重命名 -->
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">
                  歌单重命名 <span class="text-gray-400 dark:text-gray-500 font-normal">（可选）</span>
                </label>
                <input
                  ref="importRenameRef"
                  v-model="importRename"
                  type="text"
                  :disabled="importing"
                  placeholder="导入后给歌单起个新名字"
                  class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
              </div>

              <!-- 提示文本 -->
              <div class="text-xs text-gray-400 dark:text-white/40 leading-relaxed">
                打开对应平台 App，找到想导入的歌单，点击分享并复制链接，粘贴到上方输入框即可一键导入。仅支持公开歌单。
              </div>

              <!-- 错误提示 -->
              <div
                v-if="importError"
                class="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs"
              >
                <span>{{ importError }}</span>
              </div>
            </div>

            <!-- 从本地文件夹导入歌单 -->
            <div
              v-else-if="activeTab === 'localFolderImport'"
              key="local-folder-import"
              class="space-y-4"
            >
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">
                  歌单名称 <span class="text-[#EC4141]">*</span>
                </label>
                <input
                  ref="localPlaylistNameRef"
                  v-model="localPlaylistName"
                  type="text"
                  :disabled="importing"
                  placeholder="请输入新歌单名称"
                  class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
              </div>

              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">
                  音乐文件夹 <span class="text-[#EC4141]">*</span>
                </label>
                <!-- 可拖入、可点击的选区 -->
                <button
                  type="button"
                  :disabled="importing"
                  class="drop-zone"
                  :class="{
                    'drop-zone--active': isDragOver,
                    'drop-zone--filled': localFolderPath.length > 0,
                  }"
                  @click="handleChooseLocalFolder"
                >
                  <div class="drop-zone-inner">
                    <FolderOpen v-if="localFolderPath" class="drop-zone-icon drop-zone-icon--filled" />
                    <FolderOpen v-else class="drop-zone-icon" />
                    <p v-if="localFolderPath" class="drop-zone-text filled-text">
                      {{ localFolderPath.split(/[\\/]/).pop() || localFolderPath }}
                    </p>
                    <p v-else class="drop-zone-text">
                      点击选择文件夹，或拖入文件夹
                    </p>
                  </div>
                </button>
              </div>

              <p class="text-xs leading-relaxed text-gray-400 dark:text-white/40">
                将递归读取所选文件夹及其子文件夹中的音乐文件，并创建为一个独立歌单。
              </p>

              <div
                v-if="localImportError"
                class="flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400"
              >
                <span>{{ localImportError }}</span>
              </div>
            </div>

            <!-- 备份文件导入歌单 -->
            <div
              v-else-if="activeTab === 'backupImport'"
              key="backup-import"
              class="space-y-4"
            >
              <div class="space-y-1.5">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">
                  备份/播放列表文件 <span class="text-[#EC4141]">*</span>
                </label>
                <!-- 可拖入、可点击的选区（复用本地导入样式） -->
                <button
                  type="button"
                  :disabled="importing"
                  class="drop-zone"
                  :class="{
                    'drop-zone--active': isDragOver,
                    'drop-zone--filled': backupFilePath.length > 0,
                  }"
                  @click="handleChooseBackupFile"
                >
                  <div class="drop-zone-inner">
                    <FileJson v-if="backupFilePath" class="drop-zone-icon drop-zone-icon--filled" />
                    <FileUp v-else class="drop-zone-icon" />
                    <p v-if="backupFilePath" class="drop-zone-text filled-text">
                      {{ backupFileName }}
                    </p>
                    <p v-else class="drop-zone-text">
                      点击选择文件，或拖入 .json / .m3u / .m3u8 / .txt 文件
                    </p>
                  </div>
                </button>
              </div>

              <!-- 预览信息 -->
              <div
                v-if="backupPreviewPlaylists.length > 0"
                class="space-y-2"
              >
                <div class="flex items-center gap-2 text-xs font-medium text-green-600 dark:text-green-400">
                  <FileJson class="h-4 w-4" />
                  {{ backupDetectedFormat }}
                </div>
                <div class="max-h-32 overflow-y-auto space-y-1.5 rounded-xl bg-gray-50 dark:bg-black/20 p-2.5">
                  <div
                    v-for="(pl, idx) in backupPreviewPlaylists"
                    :key="idx"
                    class="flex items-center justify-between text-xs"
                  >
                    <span class="truncate text-gray-700 dark:text-gray-300">{{ pl.name }}</span>
                    <span class="shrink-0 text-gray-400 dark:text-gray-500">{{ pl.songs.length }} 首</span>
                  </div>
                </div>
              </div>

              <p class="text-xs leading-relaxed text-gray-400 dark:text-white/40">
                支持 BakaMusic / MusicFree JSON 备份、M3U / M3U8 播放列表、椒盐音乐导出格式，自动识别并导入。M3U 和椒盐格式从文件名或 EXTINF 提取歌曲信息。
              </p>

              <div
                v-if="backupImportError"
                class="flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400"
              >
                <span>{{ backupImportError }}</span>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Footer -->
        <div class="px-4 py-3 bg-gray-50/50 dark:bg-white/5 flex gap-3 flex-col sm:flex-row-reverse">
          <button
            @click="handleConfirm"
            :disabled="!canConfirm"
            class="w-full inline-flex justify-center items-center gap-2 rounded-xl border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#EC4141] sm:text-sm transition-all duration-200 bg-[#EC4141] hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Loader2 v-if="importing" class="h-4 w-4 animate-spin" />
            {{ confirmText }}
          </button>
          <button
            @click="handleClose"
            :disabled="importing"
            class="w-full inline-flex justify-center rounded-xl border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:text-sm transition-all duration-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Tab 内容切换动画 */
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.tab-fade-enter-from {
  opacity: 0;
  transform: translateX(8px);
}
.tab-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

/* 下拉列表动画 */
.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dropdown-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ==================== 共享拖放区域样式 ==================== */
.drop-zone {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 4px;
  border: 2px dashed rgb(209 213 219); /* gray-300 */
  border-radius: 12px;
  background: rgb(249 250 251); /* gray-50 */
  color: inherit;
  cursor: pointer;
  font: inherit;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
}

.drop-zone:hover:not(:disabled) {
  border-color: rgb(156 163 175); /* gray-400 */
  background: rgb(243 244 246); /* gray-100 */
  transform: translateY(-1px);
}

.drop-zone--active {
  border-color: #EC4141;
  background: rgba(236, 65, 65, 0.05);
  transform: scale(1.01);
}

.drop-zone--filled {
  border-style: solid;
  border-color: rgb(34 197 94); /* green-500 */
  background: rgba(34, 197, 94, 0.04);
}

.drop-zone--filled:hover:not(:disabled) {
  border-color: rgb(22 163 74); /* green-600 */
  background: rgba(34, 197, 94, 0.08);
}

.drop-zone:disabled {
  cursor: not-allowed;
  opacity: 0.62;
  transform: none;
}

.drop-zone-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 0 16px;
}

.drop-zone-icon {
  width: 28px;
  height: 28px;
  color: rgb(156 163 175); /* gray-400 */
  opacity: 0.7;
  margin-bottom: 8px;
  transition: color 0.2s ease;
}

.drop-zone--active .drop-zone-icon {
  color: #EC4141;
  opacity: 1;
}

.drop-zone-icon--filled {
  color: rgb(34 197 94); /* green-500 */
  opacity: 1;
}

.drop-zone-text {
  font-size: 0.8125rem; /* text-sm */
  color: rgb(156 163 175); /* gray-400 */
  margin: 0;
  text-align: center;
  transition: color 0.2s ease;
}

.drop-zone--active .drop-zone-text {
  color: #EC4141;
}

.drop-zone-text.filled-text {
  color: rgb(55 65 81); /* gray-700 */
  font-weight: 500;
  word-break: break-all;
}

/* 暗色模式 */
:global(.dark) .drop-zone {
  border-color: rgb(55 65 81); /* gray-700 */
  background: rgba(0, 0, 0, 0.2);
}

:global(.dark) .drop-zone:hover:not(:disabled) {
  border-color: rgb(75 85 99); /* gray-600 */
  background: rgba(255, 255, 255, 0.05);
}

:global(.dark) .drop-zone-text.filled-text {
  color: rgb(229 231 235); /* gray-200 */
}

:global(.dark) .drop-zone-text {
  color: rgb(156 163 175);
}
</style>
