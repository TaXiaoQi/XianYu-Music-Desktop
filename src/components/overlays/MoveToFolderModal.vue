<script setup lang="ts">
// 「移动歌曲到文件夹」选择弹窗：目录选项收集、封面懒加载与延迟清理
import { computed, onUnmounted, ref, watch } from 'vue';

import { usePlayerLibraryView } from '../../features/library/usePlayerLibraryView';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useCoverCache } from '../../composables/useCoverCache';
import type { FolderNode } from '../../types';

const props = defineProps<{
  selectedCount: number;
  visible: boolean;
}>();

const emit = defineEmits(['confirm', 'close']);

type FolderChoice = {
  dirPath: string;
  dirName: string;
  songTotal: number;
  sampleSongPath: string;
};

const { folderList: libraryFolders, libraryHierarchy: hierarchyTree } = usePlayerLibraryView();
const { activeRootPath: focusedRoot, currentViewMode: viewMode } = usePlayerViewState();
const { loadCover: resolveCover } = useCoverCache();

const coverByFolder = ref<Map<string, string>>(new Map());
let purgeTimer: number | null = null;

const dropCoverEntries = () => {
  coverByFolder.value.clear();
};

const stopPurgeTimer = () => {
  if (purgeTimer !== null) {
    window.clearTimeout(purgeTimer);
    purgeTimer = null;
  }
};

// 弹窗关闭 15 秒后统一回收封面位图
const armPurgeTimer = () => {
  stopPurgeTimer();
  purgeTimer = window.setTimeout(() => {
    dropCoverEntries();
    purgeTimer = null;
  }, 15000);
};

// 深度优先展开目录树为平铺选项
const collectChoices = (node: FolderNode, bucket: FolderChoice[]) => {
  bucket.push({
    dirPath: node.path,
    dirName: node.name,
    songTotal: node.song_count,
    sampleSongPath: node.cover_song_path || '',
  });

  node.children.forEach((child) => collectChoices(child, bucket));
};

// 文件夹视图且选中了根目录时只展示该根目录的子树，否则回退到全量目录
const folderChoices = computed<FolderChoice[]>(() => {
  const rootedInFolderView = viewMode.value === 'folder' && !!focusedRoot.value;

  if (rootedInFolderView) {
    const rootNode = hierarchyTree.value.find((node) => node.path === focusedRoot.value);
    if (rootNode) {
      const bucket: FolderChoice[] = [];
      collectChoices(rootNode, bucket);
      return bucket;
    }
  }

  return libraryFolders.value.map((folder) => ({
    dirPath: folder.path,
    dirName: folder.name,
    songTotal: folder.count,
    sampleSongPath: folder.firstSongPath || '',
  }));
});

const fetchFolderCover = async (dirPath: string, sampleSongPath: string) => {
  if (!sampleSongPath || coverByFolder.value.has(dirPath)) return;

  try {
    const resolved = await resolveCover(sampleSongPath);
    if (resolved && props.visible) {
      coverByFolder.value.set(dirPath, resolved);
    }
  } catch {
    coverByFolder.value.delete(dirPath);
  }
};

watch(() => props.visible, (shown) => {
  if (!shown) {
    armPurgeTimer();
    return;
  }

  stopPurgeTimer();
  folderChoices.value.forEach((choice) => {
    if (choice.sampleSongPath) {
      void fetchFolderCover(choice.dirPath, choice.sampleSongPath);
    }
  });
});

onUnmounted(() => {
  stopPurgeTimer();
  dropCoverEntries();
});

const dialogTitle = computed(() => `移动 ${props.selectedCount} 首歌曲到文件夹`);
const emptyFolderHint = '当前根目录下暂无可选文件夹';

const dismiss = () => emit('close');
const chooseFolder = (choice: FolderChoice) => emit('confirm', choice.dirPath, choice.dirName);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[9999] flex justify-center items-center bg-black/30 backdrop-blur-sm"
      @click.self="dismiss"
    >
      <div class="bg-white/80 dark:bg-gray-900/90 rounded-xl shadow-2xl w-80 overflow-hidden animate-in fade-in zoom-in duration-200">
        <div class="flex justify-between items-center px-4 py-3 border-b border-gray-100 dark:border-white/10">
          <h3 class="font-bold text-gray-800 dark:text-white text-sm">{{ dialogTitle }}</h3>
          <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" @click="dismiss">×</button>
        </div>

        <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
          <div v-if="folderChoices.length === 0" class="text-center py-4 text-gray-400 text-sm">
            {{ emptyFolderHint }}
          </div>

          <div
            v-for="choice in folderChoices"
            :key="choice.dirPath"
            class="flex items-center p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer"
            @click="chooseFolder(choice)"
          >
            <div class="w-10 h-10 bg-blue-50 dark:bg-blue-500/10 rounded flex items-center justify-center mr-3 overflow-hidden border border-blue-100 dark:border-blue-400/10">
              <img v-if="coverByFolder.get(choice.dirPath)" :src="coverByFolder.get(choice.dirPath)" decoding="async" loading="lazy" class="w-full h-full object-cover" />
              <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5 text-blue-300"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
            </div>

            <div class="min-w-0 flex-1">
              <div class="text-sm text-gray-800 dark:text-white truncate" :title="choice.dirPath">{{ choice.dirName }}</div>
              <div class="text-xs text-gray-400 truncate">{{ choice.dirPath }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
