<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';

import { usePlayer } from '../../features/playback';
import { useToast } from '../../composables/toast';
import { dragSession } from '../../composables/dragState';
import { useLibraryFolderSongPathCache } from '../../composables/useLibraryFolderSongPathCache';
import { useListScrollMemory } from '../../composables/useListScrollMemory';
import type { FolderNode, Song } from '../../types';
import FolderTreeItem from '../common/FolderTreeItem.vue';
import ModernInputModal from '../common/ModernInputModal.vue';
import ModernModal from '../common/ModernModal.vue';
import FolderContextMenu from '../overlays/FolderContextMenu.vue';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { normalizePath } from '../../utils/path';

/**
 * 曲库侧栏：文件夹树 + 目录右键菜单 + 移动/删除/新建确认弹窗 + 可拖拽调宽。
 * 桌面端独立实现，对外行为与旧版保持一致。
 */

const props = withDefaults(defineProps<{
  isManagementMode?: boolean;
}>(), {
  isManagementMode: false,
});

// usePlayer 返回的上下文一次性展开
const playerCtx = usePlayer();
const {
  folderTree, activeRootPath, currentFolderFilter, currentViewMode, searchQuery,
  folderSortMode, folderCustomOrder, songLookup, fetchFolderTree, toggleFolderNode,
  expandFolderPath, refreshFolder, removeLibraryFolder, deleteFolder, moveFilesToFolder,
  getSongsInFolder, playSong, addSongsToQueue, openInFinder, createPlaylist, createFolder,
} = playerCtx;

const toast = useToast();
// 统一的轻提示出口，便于集中管理文案与级别
const notify = (text: string, kind: 'success' | 'error' | 'info') => toast.showToast(text, kind);
const { loadFolderViewSongPaths } = useLibraryFolderSongPathCache();

// ---- 侧栏宽度拖拽状态 ----
const panelWidth = ref(240);
const resizingNow = ref(false);
const treeScrollEl = ref<HTMLElement | null>(null);
let dragStartX = 0;
let baseWidth = 0;

// ---- 目录右键菜单状态 ----
const menuOpen = ref(false);
const menuPosX = ref(0);
const menuPosY = ref(0);
const menuFolder = ref<{ name: string; path: string } | null>(null);

// ---- 新建文件夹弹窗 ----
const createModalOpen = ref(false);
const createParentPath = ref('');

// ---- 永久删除确认弹窗 ----
const wipeModalOpen = ref(false);
const wipeTargetPath = ref<string | null>(null);

// ---- 移动文件确认弹窗 ----
const moveModalOpen = ref(false);
const moveCandidatePaths = ref<string[]>([]);
const moveTargetFolder = ref<{ name: string; path: string } | null>(null);
// 点击树节点后紧接着会改 currentFolderFilter，用它跳过一次展开副作用
let suppressNextExpand = false;

// 直接展示整棵根树
const shownNodes = computed(() => folderTree.value);

// 找到包含给定路径的库根目录（取最长前缀命中）
const findEnclosingRoot = (raw: string): string | null => {
  const target = normalizePath(raw);
  const hits = folderTree.value.filter((node) => {
    const base = normalizePath(node.path);
    return target === base || target.startsWith(`${base}/`);
  });
  hits.sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length);
  return hits[0]?.path ?? null;
};

// 让激活根目录对齐到指定路径所属的根
const alignActiveRoot = (raw: string) => {
  const root = findEnclosingRoot(raw);
  if (root) {
    activeRootPath.value = root;
  }
};

// 右键目标是否本身就是库根目录
const menuFolderIsRoot = computed(() => {
  if (!menuFolder.value) {
    return false;
  }
  return folderTree.value.some(
    node => normalizePath(node.path) === normalizePath(menuFolder.value?.path ?? ''),
  );
});

const treeMemoryKey = computed(() => 'master-panel-tree');

const {
  restoreScrollPosition: regainTreeScroll,
} = useListScrollMemory(treeMemoryKey, treeScrollEl);

