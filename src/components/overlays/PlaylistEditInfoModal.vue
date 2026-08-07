<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';

import type { Song } from '../../types';
import { useCollectionsStore } from '../../features/collections/store';
import { useLibraryStore } from '../../features/library/store';
import { useCoverCache } from '../../composables/useCoverCache';

const props = defineProps<{
  visible: boolean;
  playlistId: string;
  initialName: string;
  initialCoverPath?: string;
}>();

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void;
  (event: 'confirm', payload: { name: string; coverPath: string | null }): void;
  (event: 'cancel'): void;
}>();

const collectionsStore = useCollectionsStore();
const libraryStore = useLibraryStore();
const { loadCover, loadCoverPath } = useCoverCache();

const isClosing = ref(false);
const nameInput = ref('');
const nameInputRef = ref<HTMLInputElement | null>(null);
const coverPath = ref<string | null>(null);
const coverPreviewUrl = ref<string>('');

// 封面来源菜单
type CoverPanel = 'main' | 'source-menu' | 'song-picker';
const coverPanel = ref<CoverPanel>('main');

// 歌单内歌曲列表（响应式：歌单或库变化时自动更新）
const playlistSongs = computed<Song[]>(() => {
  const playlist = collectionsStore.playlists.find(p => p.id === props.playlistId);
  if (!playlist) return [];
  const lookup = libraryStore.songLookup;
  return playlist.songPaths.map(path => {
    const song = lookup.get(path);
    if (song) return song;
    // fallback：歌曲不在库中时创建最小 Song 对象，确保仍然显示在列表里
    const fileName = path.split(/[\\/]/).pop() || path;
    return {
      name: fileName,
      title: fileName.replace(/\.[^.]+$/, ''),
      path,
      artist: '未知艺术家',
      artist_names: [],
      effective_artist_names: [],
      album: '',
      album_artist: '',
      album_key: '',
      is_various_artists_album: false,
      collapse_artist_credits: false,
      duration: 0,
    } as Song;
  });
});

const songCoverUrls = ref<Record<string, string>>({});
const pickingSongIndex = ref<number | null>(null);
const songSearchQuery = ref('');

const filteredPlaylistSongs = computed(() => {
  const keyword = songSearchQuery.value.trim().toLowerCase();
  if (!keyword) return playlistSongs.value;
  return playlistSongs.value.filter(song =>
    (song.title || song.name || '').toLowerCase().includes(keyword) ||
    (song.artist || '').toLowerCase().includes(keyword) ||
    (song.album || '').toLowerCase().includes(keyword)
  );
});

// 歌曲列表变化时预加载封面缩略图
watch(playlistSongs, async (songs) => {
  for (const song of songs) {
    if (songCoverUrls.value[song.path]) continue;
    try {
      const url = await loadCover(song.path);
      if (url) {
        songCoverUrls.value = { ...songCoverUrls.value, [song.path]: url };
      }
    } catch {
      // ignore
    }
  }
}, { immediate: true });

watch(() => props.visible, async (val) => {
  if (val) {
    nameInput.value = props.initialName || '';
    coverPath.value = props.initialCoverPath ?? null;
    const initPath = coverPath.value;
    if (initPath) {
      const isNetworkUrl = /^https?:\/\//i.test(initPath) || initPath.startsWith('asset:') || initPath.startsWith('data:');
      coverPreviewUrl.value = isNetworkUrl ? initPath : convertFileSrc(initPath);
    } else {
      coverPreviewUrl.value = '';
    }
    coverPanel.value = 'main';
    songSearchQuery.value = '';
    await nextTick();
    if (nameInputRef.value) nameInputRef.value.focus();
  } else {
    isClosing.value = false;
  }
});

