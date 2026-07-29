<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue';
import { Download, X, Check, Loader2, Music, AlertCircle } from 'lucide-vue-next';
import type { PluginSource, PluginSearchResult, Song } from '../../types';
import { pluginImportMusicSheet, getPluginImportHints } from '../../services/pluginEngine';
import { useToast } from '../../composables/toast';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { useLibraryStore } from '../../features/library/store';

const props = defineProps<{
  visible: boolean;
  plugin: PluginSource | null;
}>();

const emit = defineEmits(['close', 'update:visible']);

const { showToast } = useToast();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const libraryStore = useLibraryStore();

// ==================== 状态 ====================
const urlInput = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importError = ref('');
const importedSongs = ref<PluginSearchResult[]>([]);
const selectedIds = ref<Set<string>>(new Set());
const hints = ref<string[]>([]);
const isClosing = ref(false);

// ==================== 计算属性 ====================
const hasResults = computed(() => importedSongs.value.length > 0);
const selectedCount = computed(() => selectedIds.value.size);
const allSelected = computed(() =>
  importedSongs.value.length > 0 && selectedIds.value.size === importedSongs.value.length,
);
const pluginName = computed(() => props.plugin?.name ?? '');

// ==================== 监听 ====================
watch(
  () => props.visible,
  async (val) => {
    if (val) {
      // 重置状态
      urlInput.value = '';
      importing.value = false;
      importError.value = '';
      importedSongs.value = [];
      selectedIds.value = new Set();
      hints.value = [];

      // 加载提示
      if (props.plugin) {
        try {
          hints.value = await getPluginImportHints(props.plugin);
        } catch {
          /* ignore */
        }
      }

      await nextTick();
      if (inputRef.value) inputRef.value.focus();
    }
  },
);

// ==================== 方法 ====================
function handleClose() {
  if (importing.value) return; // 导入中不允许关闭
  isClosing.value = true;
  setTimeout(() => {
    emit('close');
    emit('update:visible', false);
    isClosing.value = false;
  }, 200);
}

async function handleImport() {
  if (!props.plugin) return;
  const url = urlInput.value.trim();
  if (!url) {
    showToast('请输入歌单链接', 'error');
    return;
  }

  importing.value = true;
  importError.value = '';
  importedSongs.value = [];
  selectedIds.value = new Set();

  try {
    const results = await pluginImportMusicSheet(props.plugin, url);
    if (results.length === 0) {
      importError.value = '导入失败或歌单为空，请检查链接是否正确';
      showToast('导入失败或歌单为空', 'error');
    } else {
      importedSongs.value = results;
      // 默认全选
      selectedIds.value = new Set(results.map((r) => `${r.platform}-${r.id}`));
      showToast(`成功导入 ${results.length} 首歌曲`, 'success');
    }
  } catch (e: any) {
    importError.value = `导入失败: ${e?.message || e}`;
    showToast(`导入失败: ${e?.message || e}`, 'error');
  } finally {
    importing.value = false;
  }
}

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedIds.value = next;
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(importedSongs.value.map((r) => `${r.platform}-${r.id}`));
  }
}

function getSongId(item: PluginSearchResult) {
  return `${item.platform}-${item.id}`;
}

function isSelected(item: PluginSearchResult) {
  return selectedIds.value.has(getSongId(item));
}