// 树数据变化时兜底选中项
watch(
  folderTree,
  (nodes) => {
    if (nodes.length === 0) {
      activeRootPath.value = null;
      return;
    }

    const known = nodes.some(node => node.path === activeRootPath.value);
    if (!activeRootPath.value || !known) {
      activeRootPath.value = findEnclosingRoot(currentFolderFilter.value) || nodes[0].path;
    }

    if (!currentFolderFilter.value) {
      currentFolderFilter.value = activeRootPath.value;
    }
  },
  { immediate: true },
);

// 选中目录变化（非树节点点击引发）时展开对应路径
watch(currentFolderFilter, async newPath => {
  if (!newPath) {
    return;
  }

  if (suppressNextExpand) {
    suppressNextExpand = false;
    return;
  }

  try {
    await expandFolderPath(newPath);
  } catch (error) {
    console.error('Failed to expand folder path:', error);
  }
});

// 进入/激活面板时恢复树的展开态与滚动位置
const resumeFolderView = async () => {
  if (folderTree.value.length === 0) {
    await fetchFolderTree();
  }

  const restorePath = currentFolderFilter.value || activeRootPath.value || '';
  if (!restorePath) {
    return;
  }

  try {
    await expandFolderPath(restorePath);
    await nextTick();
    await regainTreeScroll();
    await nextTick();

    // 把当前选中的目录节点滚回可视区
    const hit = Array.from(
      treeScrollEl.value?.querySelectorAll<HTMLElement>('[data-folder-path]') ?? [],
    ).find(el => el.dataset.folderPath === currentFolderFilter.value);

    hit?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    });
  } catch (error) {
    console.error('Failed to restore folder tree state:', error);
  }
};

// ---- 树节点事件 ----
const onTreeNodeSelect = (node: FolderNode) => {
  suppressNextExpand = true;
  alignActiveRoot(node.path);
  currentFolderFilter.value = node.path;
};

const onTreeNodeToggle = async (node: FolderNode) => {
  alignActiveRoot(node.path);
  await toggleFolderNode(node);
};

const onTreeNodeMenu = ({ event, node }: { event: MouseEvent; node: FolderNode }) => {
  suppressNextExpand = true;
  alignActiveRoot(node.path);
  currentFolderFilter.value = node.path;
  menuFolder.value = { name: node.name, path: node.path };
  menuPosX.value = event.clientX;
  menuPosY.value = event.clientY;
  menuOpen.value = true;
};

const onMenuCancel = () => {
  menuOpen.value = false;
};

// ---- 目录刷新 ----
const onMenuRefresh = async () => {
  const folder = menuFolder.value;
  if (!folder) {
    return;
  }

  try {
    const summary = await refreshFolder(folder.path);
    if (summary && typeof summary === 'object' && 'removedCount' in summary) {
      const gone = Number(summary.removedCount) || 0;
      notify(gone > 0 ? `刷新成功，检测到少了 ${gone} 首歌曲` : '刷新成功', 'success');
    } else {
      notify('刷新成功', 'success');
    }
  } catch (error) {
    notify(`刷新失败: ${error}`, 'error');
  } finally {
    menuOpen.value = false;
  }
};

// ---- 目录内歌曲集合（供播放/入队/建歌单使用） ----
const pathHitsQuery = (p: string, needle: string) => {
  const song = songLookup.value.get(p);
  if (!song) {
    return false;
  }

  const kw = needle.trim().toLowerCase();
  if (!kw) {
    return true;
  }

  const inName = song.name.toLowerCase().includes(kw);
  const inTitle = (song.title || '').toLowerCase().includes(kw);
  const inArtist = song.artist.toLowerCase().includes(kw);
  const inAlbum = song.album.toLowerCase().includes(kw);
  const inPath = p.toLowerCase().includes(kw);
  const inArtists = song.artist_names.some(name => name.toLowerCase().includes(kw));
  const inEffective = song.effective_artist_names.some(name => name.toLowerCase().includes(kw));
  return inName || inTitle || inArtist || inAlbum || inPath || inArtists || inEffective;
};

