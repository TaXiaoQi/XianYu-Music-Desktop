<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { MessageCircle, Heart, X, Loader2, ChevronRight } from 'lucide-vue-next';
import { pluginGetMusicComments, isBakaPlugin } from '../../services/pluginEngine';
import type { PluginSource, PluginSearchResult, Song } from '../../types';
import { usePlaybackController } from '../../features/playback/usePlaybackController';

const props = defineProps<{
  visible: boolean;
  song: Song | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { currentSong } = usePlaybackController();

interface CommentItem {
  id?: string;
  nickName: string;
  avatar?: string;
  comment: string;
  like?: number;
  createAt?: number;
  location?: string;
  replies?: CommentItem[];
}

const comments = ref<CommentItem[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const currentPage = ref(1);
const isEnd = ref(false);
const error = ref<string | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);
const canLoadMore = computed(() => !isEnd.value && !loadingMore.value && comments.value.length > 0);

const hasPluginSource = computed(() => {
  const song = props.song || currentSong.value;
  if (!song) return false;
  return song.source_type === 'plugin' && !!song.plugin_id;
});

const songTitle = computed(() => {
  const song = props.song || currentSong.value;
  return song?.title || song?.name || '';
});

const songArtist = computed(() => {
  const song = props.song || currentSong.value;
  return song?.artist || '';
});

function buildSearchResult(song: Song): PluginSearchResult | null {
  if (!song.rawData) return null;
  return {
    id: String(song.rawData.id || song.rawData.songId || ''),
    title: song.title || song.name || '',
    artist: song.artist || '',
    album: song.album || '',
    coverUrl: '',
    duration: song.duration || 0,
    platform: song.rawData.platform || '',
    platformId: String(song.rawData.id || ''),
    pluginId: song.plugin_id || '',
    rawData: song.rawData,
  } as PluginSearchResult;
}

function buildPluginSource(song: Song): PluginSource | null {
  if (!song.plugin_id) return null;
  return {
    id: song.plugin_id,
    name: song.rawData?.platform || '',
    format: 'musicfree',
    version: '',
    author: '',
    description: '',
    filePath: '',
    importedAt: 0,
    enabled: true,
    sources: [song.rawData?.platform || ''],
  } as PluginSource;
}

async function fetchComments(page: number = 1) {
  const song = props.song || currentSong.value;
  if (!song || !song.plugin_id) return;

  const source = buildPluginSource(song);
  const item = buildSearchResult(song);
  if (!source || !item) return;

  try {
    if (page === 1) {
      loading.value = true;
      comments.value = [];
    } else {
      loadingMore.value = true;
    }
    error.value = null;

    const result = await pluginGetMusicComments(source, item, page);
    if (result) {
      const newComments = (result.data || []) as CommentItem[];
      if (page === 1) {
        comments.value = newComments;
      } else {
        comments.value.push(...newComments);
      }
      isEnd.value = result.isEnd ?? (newComments.length === 0);
      currentPage.value = page;
    } else {
      if (page === 1) {
        comments.value = [];
      }
      isEnd.value = true;
    }
  } catch (e: any) {
    error.value = e?.message || '获取评论失败';
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function loadMore() {
  if (!canLoadMore.value) return;
  await fetchComments(currentPage.value + 1);
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)}天前`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatLike(count?: number): string {
  if (!count || count <= 0) return '';
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`;
  return String(count);
}

watch(() => props.visible, async (newVal) => {
  if (newVal) {
    await fetchComments(1);
    await nextTick();
    scrollContainer.value?.scrollTo({ top: 0 });
  }
});

watch(() => props.song?.path, (newPath, oldPath) => {
  if (props.visible && newPath !== oldPath) {
    fetchComments(1);
  }
});

function handleScroll() {
  const el = scrollContainer.value;
  if (!el || !canLoadMore.value) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    loadMore();
  }
}

onMounted(() => {
  if (props.visible) {
    fetchComments(1);
  }
});

onUnmounted(() => {
  comments.value = [];
});
</script>