// ===== 本地选择封面 =====
const handleSelectCoverFromLocal = async () => {
  coverPanel.value = 'main';
  const selected = await openDialog({
    multiple: false,
    directory: false,
    title: '选择歌单封面',
    filters: [
      {
        name: '图片',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
      },
    ],
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  coverPath.value = selected as string;
  coverPreviewUrl.value = convertFileSrc(selected as string);
};

// ===== 从歌单歌曲中选择封面 =====
const handleSelectCoverFromPlaylist = () => {
  coverPanel.value = 'song-picker';
  songSearchQuery.value = '';
  // playlistSongs 是 computed，自动响应歌单和库的变化，无需手动赋值
};

const handlePickSongCover = async (song: Song, index: number) => {
  pickingSongIndex.value = index;
  try {
    // 获取歌曲封面文件的本地路径
    const rawPath = await loadCoverPath(song.path);
    if (rawPath) {
      // rawPath 可能是本地文件路径，也可能是网络URL（plugin 歌曲通过 primeCoverPath 缓存）
      const isNetworkUrl = /^https?:\/\//i.test(rawPath) || rawPath.startsWith('asset:') || rawPath.startsWith('data:');
      coverPath.value = rawPath;
      coverPreviewUrl.value = isNetworkUrl ? rawPath : convertFileSrc(rawPath);
    } else {
      // 回退：如果无法获取文件路径，使用歌曲 cover_thumb_path
      const thumbPath = song.cover_thumb_path;
      if (thumbPath && !thumbPath.startsWith('http') && !thumbPath.startsWith('asset:') && !thumbPath.startsWith('data:')) {
        coverPath.value = thumbPath;
        coverPreviewUrl.value = convertFileSrc(thumbPath);
      } else if (thumbPath) {
        // 网络封面也可作为自定义封面保存（侧边栏/详情页已支持 isDirectUrl 判断）
        coverPath.value = thumbPath;
        coverPreviewUrl.value = thumbPath;
      }
    }
  } catch {
    // ignore
  } finally {
    pickingSongIndex.value = null;
    coverPanel.value = 'main';
  }
};

const handleBackToMain = () => {
  coverPanel.value = 'main';
};

const handleRemoveCover = () => {
  coverPath.value = null;
  coverPreviewUrl.value = '';
};

let closeTimer: ReturnType<typeof setTimeout> | null = null;

const handleClose = () => {
  isClosing.value = true;
  closeTimer = setTimeout(() => {
    emit('cancel');
    emit('update:visible', false);
    isClosing.value = false;
    closeTimer = null;
  }, 200);
};

const hasNameChanged = computed(() => nameInput.value.trim() !== props.initialName.trim());
const hasCoverChanged = computed(() => (coverPath.value ?? null) !== (props.initialCoverPath ?? null));
const canConfirm = computed(() => nameInput.value.trim().length > 0 && (hasNameChanged.value || hasCoverChanged.value));

const handleConfirm = () => {
  if (!nameInput.value.trim() || !canConfirm.value) return;
  isClosing.value = true;
  closeTimer = setTimeout(() => {
    emit('confirm', {
      name: nameInput.value.trim(),
      coverPath: coverPath.value,
    });
    emit('update:visible', false);
    isClosing.value = false;
    closeTimer = null;
  }, 200);
};

const handleKeydown = (e: KeyboardEvent) => {
  if (!props.visible) return;
  if (e.key === 'Escape') {
    if (coverPanel.value !== 'main') {
      coverPanel.value = 'main';
      return;
    }
    handleClose();
  } else if (e.key === 'Enter' && coverPanel.value === 'main') {
    handleConfirm();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
});
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
        class="relative bg-white/80 dark:bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden transform transition-all duration-300"
        style="transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0',
          'border border-white/20 ring-1 ring-black/5'
        ]"
      >
        <!-- Header -->
        <div class="px-6 pt-6 pb-2 text-center">
          <h3 class="text-lg font-bold text-gray-900 dark:text-white leading-6">修改信息</h3>
        </div>

        <!-- Body -->
        <div class="px-6 pb-6 space-y-5">
          <!-- 封面区域 -->
          <div class="flex flex-col items-center gap-3">
            <!-- 主面板：封面预览 + 操作按钮 -->
            <template v-if="coverPanel === 'main'">
              <div
                class="relative w-28 h-28 rounded-xl overflow-hidden flex items-center justify-center bg-gray-100 dark:bg-black/20 border border-gray-200 dark:border-gray-700 shadow-sm shrink-0"
              >
                <img
                  v-if="coverPreviewUrl"
                  :src="coverPreviewUrl"
                  alt="封面预览"
                  class="w-full h-full object-cover animate-in fade-in duration-300"
                />
                <svg
                  v-else
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  class="w-10 h-10 text-gray-300 dark:text-white/20"
                >
                  <path fill-rule="evenodd" d="M19.952 1.651a.75.75 0 01.298.599V16.303a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V6.994l-9 2.572v9.737a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V9.017c0-.528.246-1.032.67-1.371l10.038-5.996z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  @click="coverPanel = 'source-menu'"
                  class="px-4 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 transition active:scale-95"
                >
                  {{ coverPath ? '更换封面' : '选择封面' }}
                </button>
                <button
                  v-if="coverPath"
                  type="button"
                  @click="handleRemoveCover"
                  class="px-3 py-1.5 rounded-full text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition active:scale-95"
                >
                  移除
                </button>
              </div>
              <p class="text-xs text-gray-400 dark:text-gray-500 text-center m-0">
                不设置则使用歌单内首支歌曲的封面
              </p>
            </template>

            <!-- 来源菜单 -->
            <template v-else-if="coverPanel === 'source-menu'">
              <div class="w-full space-y-2 animate-in fade-in zoom-in-95 duration-200">
                <button
                  type="button"
                  @click="handleSelectCoverFromPlaylist"
                  class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 border border-gray-200 dark:border-gray-700 transition active:scale-95 text-left"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-[#EC4141] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">在歌单中选择</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">从歌单内歌曲的封面中挑选</div>
                  </div>
                </button>
                <button
                  type="button"
                  @click="handleSelectCoverFromLocal"
                  class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 border border-gray-200 dark:border-gray-700 transition active:scale-95 text-left"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-[#EC4141] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2z" />
                  </svg>
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">在本地选择</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">从本地文件中选择图片</div>
                  </div>
                </button>
                <button
                  type="button"
                  @click="handleBackToMain"
                  class="w-full px-4 py-2 rounded-xl text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition active:scale-95"
                >
                  返回
                </button>
              </div>
            </template>

            <!-- 歌曲选择列表 -->
            <template v-else-if="coverPanel === 'song-picker'">
              <div class="w-full space-y-2 animate-in fade-in zoom-in-95 duration-200">
                <div class="flex items-center justify-between">
                  <p class="text-xs font-medium text-gray-600 dark:text-gray-300 m-0">选择一首歌曲作为封面</p>
                  <button
                    type="button"
                    @click="handleBackToMain"
                    class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
                  >
                    返回
                  </button>
                </div>
                <!-- 搜索框 -->
                <div class="relative">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500 pointer-events-none"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    v-model="songSearchQuery"
                    type="text"
                    placeholder="搜索歌曲、歌手、专辑..."
                    class="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-xs"
                  />
                </div>
                <div class="max-h-72 overflow-y-auto space-y-1 rounded-xl border border-gray-200 dark:border-gray-700 p-1">
                  <div
                    v-for="song in filteredPlaylistSongs"
                    :key="song.path"
                    class="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 cursor-pointer transition active:scale-95"
                    @click="handlePickSongCover(song, 0)"
                  >
                    <div class="w-10 h-10 rounded-md overflow-hidden bg-gray-200 dark:bg-black/30 shrink-0 flex items-center justify-center">
                      <img
                        v-if="songCoverUrls[song.path]"
                        :src="songCoverUrls[song.path]"
                        alt=""
                        class="w-full h-full object-cover"
                      />
                      <svg
                        v-else
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        class="w-5 h-5 text-gray-300 dark:text-white/20"
                      >
                        <path fill-rule="evenodd" d="M19.952 1.651a.75.75 0 01.298.599V16.303a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V6.994l-9 2.572v9.737a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V9.017c0-.528.246-1.032.67-1.371l10.038-5.996z" clip-rule="evenodd" />
                      </svg>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ song.title || song.name }}</div>
                      <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ song.artist }}</div>
                    </div>
                  </div>
                  <div
                    v-if="playlistSongs.length === 0"
                    class="py-6 text-center text-xs text-gray-400 dark:text-gray-500"
                  >
                    歌单中暂无歌曲
                  </div>
                  <div
                    v-else-if="filteredPlaylistSongs.length === 0"
                    class="py-6 text-center text-xs text-gray-400 dark:text-gray-500"
                  >
                    未找到匹配的歌曲
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- 名称 -->
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-gray-600 dark:text-gray-300">歌单名称</label>
            <input
              ref="nameInputRef"
              v-model="nameInput"
              type="text"
              placeholder="请输入歌单名称"
              class="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent transition-all text-gray-900 dark:text-white placeholder-gray-400 text-sm"
            />
          </div>
        </div>

        <!-- Footer -->
        <div class="px-4 py-3 bg-gray-50/50 dark:bg-white/5 flex gap-3 flex-col sm:flex-row-reverse">
          <button
            @click="handleConfirm"
            :disabled="!canConfirm"
            class="w-full inline-flex justify-center rounded-xl border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#EC4141] sm:text-sm transition-all duration-200 bg-[#EC4141] hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存
          </button>
          <button
            @click="handleClose"
            class="w-full inline-flex justify-center rounded-xl border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:text-sm transition-all duration-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
