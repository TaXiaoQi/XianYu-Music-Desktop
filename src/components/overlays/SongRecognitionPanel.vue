<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Mic, X, Music2, Play, Heart, ListPlus, RotateCcw, Loader2 } from 'lucide-vue-next';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useCollectionsStore } from '../../features/collections/store';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { cacheLxSong } from '../../services/lxSongCache';
import {
  recognizeSystemAudio,
  cancelRecognizeSystemAudio,
  buildRecognizeSong,
  RECOGNIZE_MAX_SECONDS,
  RECOGNIZE_CANCELLED,
  type RecognizeMatch,
} from '../../services/recognize';

const emit = defineEmits<{ (e: 'close'): void }>();

const { playSong } = usePlaybackController();
const collectionsStore = useCollectionsStore();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();

// ==================== 状态 ====================
type RecStatus = 'idle' | 'recording' | 'recognizing' | 'success' | 'failed';
const status = ref<RecStatus>('idle');
const matches = ref<RecognizeMatch[]>([]);
const errorMsg = ref('');
const recordingSeconds = ref(0);

// ==================== 动画状态 ====================
const isEntering = ref(true);
const isClosing = ref(false);
const ANIM_DURATION = 200;

let recordingTimer: ReturnType<typeof setInterval> | null = null;

const isActive = computed(() => status.value === 'recording' || status.value === 'recognizing');
const statusText = computed(() => {
  switch (status.value) {
    case 'recording':
      return `正在聆听… ${recordingSeconds.value}/${RECOGNIZE_MAX_SECONDS}s`;
    case 'recognizing':
      return '识别中…';
    case 'failed':
      return errorMsg.value || '识别失败';
    case 'success':
      return `识别到 ${matches.value.length} 首匹配`;
    default:
      return '点击麦克风开始识别';
  }
});

// ==================== 关闭逻辑（带退出动画） ====================
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function handleClose() {
  if (isClosing.value) return;
  // 录音/识别中不允许关闭
  if (status.value === 'recording' || status.value === 'recognizing') return;
  isClosing.value = true;
  closeTimer = setTimeout(() => {
    emit('close');
    closeTimer = null;
  }, ANIM_DURATION);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    handleClose();
  }
}

// ==================== 系统音频识别（WASAPI Loopback） ====================

/**
 * 一键无感识别
 *
 * 调用后端 recognize_system_audio 命令，由 Rust 用 WASAPI Loopback
 * 直接捕获系统音频输出（10 秒）并重采样为 PCM 后调用酷狗识别接口。
 * 前端仅负责 UI 动画：显示 10 秒录音倒计时，结束后切换到"识别中…"。
 */
async function startRecognition() {
  if (isActive.value) return;
  // 重置状态
  matches.value = [];
  errorMsg.value = '';
  recordingSeconds.value = 0;
  status.value = 'recording';

  // 启动 UI 倒计时（纯前端动画，与后端捕获并行执行）
  recordingTimer = setInterval(() => {
    recordingSeconds.value++;
    if (recordingSeconds.value >= RECOGNIZE_MAX_SECONDS) {
      if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
      }
      // 倒计时结束，切换到识别中状态（后端可能还在捕获或已开始识别请求）
      if (status.value === 'recording') {
        status.value = 'recognizing';
      }
    }
  }, 1000);

  try {
    // 后端捕获系统音频并识别（约 10 秒捕获 + 1~2 秒识别请求）
    const results = await recognizeSystemAudio();
    if (results.length > 0) {
      matches.value = results;
      status.value = 'success';
    } else {
      status.value = 'failed';
      errorMsg.value = '未识别到歌曲，请确认系统正在播放音乐';
    }
  } catch (err) {
    // 用户主动取消时不显示错误
    if (err instanceof Error && err.message === RECOGNIZE_CANCELLED) {
      return;
    }
    status.value = 'failed';
    errorMsg.value = err instanceof Error ? err.message : '识别过程出错';
    console.error('[Recognize] 识别失败:', err);
  } finally {
    if (recordingTimer) {
      clearInterval(recordingTimer);
      recordingTimer = null;
    }
  }
}

function stopRecording() {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
  // 通知 Rust 后端取消正在进行的音频捕获
  void cancelRecognizeSystemAudio().catch(() => { /* 忽略取消命令失败 */ });
  // 用户主动停止时回到 idle（后端命令被取消后 Promise 会 reject）
  if (status.value === 'recording') {
    status.value = 'idle';
    recordingSeconds.value = 0;
  }
}