const collectFolderSongs = async (folderPath: string): Promise<Song[]> => {
  if (!folderPath) {
    return [];
  }

  // 非文件夹视图直接取目录全部歌曲
  if (currentViewMode.value !== 'folder') {
    return getSongsInFolder(folderPath);
  }

  // 非自定义排序：走缓存里的既定顺序
  if (folderSortMode.value !== 'custom') {
    const ordered = await loadFolderViewSongPaths({
      folderPath,
      query: searchQuery.value,
      sortMode: folderSortMode.value,
    });
    return ordered
      .map(p => songLookup.value.get(p))
      .filter((song): song is Song => !!song);
  }

  // 自定义排序：过滤后按用户拖拽顺序重排
  let pool = getSongsInFolder(folderPath);
  const kw = searchQuery.value.trim();
  if (kw) {
    pool = pool.filter(song => pathHitsQuery(song.path, kw));
  }

  const orderList = folderCustomOrder.value[folderPath] || [];
  if (orderList.length > 0) {
    const rank = new Map(orderList.map((p, i) => [p, i]));
    const SENTINEL = Number.MAX_SAFE_INTEGER;
    pool = [...pool].sort((a, b) =>
      (rank.has(a.path) ? rank.get(a.path)! : SENTINEL)
      - (rank.has(b.path) ? rank.get(b.path)! : SENTINEL));
  }

  return pool;
};

// ---- 菜单动作 ----
const onMenuPlay = async () => {
  const folder = menuFolder.value;
  if (!folder) {
    return;
  }

  const songs = await collectFolderSongs(folder.path);
  if (songs.length > 0) {
    await playSong(songs[0]);
    currentFolderFilter.value = folder.path;
  }

  menuOpen.value = false;
};

const onMenuQueue = async () => {
  const folder = menuFolder.value;
  if (!folder) {
    return;
  }

  addSongsToQueue(await collectFolderSongs(folder.path));
  menuOpen.value = false;
};

const onMenuMakePlaylist = async () => {
  const folder = menuFolder.value;
  if (!folder) {
    return;
  }

  const songs = await collectFolderSongs(folder.path);
  if (songs.length > 0) {
    createPlaylist(folder.name, songs.map(song => song.path));
    notify('Playlist created from folder', 'success');
  } else {
    notify('No songs found in folder', 'info');
  }

  menuOpen.value = false;
};

const onMenuToPlaylist = async () => {
  const folder = menuFolder.value;
  if (!folder) {
    return;
  }

  const songs = await collectFolderSongs(folder.path);
  if (songs.length > 0) {
    const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
    openAddToPlaylistDialog(songs.map(song => song.path));
  } else {
    notify('No songs found in folder', 'info');
  }

  menuOpen.value = false;
};

const onMenuOpenFolder = () => {
  const folder = menuFolder.value;
  if (!folder) {
    return;
  }

  openInFinder(folder.path);
  menuOpen.value = false;
};

const onMenuRemove = async () => {
  const folder = menuFolder.value;
  if (!folder) {
    return;
  }

  const targetPath = folder.path;
  const isRoot = folderTree.value.some(node => normalizePath(node.path) === normalizePath(targetPath));
  if (!isRoot) {
    notify('Only library root folders can be removed from the library list', 'info');
    menuOpen.value = false;
    return;
  }

  try {
    await removeLibraryFolder(targetPath);
    menuOpen.value = false;
  } catch (error) {
    notify(`Remove failed: ${error}`, 'error');
  }
};

const onMenuNewFolder = () => {
  if (!props.isManagementMode || !menuFolder.value) {
    return;
  }

  createParentPath.value = menuFolder.value.path;
  createModalOpen.value = true;
  menuOpen.value = false;
};