<template>
  <Transition name="comment-panel">
    <div
      v-if="visible"
      class="comment-panel-overlay fixed bottom-20 left-1/2 -translate-x-1/2 z-[65] w-[480px] max-w-[90vw]"
    >
      <div
        class="comment-panel-container rounded-2xl shadow-2xl border overflow-hidden bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border-gray-200/50 dark:border-zinc-700/50"
      >
        <!-- Header -->
        <div class="comment-panel-header flex items-center justify-between px-4 py-3 border-b border-gray-200/50 dark:border-zinc-700/50 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <MessageCircle class="h-4 w-4 text-[#EC4141] shrink-0" :stroke-width="2.2" />
            <div class="min-w-0">
              <div class="text-sm font-semibold text-gray-900 dark:text-white truncate">评论区</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ songTitle }} - {{ songArtist }}</div>
            </div>
          </div>
          <button
            @click="emit('close')"
            class="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            <X class="h-4 w-4" :stroke-width="2.2" />
          </button>
        </div>

        <!-- Content -->
        <div
          ref="scrollContainer"
          @scroll="handleScroll"
          class="comment-panel-content flex-1 overflow-y-auto px-4 py-3 max-h-[400px] min-h-[200px]"
          style="scrollbar-width: thin;"
        >
          <!-- Loading -->
          <div v-if="loading" class="flex items-center justify-center py-12">
            <Loader2 class="h-5 w-5 text-[#EC4141] animate-spin" :stroke-width="2.2" />
            <span class="ml-2 text-sm text-gray-500 dark:text-gray-400">加载评论中...</span>
          </div>

          <!-- Error -->
          <div v-else-if="error" class="flex flex-col items-center justify-center py-12">
            <span class="text-sm text-gray-500 dark:text-gray-400 mb-2">{{ error }}</span>
            <button
              @click="fetchComments(1)"
              class="text-xs text-[#EC4141] hover:underline"
            >重试</button>
          </div>

          <!-- Empty -->
          <div v-else-if="comments.length === 0" class="flex flex-col items-center justify-center py-12">
            <MessageCircle class="h-8 w-8 text-gray-300 dark:text-zinc-700 mb-2" :stroke-width="1.5" />
            <span class="text-sm text-gray-400 dark:text-gray-500">暂无评论</span>
          </div>

          <!-- Comment List -->
          <template v-else>
            <div
              v-for="(comment, idx) in comments"
              :key="comment.id || idx"
              class="comment-item flex gap-3 py-3"
              :class="{ 'border-t border-gray-100/60 dark:border-zinc-800/60': idx > 0 }"
            >
              <!-- Avatar -->
              <div class="shrink-0 w-9 h-9 rounded-full overflow-hidden bg-gray-200 dark:bg-zinc-700 flex items-center justify-center">
                <img
                  v-if="comment.avatar"
                  :src="comment.avatar"
                  :alt="comment.nickName"
                  class="w-full h-full object-cover"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
                <span v-else class="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {{ comment.nickName?.charAt(0) || '?' }}
                </span>
              </div>

              <!-- Comment Body -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-0.5">
                  <span class="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{{ comment.nickName }}</span>
                  <span v-if="comment.location" class="text-[10px] text-gray-400 dark:text-gray-500 truncate">{{ comment.location }}</span>
                </div>
                <p class="text-sm text-gray-800 dark:text-gray-200 leading-relaxed break-words whitespace-pre-wrap">{{ comment.comment }}</p>
                <div class="flex items-center gap-3 mt-1.5">
                  <span class="text-[10px] text-gray-400 dark:text-gray-500">{{ formatTime(comment.createAt) }}</span>
                  <div v-if="comment.like && comment.like > 0" class="flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                    <Heart class="h-3 w-3" :stroke-width="2" />
                    <span>{{ formatLike(comment.like) }}</span>
                  </div>
                </div>

                <!-- Replies -->
                <div v-if="comment.replies && comment.replies.length > 0" class="mt-2 pl-3 border-l-2 border-gray-100 dark:border-zinc-800 space-y-2">
                  <div v-for="(reply, rIdx) in comment.replies" :key="reply.id || rIdx" class="text-sm">
                    <div class="flex items-center gap-1.5 mb-0.5">
                      <span class="text-xs font-medium text-gray-600 dark:text-gray-400">{{ reply.nickName }}</span>
                      <span v-if="reply.location" class="text-[10px] text-gray-400 dark:text-gray-500">{{ reply.location }}</span>
                    </div>
                    <p class="text-gray-700 dark:text-gray-300 leading-relaxed break-words whitespace-pre-wrap">{{ reply.comment }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Load More -->
            <div v-if="loadingMore" class="flex items-center justify-center py-4">
              <Loader2 class="h-4 w-4 text-[#EC4141] animate-spin" :stroke-width="2.2" />
              <span class="ml-2 text-xs text-gray-500 dark:text-gray-400">加载更多...</span>
            </div>
            <div v-else-if="canLoadMore" class="flex items-center justify-center py-3">
              <button
                @click="loadMore"
                class="flex items-center gap-1 text-xs text-[#EC4141] hover:underline"
              >
                加载更多
                <ChevronRight class="h-3 w-3" :stroke-width="2.2" />
              </button>
            </div>
            <div v-else-if="comments.length > 0 && isEnd" class="text-center py-3 text-xs text-gray-400 dark:text-gray-500">
              没有更多评论了
            </div>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.comment-panel-enter-active,
.comment-panel-leave-active {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.comment-panel-enter-from {
  opacity: 0;
  transform: translate(-50%, 20px) scale(0.95);
}

.comment-panel-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px) scale(0.95);
}

.comment-panel-content::-webkit-scrollbar {
  width: 4px;
}

.comment-panel-content::-webkit-scrollbar-track {
  background: transparent;
}

.comment-panel-content::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 2px;
}

html.dark .comment-panel-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
}
</style>