function formatDuration(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 将导入的 PluginSearchResult 转换为 Song 对象
 * 使用 plugin:// 协议作为 path，与播放器/收藏/歌单系统一致
 * 同时保存 rawData，供播放系统调用 getMediaSource 时使用
 */
function pluginResultToSong(item: PluginSearchResult, source: PluginSource): Song {
  const artistNames = item.artist
    ? item.artist.split(/[、,/&]/).filter(Boolean).map((s) => s.trim())
    : ['未知歌手'];
  const path = `plugin://${item.platform}/${item.id}`;
  return {
    name: item.title,
    title: item.title,
    path,
    artist: item.artist || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.album || '未知专辑',
    album_artist: item.artist || '未知歌手',
    album_key: `${item.album || '未知专辑'}-${item.artist || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: Math.floor((item.duration || 0) / 1000),
    cover_thumb_path: item.coverUrl || '',
    source_type: 'plugin',
    plugin_id: source.id,
    remote_source_id: path,
    rawData: item.rawData ?? item,
  } as Song;
}

function handleAddToPlaylist() {
  if (!props.plugin || selectedCount.value === 0) {
    showToast('请选择至少一首歌曲', 'info');
    return;
  }

  // 获取选中的歌曲
  const selectedSongs = importedSongs.value.filter((item) => isSelected(item));
  const songPaths: string[] = [];
  const songMetaList: Song[] = [];

  for (const item of selectedSongs) {
    const song = pluginResultToSong(item, props.plugin);
    const path = song.path;
    songPaths.push(path);
    songMetaList.push(song);
  }

  // 保存在线歌曲元信息到 libraryStore.extraSongPool
  // 这样歌单视图可以通过 songLookup 解析到这些歌曲
  for (const song of songMetaList) {
    libraryStore.setExtraSong(song);
  }

  // 关闭导入弹窗
  emit('close');
  emit('update:visible', false);

  // 打开"添加到歌单"对话框
  nextTick(() => {
    openAddToPlaylistDialog(songPaths, {
      onAdded: () => {
        showToast(`已将 ${songPaths.length} 首歌曲添加到歌单`, 'success');
      },
    });
  });
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible && !importing.value) {
    handleClose();
  }
  if (e.key === 'Enter' && props.visible && !importing.value && !hasResults.value) {
    handleImport();
  }
}

// 全局键盘事件
onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      :class="{ 'pointer-events-none': isClosing }"
    >
      <!-- 遮罩 -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- 弹窗 -->
      <div
        class="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden transform transition-all duration-300 border border-white/20 ring-1 ring-black/5"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0',
        ]"
      >
        <!-- 头部 -->
        <div class="px-6 pt-5 pb-3 flex items-center justify-between border-b border-gray-100 dark:border-white/5">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Download class="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <h3 class="text-base font-bold text-gray-900 dark:text-white leading-6">导入歌单</h3>
              <p class="text-xs text-gray-500 dark:text-white/50">{{ pluginName }}</p>
            </div>
          </div>
          <button
            type="button"
            class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            @click="handleClose"
          >
            <X class="h-5 w-5" />
          </button>
        </div>

        <!-- 内容区 -->
        <div class="px-6 py-4">
          <!-- URL 输入区（导入前） -->
          <div v-if="!hasResults && !importing">
            <label class="block text-sm font-medium text-gray-700 dark:text-white/80 mb-2">
              歌单链接
            </label>
            <input
              ref="inputRef"
              v-model="urlInput"
              type="text"
              :placeholder="hints.length > 0 ? hints[0] : '粘贴歌单分享链接或 ID'"
              class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition-all text-sm text-gray-900 dark:text-white placeholder-gray-400"
              @keydown.enter="handleImport"
            />
            <!-- 提示文本 -->
            <div v-if="hints.length > 0" class="mt-2 space-y-1">
              <div
                v-for="(hint, idx) in hints"
                :key="idx"
                class="text-xs text-gray-400 dark:text-white/40 flex items-start gap-1"
              >
                <span class="mt-0.5">·</span>
                <span>{{ hint }}</span>
              </div>
            </div>
            <div v-else class="mt-2 text-xs text-gray-400 dark:text-white/40">
              粘贴{{ pluginName }}歌单的分享链接，插件会自动解析歌单中的歌曲
            </div>

            <!-- 错误提示 -->
            <div
              v-if="importError"
              class="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs"
            >
              <AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
              <span>{{ importError }}</span>
            </div>

            <!-- 导入按钮 -->
            <button
              type="button"
              class="mt-4 w-full inline-flex justify-center items-center gap-2 rounded-xl border border-transparent shadow-sm px-4 py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-400 transition-all duration-200 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="!urlInput.trim()"
              @click="handleImport"
            >
              <Download class="h-4 w-4" />
              开始导入
            </button>
          </div>

          <!-- 加载中 -->
          <div v-else-if="importing" class="flex flex-col items-center justify-center py-12">
            <Loader2 class="h-10 w-10 text-orange-500 animate-spin mb-4" />
            <p class="text-sm font-medium text-gray-700 dark:text-white/80">正在导入歌单…</p>
            <p class="text-xs text-gray-400 dark:text-white/40 mt-1">请稍候，这可能需要一点时间</p>
          </div>

          <!-- 导入结果 -->
          <div v-else-if="hasResults">
            <!-- 结果统计 + 操作 -->
            <div class="flex items-center justify-between mb-3">
              <div class="text-sm text-gray-600 dark:text-white/60">
                共 <span class="font-semibold text-gray-900 dark:text-white">{{ importedSongs.length }}</span> 首，
                已选 <span class="font-semibold text-orange-500">{{ selectedCount }}</span> 首
              </div>
              <button
                type="button"
                class="text-xs text-gray-500 dark:text-white/50 hover:text-orange-500 dark:hover:text-orange-400 transition-colors flex items-center gap-1"
                @click="toggleSelectAll"
              >
                <Check v-if="allSelected" class="h-3.5 w-3.5" />
                {{ allSelected ? '取消全选' : '全选' }}
              </button>
            </div>

            <!-- 歌曲列表 -->
            <div class="max-h-[320px] overflow-y-auto custom-scrollbar space-y-1 pr-1">
              <div
                v-for="item in importedSongs"
                :key="`${item.platform}-${item.id}`"
                class="flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors"
                :class="isSelected(item)
                  ? 'bg-orange-50 dark:bg-orange-500/10'
                  : 'hover:bg-gray-50 dark:hover:bg-white/5'"
                @click="toggleSelect(getSongId(item))"
              >
                <!-- 选择框 -->
                <div
                  class="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all"
                  :class="isSelected(item)
                    ? 'bg-orange-500 border-orange-500'
                    : 'border-gray-300 dark:border-white/20'"
                >
                  <Check v-if="isSelected(item)" class="h-3 w-3 text-white" />
                </div>

                <!-- 封面 -->
                <div class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-white/5 overflow-hidden shrink-0 flex items-center justify-center">
                  <img
                    v-if="item.coverUrl"
                    :src="item.coverUrl"
                    class="w-full h-full object-cover"
                    alt=""
                    loading="lazy"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                  />
                  <Music v-else class="h-4 w-4 text-gray-300 dark:text-white/20" />
                </div>

                <!-- 信息 -->
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium text-gray-800 dark:text-white/90 truncate">{{ item.title }}</div>
                  <div class="text-xs text-gray-400 dark:text-white/40 truncate">
                    {{ item.artist || '未知歌手' }}
                    <span v-if="item.album"> · {{ item.album }}</span>
                  </div>
                </div>

                <!-- 时长 -->
                <div class="text-xs text-gray-300 dark:text-white/30 shrink-0">
                  {{ formatDuration(item.duration / 1000) }}
                </div>
              </div>
            </div>

            <!-- 错误提示 -->
            <div
              v-if="importError"
              class="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs"
            >
              <AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
              <span>{{ importError }}</span>
            </div>

            <!-- 操作按钮 -->
            <div class="flex gap-3 mt-4">
              <button
                type="button"
                class="flex-1 inline-flex justify-center items-center gap-2 rounded-xl border border-gray-200 dark:border-white/10 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-all duration-200"
                @click="handleClose"
              >
                关闭
              </button>
              <button
                type="button"
                class="flex-1 inline-flex justify-center items-center gap-2 rounded-xl border border-transparent shadow-sm px-4 py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-400 transition-all duration-200 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="selectedCount === 0"
                @click="handleAddToPlaylist"
              >
                <Download class="h-4 w-4" />
                添加到歌单 ({{ selectedCount }})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}
</style>