const commitCreateFolder = async (folderName: string) => {
  if (!createParentPath.value) {
    return;
  }

  try {
    const newFolderPath = await createFolder(createParentPath.value, folderName);
    await fetchFolderTree();
    await expandFolderPath(newFolderPath);
    currentFolderFilter.value = newFolderPath;
    notify(`Created folder: ${folderName}`, 'success');
  } catch (error) {
    notify(`Failed to create folder: ${error}`, 'error');
  } finally {
    createModalOpen.value = false;
    createParentPath.value = '';
  }
};

const onMenuWipe = () => {
  if (!props.isManagementMode || !menuFolder.value) {
    return;
  }

  wipeTargetPath.value = menuFolder.value.path;
  wipeModalOpen.value = true;
  menuOpen.value = false;
};

// 物理删除后选择一个合理的回退目录
const pickWipeFallback = (deletedPath: string, rootPath: string): string => {
  const parentPath = deletedPath.replace(/[\\/][^\\/]+$/, '');
  const normalizedRoot = normalizePath(rootPath);
  const normalizedParent = normalizePath(parentPath);
  return normalizedRoot && normalizedParent.startsWith(normalizedRoot)
    ? parentPath
    : rootPath;
};

const commitWipeFolder = async () => {
  if (!wipeTargetPath.value) {
    return;
  }

  try {
    const deletedPath = wipeTargetPath.value;
    const rootPath = activeRootPath.value || '';
    const currentNorm = normalizePath(currentFolderFilter.value);
    const deletedNorm = normalizePath(deletedPath);
    // 当前选中目录正好被删除（或位于其内部）时才需要重选
    const needReroute = currentNorm === deletedNorm || currentNorm.startsWith(`${deletedNorm}/`);
    const fallbackPath = needReroute
      ? pickWipeFallback(deletedPath, rootPath)
      : currentFolderFilter.value;

    await deleteFolder(deletedPath);
    await fetchFolderTree();

    if (fallbackPath) {
      await expandFolderPath(fallbackPath);
      currentFolderFilter.value = fallbackPath;
    }

    notify('Folder deleted permanently', 'success');
  } catch (error) {
    notify(`Delete failed: ${error}`, 'error');
  } finally {
    wipeModalOpen.value = false;
    wipeTargetPath.value = null;
  }
};

// ---- 拖拽移动到目录 ----
const onCustomDrop = () => {
  if (!props.isManagementMode) {
    return;
  }

  const dropFolder = dragSession.targetFolder;
  if (!dropFolder || dropFolder.path === currentFolderFilter.value) {
    return;
  }

  const droppedSongs = dragSession.songs && dragSession.songs.length > 0
    ? dragSession.songs
    : (dragSession.data ? [dragSession.data] : []);

  if (droppedSongs.length === 0) {
    return;
  }

  moveCandidatePaths.value = droppedSongs.map(song => song.path);
  moveTargetFolder.value = { ...dropFolder };
  moveModalOpen.value = true;
};

// 清空移动弹窗与拖拽会话
const clearMoveDraft = () => {
  moveCandidatePaths.value = [];
  moveModalOpen.value = false;
  moveTargetFolder.value = null;
  dragSession.showGhost = false;
  dragSession.active = false;
  dragSession.targetFolder = null;
  dragSession.songs = [];
};

const commitMove = async () => {
  if (!moveTargetFolder.value || moveCandidatePaths.value.length === 0) {
    clearMoveDraft();
    return;
  }

  try {
    await moveFilesToFolder(moveCandidatePaths.value, moveTargetFolder.value.path);
    notify('Files moved successfully', 'success');
  } catch (error) {
    notify(`Move failed: ${error}`, 'error');
  } finally {
    clearMoveDraft();
  }
};

const abortMove = () => {
  clearMoveDraft();
};