function toggleListening() {
  if (status.value === 'recording') {
    stopRecording();
  } else if (status.value !== 'recognizing') {
    void startRecognition();
  }
}

function resetAndRestart() {
  stopRecording();
  status.value = 'idle';
  matches.value = [];
  errorMsg.value = '';
  recordingSeconds.value = 0;
}

// ==================== 结果操作 ====================

function distPercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function handlePlay(match: RecognizeMatch) {
  // 缓存 LX 元信息，供 playerPlayback 解析播放链接时使用
  cacheLxSong(match.song);
  const song = buildRecognizeSong(match);
  void playSong(song, { insertAfterCurrent: true });
  emit('close');
}

function isFavorite(match: RecognizeMatch): boolean {
  const song = buildRecognizeSong(match);
  return collectionsStore.isFavoritePath(song.path);
}

function handleFavorite(match: RecognizeMatch) {
  const song = buildRecognizeSong(match);
  const isFav = collectionsStore.toggleFavoritePath(song.path);
  if (isFav) {
    // 在线歌曲不在本地库，需保存完整元信息以便列表展示与播放
    collectionsStore.setFavoriteSongMeta(song.path, song);
  } else {
    collectionsStore.removeFavoriteSongMeta(song.path);
  }
}

function handleAddToPlaylist(match: RecognizeMatch) {
  const song = buildRecognizeSong(match);
  cacheLxSong(match.song);
  openAddToPlaylistDialog([song.path], { songs: [song] });
  emit('close');
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  // 进入动画：首帧设为 scale-95 + opacity-0，下一帧恢复到正常状态触发 CSS transition
  requestAnimationFrame(() => {
    isEntering.value = false;
  });
});

