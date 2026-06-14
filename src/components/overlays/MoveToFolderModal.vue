<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';

import { usePlayerLibraryView } from '../../features/library/usePlayerLibraryView';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useCoverCache } from '../../composables/useCoverCache';
import type { FolderNode } from '../../types';

const props = defineProps<{
  visible: boolean;
  selectedCount: number;
}>();

const emit = defineEmits(['close', 'confirm']);

type MoveFolderOption = {
  path: string;
  name: string;
  count: number;
  firstSongPath: string;
};

const { folderList, libraryHierarchy } = usePlayerLibraryView();
const { activeRootPath, currentViewMode } = usePlayerViewState();
const folderCoverCache = ref<Map<string, string>>(new Map());
let clearTimer: number | null = null;
const { loadCover } = useCoverCache();

const clearCoverCache = () => {
  folderCoverCache.value.clear();
};

const cancelClearTimer = () => {
  if (clearTimer !== null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }
};

const scheduleClear = () => {
  cancelClearTimer();
  clearTimer = window.setTimeout(() => {
    clearCoverCache();
    clearTimer = null;
  }, 15000);
};

const flattenFolderTree = (node: FolderNode, result: MoveFolderOption[]) => {
  result.push({
    path: node.path,
    name: node.name,
    count: node.song_count,
    firstSongPath: node.cover_song_path || '',
  });

  node.children.forEach(child => flattenFolderTree(child, result));
};

const availableFolders = computed<MoveFolderOption[]>(() => {
  if (currentViewMode.value === 'folder' && activeRootPath.value) {
    const rootNode = libraryHierarchy.value.find(node => node.path === activeRootPath.value);
    if (rootNode) {
      const result: MoveFolderOption[] = [];
      flattenFolderTree(rootNode, result);
      return result;
    }
  }

  return folderList.value.map(folder => ({
    path: folder.path,
    name: folder.name,
    count: folder.count,
    firstSongPath: folder.firstSongPath || '',
  }));
});

const loadFolderCover = async (path: string, firstSongPath: string) => {
  if (!firstSongPath || folderCoverCache.value.has(path)) return;

  try {
    const coverUrl = await loadCover(firstSongPath);
    if (coverUrl && props.visible) {
      folderCoverCache.value.set(path, coverUrl);
    }
  } catch {
    folderCoverCache.value.delete(path);
  }
};

watch(() => props.visible, val => {
  if (val) {
    cancelClearTimer();
    availableFolders.value.forEach(folder => {
      if (folder.firstSongPath) {
        void loadFolderCover(folder.path, folder.firstSongPath);
      }
    });
    return;
  }

  scheduleClear();
});

onUnmounted(() => {
  cancelClearTimer();
  clearCoverCache();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div class="bg-white rounded-xl shadow-2xl w-80 overflow-hidden animate-in fade-in zoom-in duration-200 dark:bg-[#202020]">
        <div class="px-4 py-3 border-b border-gray-100 dark:border-white/10 flex justify-between items-center">
          <h3 class="font-bold text-gray-800 dark:text-white text-sm">移动 {{ selectedCount }} 首歌曲到文件夹</h3>
          <button @click="emit('close')" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">×</button>
        </div>

        <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
          <div v-if="availableFolders.length === 0" class="text-center py-4 text-gray-400 text-sm">
            当前根目录下暂无可选文件夹
          </div>

          <div
            v-for="folder in availableFolders"
            :key="folder.path"
            @click="emit('confirm', folder.path, folder.name)"
            class="flex items-center p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer"
          >
            <div class="w-10 h-10 bg-blue-50 dark:bg-blue-500/10 rounded flex items-center justify-center mr-3 overflow-hidden border border-blue-100 dark:border-blue-400/10">
              <img v-if="folderCoverCache.get(folder.path)" :src="folderCoverCache.get(folder.path)" class="w-full h-full object-cover" />
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-300" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
            </div>

            <div class="flex-1 min-w-0">
              <div class="text-sm text-gray-800 dark:text-white truncate" :title="folder.path">{{ folder.name }}</div>
              <div class="text-xs text-gray-400 truncate">{{ folder.path }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