// ---- 侧栏宽度拖拽 ----
const beginDragResize = (event: MouseEvent) => {
  resizingNow.value = true;
  dragStartX = event.clientX;
  baseWidth = panelWidth.value;
  document.addEventListener('mousemove', trackDragResize);
  document.addEventListener('mouseup', endDragResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

const trackDragResize = (event: MouseEvent) => {
  if (!resizingNow.value) {
    return;
  }

  const delta = event.clientX - dragStartX;
  panelWidth.value = Math.max(150, Math.min(500, baseWidth + delta));
};

const endDragResize = () => {
  resizingNow.value = false;
  document.removeEventListener('mousemove', trackDragResize);
  document.removeEventListener('mouseup', endDragResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};

onMounted(async () => {
  window.addEventListener('custom-drop-trigger', onCustomDrop);
  await resumeFolderView();
});

onActivated(async () => {
  await resumeFolderView();
});

onUnmounted(() => {
  window.removeEventListener('custom-drop-trigger', onCustomDrop);
  endDragResize();
});
</script>

<template>
  <aside
    class="relative h-full min-w-0 max-w-[40%] shrink-0 select-none border-r border-white/10 bg-transparent group/sidebar"
    :style="{ width: `${panelWidth}px` }"
  >
    <!-- 拖宽热区 -->
    <div
      class="absolute right-0 top-0 z-10 w-1 h-full cursor-col-resize transition-colors hover:bg-[#EC4141]"
      :class="{ 'bg-[#EC4141]': resizingNow }"
      @mousedown="beginDragResize"
    ></div>

    <div class="h-full overflow-y-auto custom-scrollbar">
      <div class="flex flex-col h-full bg-transparent">
        <div ref="treeScrollEl" class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4 space-y-0.5 mt-1">
          <div v-if="shownNodes.length > 0">
            <FolderTreeItem
              v-for="node in shownNodes"
              :key="node.path"
              :node="node"
              :depth="0"
              :isRoot="true"
              :selectedPath="currentFolderFilter"
              @toggle="onTreeNodeToggle"
              @contextmenu="onTreeNodeMenu"
              @select="onTreeNodeSelect"
            />
          </div>

          <div
            class="flex flex-col items-center justify-center py-10 text-gray-400 space-y-2 dark:text-gray-500"
            v-if="folderTree.length === 0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-8 w-8 opacity-50" fill="none" stroke="currentColor"><path d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 00-2-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" /></svg>
            <span :class="'text-xs'">还没有添加音乐库文件夹。</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 目录右键菜单 -->
    <FolderContextMenu
      :visible="menuOpen"
      :x="menuPosX"
      :y="menuPosY"
      :folder-path="menuFolder?.path || ''"
      :selected-count="1"
      :is-root-folder="menuFolderIsRoot"
      :isManagementMode="isManagementMode"
      @play="onMenuPlay"
      @add-to-queue="onMenuQueue"
      @create-playlist="onMenuMakePlaylist"
      @add-to-playlist="onMenuToPlaylist"
      @open-folder="onMenuOpenFolder"
      @refresh="onMenuRefresh"
      @remove="onMenuRemove"
      @new-folder="onMenuNewFolder"
      @delete-disk="onMenuWipe"
      @close="menuOpen = false"
      @cancel="onMenuCancel"
    />

    <!-- 移动文件确认 -->
    <ModernModal
      v-model:visible="moveModalOpen"
      :title="'Move Files'"
      :content="`Move ${moveCandidatePaths.length} file(s) to folder '${moveTargetFolder?.name}'?`"
      @cancel="abortMove"
      @confirm="commitMove"
    />

    <!-- 永久删除确认 -->
    <ModernModal
      v-model:visible="wipeModalOpen"
      :title="'永久删除文件夹'"
      :content="`确定要永久删除文件夹 '${wipeTargetPath}' 吗？此操作不可逆！`"
      :type="'danger'"
      :confirm-text="'永久删除'"
      @confirm="commitWipeFolder"
      @cancel="wipeModalOpen = false"
    />

    <!-- 新建文件夹 -->
    <ModernInputModal
      :visible="createModalOpen"
      :title="'新建文件夹'"
      :placeholder="'请输入文件夹名称'"
      :confirm-text="'创建'"
      @cancel="createModalOpen = false"
      @confirm="commitCreateFolder"
    />
  </aside>
</template>