onUnmounted(() => {
  stopRecording();
  document.removeEventListener('keydown', handleKeydown);
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      :class="{ 'pointer-events-none': isClosing }"
    >
      <!-- 背景遮罩 -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ease-out"
        :class="isEntering || isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <!-- 面板 -->
      <div
        class="song-recognition-panel relative w-[34rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-black/5 bg-white/90 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/90 overflow-hidden transform transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        :class="isEntering || isClosing
          ? 'scale-95 opacity-0 translate-y-4'
          : 'scale-100 opacity-100 translate-y-0'"
      >
        <!-- 头部 -->
        <div class="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/5">
          <div class="flex items-center gap-2">
            <Mic class="h-4 w-4 text-[#EC4141]" :stroke-width="2.2" />
            <span class="text-sm font-bold text-gray-900 dark:text-gray-100">听歌识曲</span>
          </div>
          <button
            class="cursor-pointer text-gray-400 transition-colors hover:text-[#EC4141]"
            @click="handleClose"
            aria-label="关闭"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- 主体：录音/识别/失败状态 -->
        <div
          v-if="status !== 'success'"
          class="flex flex-col items-center px-6 py-7"
        >
          <!-- 麦克风按钮 -->
          <button
            class="relative flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300 cursor-pointer"
            :class="status === 'recording'
              ? 'bg-[#EC4141] text-white shadow-[0_0_24px_rgba(236,65,65,0.5)]'
              : status === 'recognizing'
                ? 'bg-[#EC4141]/10 text-[#EC4141] cursor-wait'
                : 'bg-[#EC4141]/10 text-[#EC4141] hover:bg-[#EC4141]/20'"
            @click="toggleListening"
            :disabled="status === 'recognizing'"
            :aria-label="status === 'recording' ? '停止识别' : '开始识别'"
          >
            <!-- 脉冲环 -->
            <span
              v-if="status === 'recording'"
              class="absolute inset-0 rounded-full bg-[#EC4141] opacity-30 animate-ping"
            ></span>
            <Loader2 v-if="status === 'recognizing'" class="relative h-8 w-8 animate-spin" :stroke-width="2.2" />
            <Mic v-else class="relative h-8 w-8" :stroke-width="2.2" />
          </button>

          <!-- 状态文字 -->
          <p class="mt-5 text-sm font-medium text-gray-700 dark:text-gray-200">
            {{ statusText }}
          </p>

          <!-- 波形动画（录音中） -->
          <div class="mt-4 flex h-8 items-center gap-1">
            <span
              v-for="i in 7"
              :key="i"
              class="w-1 rounded-full bg-[#EC4141]"
              :style="{
                height: status === 'recording' ? '100%' : '20%',
                animation: status === 'recording' ? `recog-wave 0.9s ease-in-out ${(i - 1) * 0.09}s infinite` : 'none',
                opacity: status === 'recording' ? 1 : 0.3,
                transition: 'opacity 0.3s, height 0.3s'
              }"
            ></span>
          </div>

          <!-- 提示 -->
          <p class="mt-5 text-center text-xs leading-relaxed text-gray-400 dark:text-gray-500">
            自动捕获系统播放的音频进行识别<br />请先播放音乐，再点击识别按钮
          </p>
        </div>

        <!-- 主体：识别成功结果列表 -->
        <div v-else class="max-h-[calc(100vh-16rem)] overflow-y-auto">
          <div class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 border-b border-black/5 dark:border-white/5 sticky top-0 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl">
            {{ statusText }}
          </div>
          <ul class="py-1">
            <li
              v-for="(match, index) in matches"
              :key="`${match.song.songmid}-${index}`"
              class="flex items-center gap-4 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-default group"
            >
              <!-- 匹配度 -->
              <div class="flex w-16 shrink-0 flex-col items-center">
                <span class="text-base font-bold text-[#EC4141]">{{ distPercent(match.confidence) }}</span>
                <span class="text-[10px] text-gray-400 dark:text-gray-500">匹配度</span>
              </div>

              <!-- 封面 -->
              <div class="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-neutral-800">
                <img
                  v-if="match.song.img"
                  :src="match.song.img"
                  :alt="match.song.name"
                  class="h-full w-full object-cover"
                  referrerpolicy="no-referrer"
                />
                <div v-else class="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600">
                  <Music2 class="h-7 w-7" />
                </div>
              </div>

              <!-- 歌曲信息 -->
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {{ match.song.name }}
                </div>
                <div class="truncate text-xs text-gray-500 dark:text-gray-400">
                  {{ match.song.singer }}
                  <template v-if="match.song.albumName"> · {{ match.song.albumName }}</template>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="flex shrink-0 items-center gap-1">
                <button
                  class="grid h-8 w-8 place-items-center rounded-full text-[#EC4141] hover:bg-[#EC4141]/10 transition-colors cursor-pointer"
                  title="播放"
                  @click="handlePlay(match)"
                >
                  <Play class="h-4 w-4" :stroke-width="2.4" />
                </button>
                <button
                  class="grid h-8 w-8 place-items-center rounded-full transition-colors cursor-pointer"
                  :class="isFavorite(match)
                    ? 'recognition-favorite-btn--active'
                    : 'text-gray-400 recognition-favorite-btn hover:text-[color:var(--favorite-color)] dark:text-gray-500'"
                  :title="isFavorite(match) ? '已收藏' : '收藏'"
                  @click="handleFavorite(match)"
                >
                  <Heart v-if="isFavorite(match)" class="h-4 w-4 fill-current" :stroke-width="2" />
                  <Heart v-else class="h-4 w-4" :stroke-width="2" />
                </button>
                <button
                  class="grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:text-[#EC4141] hover:bg-[#EC4141]/10 dark:text-gray-500 transition-colors cursor-pointer"
                  title="添加到歌单"
                  @click="handleAddToPlaylist(match)"
                >
                  <ListPlus class="h-4 w-4" :stroke-width="2" />
                </button>
              </div>
            </li>
          </ul>

          <!-- 重新识别 -->
          <div class="border-t border-black/5 dark:border-white/5 px-4 py-3">
            <button
              class="flex w-full items-center justify-center gap-2 rounded-lg bg-[#EC4141]/10 py-2 text-sm font-medium text-[#EC4141] transition-colors hover:bg-[#EC4141]/20 cursor-pointer"
              @click="resetAndRestart"
            >
              <RotateCcw class="h-4 w-4" :stroke-width="2.2" />
              重新识别
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
@keyframes recog-wave {
  0%,
  100% {
    transform: scaleY(0.35);
  }
  50% {
    transform: scaleY(1);
  }
}

/* 收藏按钮：颜色固定默认红，不随主题色 */
.recognition-favorite-btn:hover {
  background-color: color-mix(in srgb, var(--favorite-color) 10%, transparent);
}
.recognition-favorite-btn--active {
  color: var(--favorite-color);
  background-color: color-mix(in srgb, var(--favorite-color) 10%, transparent);
}
.recognition-favorite-btn--active:hover {
  background-color: color-mix(in srgb, var(--favorite-color) 15%, transparent);
}
</style>
