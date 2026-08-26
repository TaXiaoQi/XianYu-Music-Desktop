<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { MessageCircle, Heart, X, Loader2, ChevronRight, ChevronDown, Flame, Clock } from 'lucide-vue-next';
import { pluginGetMusicComments } from '../../services/domain/pluginEngine';
import type { PluginSource, PluginSearchResult, Song } from '../../types';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useUiStore } from '../../shared/stores/ui';
import { useThemeSettings } from '../../composables/useThemeSettings';

const props = defineProps<{
  song?: Song | null;
}>();

const { theme } = useThemeSettings();

const { currentSong } = usePlaybackController();
const uiStore = useUiStore();
const { showComment } = storeToRefs(uiStore);
const toggleComment = () => { uiStore.showComment = !uiStore.showComment; };

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
/** 插件与宿主平台兜底都无法提供评论（平台不支持），区别于"暂无评论" */
const unsupported = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);
const canLoadMore = computed(() => !isEnd.value && !loadingMore.value && comments.value.length > 0);

/** 评论排序模式：'likes' 最多赞（默认）| 'newest' 最新 */
const sortMode = ref<'likes' | 'newest'>('likes');

/** 记录已展开二级评论的一级评论 key 集合 */
const expandedReplies = ref<Set<string>>(new Set());

const resolvedSong = computed<Song | null>(() => props.song ?? currentSong.value ?? null);
const commentCount = computed(() => comments.value.length);

/** 当前歌曲所属插件 id：播放链路构造的 Song 不写 plugin_id，回退 rawData.pluginId（与播放解析/MV 判定一致） */
const activePluginId = computed(() =>
  resolvedSong.value?.plugin_id
  || (resolvedSong.value?.rawData as Record<string, unknown> | undefined)?.pluginId as string | undefined
  || '',
);

/** 排序后的评论列表（仅排序一级评论，不影响分页加载） */
const sortedComments = computed(() => {
  const list = [...comments.value];
  if (sortMode.value === 'likes') {
    list.sort((a, b) => (b.like ?? 0) - (a.like ?? 0));
  } else {
    list.sort((a, b) => (b.createAt ?? 0) - (a.createAt ?? 0));
  }
  return list;
});

function getCommentKey(comment: CommentItem, idx: number): string {
  return comment.id || `idx-${idx}`;
}

function toggleReplies(comment: CommentItem, idx: number) {
  const key = getCommentKey(comment, idx);
  if (expandedReplies.value.has(key)) {
    expandedReplies.value.delete(key);
  } else {
    expandedReplies.value.add(key);
  }
  // 触发响应式更新
  expandedReplies.value = new Set(expandedReplies.value);
}

function isRepliesExpanded(comment: CommentItem, idx: number): boolean {
  return expandedReplies.value.has(getCommentKey(comment, idx));
}

function buildSearchResult(song: Song, pluginId: string): PluginSearchResult | null {
  if (!song.rawData) return null;
  const raw = song.rawData as Record<string, any>;
  // 播放主路径把搜索阶段的 PluginSearchResult 整个存进 song.rawData；
  // 插件 getMediaSource / 宿主平台兜底消费的是内层 MusicFree 条目
  // （songmid/id/qualities 都在内层），外层整体传入会让插件读到
  // songmid=undefined（QQ 插件报"无效的歌曲ID: null"）。
  const mediaItem = raw.rawData && typeof raw.rawData === 'object' ? raw.rawData : raw;
  return {
    id: String(raw.id || raw.songId || ''),
    title: song.title || song.name || '',
    artist: song.artist || '',
    album: song.album || '',
    coverUrl: '',
    duration: song.duration || 0,
    platform: raw.platform || '',
    platformId: String(raw.id || ''),
    pluginId,
    rawData: mediaItem,
  } as PluginSearchResult;
}

function buildPluginSource(song: Song, pluginId: string): PluginSource | null {
  return {
    id: pluginId,
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
  const song = resolvedSong.value;
  const pluginId = activePluginId.value;
  if (!song || !pluginId) return;

  const source = buildPluginSource(song, pluginId);
  const item = buildSearchResult(song, pluginId);
  if (!source || !item) return;

  try {
    if (page === 1) {
      loading.value = true;
      comments.value = [];
      expandedReplies.value.clear();
      unsupported.value = false;
    } else {
      loadingMore.value = true;
    }
    error.value = null;

    const result = await pluginGetMusicComments(source, item, page);
    if (result) {
      const rawComments = (result.data || []) as any[];
      const newComments = rawComments.map(normalizeComment);
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
        unsupported.value = true;
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

/**
 * 规范化评论数据：兼容不同插件返回的二级评论字段名。
 * 有些插件用 replyList / subComments / children / replys 等字段名而非 replies。
 */
function normalizeComment(raw: any): CommentItem {
  const c: CommentItem = {
    id: raw.id ?? raw.commentId ?? raw.comment_id,
    nickName: raw.nickName ?? raw.nickname ?? raw.userName ?? raw.name ?? '',
    avatar: raw.avatar ?? raw.userAvatar ?? raw.headPic,
    comment: raw.comment ?? raw.content ?? raw.text ?? '',
    like: raw.like ?? raw.likeCount ?? raw.likes ?? raw.like_count,
    createAt: raw.createAt ?? raw.createdAt ?? raw.timestamp ?? raw.time,
    location: raw.location ?? raw.address,
    replies: undefined,
  };

  // 兼容多种二级评论字段名
  const replyFields = ['replies', 'replyList', 'subComments', 'children', 'replys', 'sub_comment', 'reply_list'];
  for (const field of replyFields) {
    if (Array.isArray(raw[field]) && raw[field].length > 0) {
      c.replies = raw[field].map((r: any) => normalizeComment(r));
      break;
    }
  }

  return c;
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

watch(showComment, async (newVal) => {
  if (newVal) {
    await fetchComments(1);
    await nextTick();
    scrollContainer.value?.scrollTo({ top: 0 });
  }
});

watch(() => resolvedSong.value?.path, (newPath, oldPath) => {
  if (showComment.value && newPath !== oldPath) {
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
  if (showComment.value) {
    fetchComments(1);
  }
});

onUnmounted(() => {
  comments.value = [];
});
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div
        v-if="showComment"
        class="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px]"
        @click="toggleComment"
      ></div>
    </transition>

    <transition name="slide-right">
      <div
        v-if="showComment"
        class="fixed right-0 rounded-l-2xl shadow-[0_18px_50px_rgba(15,23,42,0.22)] border-l border-t border-b border-white/70 dark:border-white/10 z-[100] flex flex-col overflow-hidden font-sans select-none bg-[#f7f9fc]/90 dark:bg-[#262626]/90 transition-all duration-300 ring-1 ring-black/5 dark:ring-white/5"
        :class="[(theme.dynamicBgType === 'none' && theme.mode === 'custom') ? '' : 'backdrop-blur-2xl']"
        :style="{ width: 'clamp(360px, 28vw, 560px)', maxWidth: '95vw', height: 'calc(100vh - 180px)', minHeight: '200px', bottom: '96px' }"
        @click.stop
      >
        <!-- Header -->
        <div
          class="px-5 py-4 border-b border-[#d9e0ea] dark:border-white/10 flex justify-between items-center bg-[#f8fafc]/95 dark:bg-[#262626]/95 z-10 shadow-sm"
          :class="[(theme.dynamicBgType === 'none' && theme.mode === 'custom') ? '' : 'backdrop-blur-sm']"
        >
          <div class="flex items-center gap-3 min-w-0">
            <MessageCircle class="h-5 w-5 text-[#EC4141] shrink-0" :stroke-width="2.2" />
            <div class="min-w-0">
              <h3 class="font-bold text-[#172033] dark:text-white text-base tracking-tight leading-tight">评论区</h3>
              <div class="mt-0.5 text-[11px] text-[#34445c] dark:text-white/60 truncate">
                {{ resolvedSong?.title || resolvedSong?.name || '' }}
                <span v-if="resolvedSong?.artist"> - {{ resolvedSong.artist }}</span>
              </div>
            </div>
            <span
              v-if="commentCount > 0"
              class="shrink-0 text-xs text-[#34445c] dark:text-white font-semibold bg-[#e7edf5] dark:bg-white/12 px-2 py-0.5 rounded-full"
            >{{ commentCount }}</span>
          </div>
          <button
            @click="toggleComment"
            class="shrink-0 text-[#34445c] dark:text-white/90 hover:text-[#EC4141] hover:bg-[#EC4141]/10 dark:hover:bg-red-500/15 w-8 h-8 flex items-center justify-center rounded-lg transition-all active:scale-95"
            title="关闭"
          >
            <X class="h-4 w-4" :stroke-width="2.2" />
          </button>
        </div>

        <!-- Sort Bar -->
        <div
          v-if="activePluginId && comments.length > 0"
          class="flex items-center gap-1 px-4 py-2 border-b border-[#d9e0ea]/60 dark:border-white/8 bg-[#f3f6fa]/80 dark:bg-[#2a2a2a]/80"
        >
          <button
            @click="sortMode = 'likes'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
            :class="sortMode === 'likes'
              ? 'bg-[#EC4141]/12 text-[#EC4141] dark:bg-red-500/18 dark:text-red-400'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100/70 dark:hover:bg-white/8'"
          >
            <Flame class="h-3 w-3" :stroke-width="2.2" />
            最多赞
          </button>
          <button
            @click="sortMode = 'newest'"
            class="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
            :class="sortMode === 'newest'
              ? 'bg-[#EC4141]/12 text-[#EC4141] dark:bg-red-500/18 dark:text-red-400'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100/70 dark:hover:bg-white/8'"
          >
            <Clock class="h-3 w-3" :stroke-width="2.2" />
            最新
          </button>
        </div>

        <!-- Content -->
        <div
          ref="scrollContainer"
          @scroll="handleScroll"
          class="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 bg-[#eef3f8]/45 dark:bg-[#262626]/35"
        >
          <!-- Not supported -->
          <div
            v-if="!activePluginId || unsupported"
            class="h-full flex flex-col items-center justify-center text-[#34445c] dark:text-white/90 space-y-4 py-20"
          >
            <div class="w-20 h-20 rounded-full bg-white/70 dark:bg-white/10 flex items-center justify-center shadow-inner">
              <MessageCircle class="h-10 w-10 text-[#42526a] dark:text-white/80" :stroke-width="1.5" />
            </div>
            <div class="space-y-1 text-center">
              <span class="text-sm font-medium block">当前歌曲不支持评论</span>
              <span v-if="!activePluginId" class="text-xs text-[#42526a] dark:text-white/60 block">评论功能仅对在线插件源歌曲开放</span>
              <span v-else class="text-xs text-[#42526a] dark:text-white/60 block">该音源暂不支持评论</span>
            </div>
          </div>

          <!-- Loading -->
          <div v-else-if="loading" class="flex items-center justify-center py-12">
            <Loader2 class="h-5 w-5 text-[#EC4141] animate-spin" :stroke-width="2.2" />
            <span class="ml-2 text-sm text-gray-500 dark:text-gray-400">加载评论中...</span>
          </div>

          <!-- Error -->
          <div v-else-if="error" class="flex flex-col items-center justify-center py-12">
            <span class="text-sm text-gray-500 dark:text-gray-400 mb-2">{{ error }}</span>
            <button @click="fetchComments(1)" class="text-xs text-[#EC4141] hover:underline">重试</button>
          </div>

          <!-- Empty -->
          <div v-else-if="comments.length === 0" class="flex flex-col items-center justify-center py-20">
            <MessageCircle class="h-10 w-10 text-gray-300 dark:text-zinc-700 mb-2" :stroke-width="1.5" />
            <span class="text-sm text-gray-400 dark:text-gray-500">暂无评论</span>
          </div>

          <!-- Comment List -->
          <template v-else>
            <div
              v-for="(comment, idx) in sortedComments"
              :key="comment.id || idx"
              class="flex gap-3 py-3"
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
                  <!-- 展开/收起 二级评论（与时间、点赞同行） -->
                  <button
                    v-if="comment.replies && comment.replies.length > 0"
                    @click="toggleReplies(comment, idx)"
                    class="flex items-center gap-0.5 text-[10px] font-medium text-[#EC4141] hover:text-[#d63838] dark:text-red-400 dark:hover:text-red-300 transition-colors"
                  >
                    <component :is="isRepliesExpanded(comment, idx) ? ChevronDown : ChevronRight" class="h-3 w-3 transition-transform duration-200" :stroke-width="2.2" />
                    {{ isRepliesExpanded(comment, idx) ? '收起' : '展开' }}
                  </button>
                </div>

                <!-- Expanded Replies -->
                <Transition name="reply-collapse">
                  <div v-if="comment.replies && comment.replies.length > 0 && isRepliesExpanded(comment, idx)" class="mt-2 pl-3 border-l-2 border-gray-100 dark:border-zinc-800 space-y-2 overflow-hidden">
                  <div v-for="(reply, rIdx) in comment.replies" :key="reply.id || rIdx" class="flex gap-2 text-sm">
                    <!-- Reply Avatar -->
                    <div class="shrink-0 w-6 h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-zinc-700 flex items-center justify-center">
                      <img
                        v-if="reply.avatar"
                        :src="reply.avatar"
                        :alt="reply.nickName"
                        class="w-full h-full object-cover"
                        loading="lazy"
                        @error="($event.target as HTMLImageElement).style.display = 'none'"
                      />
                      <span v-else class="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                        {{ reply.nickName?.charAt(0) || '?' }}
                      </span>
                    </div>
                    <!-- Reply Body -->
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5 mb-0.5">
                        <span class="text-xs font-medium text-gray-600 dark:text-gray-400">{{ reply.nickName }}</span>
                        <span v-if="reply.location" class="text-[10px] text-gray-400 dark:text-gray-500">{{ reply.location }}</span>
                      </div>
                      <p class="text-gray-700 dark:text-gray-300 leading-relaxed break-words whitespace-pre-wrap">{{ reply.comment }}</p>
                      <div class="flex items-center gap-3 mt-1">
                        <span class="text-[10px] text-gray-400 dark:text-gray-500">{{ formatTime(reply.createAt) }}</span>
                        <div v-if="reply.like && reply.like > 0" class="flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                          <Heart class="h-3 w-3" :stroke-width="2" />
                          <span>{{ formatLike(reply.like) }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </Transition>
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
    </transition>
  </Teleport>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 二级评论展开/收起过渡 */
.reply-collapse-enter-active {
  transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.reply-collapse-leave-active {
  transition: max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.reply-collapse-enter-from {
  max-height: 0;
  opacity: 0;
  transform: translateY(-8px);
}
.reply-collapse-enter-to,
.reply-collapse-leave-from {
  max-height: 1000px;
  opacity: 1;
  transform: translateY(0);
}
.reply-collapse-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}
</style>
