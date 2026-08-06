<script setup lang="ts">
import { ref } from 'vue';
import type { ServerUpdateInfo } from '../../utils/update';
import type { DownloadProgressData } from '../../composables/useUpdateCheck';
import { APP_VERSION } from '../../../version';

defineProps<{
  visible: boolean;
  update: ServerUpdateInfo | null;
  isDownloading?: boolean;
  progress?: DownloadProgressData;
}>();

const emit = defineEmits(['close', 'download']);

// --- 淡出动画 ---
const isClosing = ref(false);

const handleClose = () => {
  if (isClosing.value) return;
  isClosing.value = true;
  setTimeout(() => {
    emit('close');
  }, 220);
};

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
};

const formatSpeed = (speed: number) => {
  if (!speed || speed <= 0) return '0 MB/s';
  const mb = speed / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB/s` : `${mb.toFixed(1)} MB/s`;
};
</script>

<template>
  <Teleport to="body">
    <transition name="update-modal" appear>
      <div
        v-if="visible && update"
        class="update-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[2px] select-none"
        :class="{ 'is-closing': isClosing }"
        @click.self="!isDownloading && handleClose()"
      >
        <div
          class="update-card bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-[420px] max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden"
          :class="{ 'is-closing': isClosing }"
        >
          <!-- Header -->
          <div class="px-6 pt-6 pb-3 flex items-center gap-3 shrink-0">
            <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-green-100 dark:bg-green-900/30">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
            <div class="min-w-0">
              <h3 class="text-base font-bold text-gray-800 dark:text-gray-100 truncate">
                发现新版本 v{{ update.version }}
              </h3>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                当前版本 v{{ APP_VERSION }}
              </p>
            </div>
          </div>

          <!-- Content -->
          <div class="px-6 pb-5 flex-1 min-h-0 overflow-y-auto">
            <p
              v-if="update.updateContent"
              class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line"
            >
              {{ update.updateContent }}
            </p>
            <p v-else class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              有新版本可用，建议更新以获取最新功能与修复。
            </p>
          </div>

          <!-- Actions -->
          <div v-if="isDownloading" class="px-6 py-4 border-t border-gray-100 dark:border-white/10 shrink-0">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs text-gray-500 dark:text-gray-400">正在下载更新…</span>
              <span class="text-xs font-medium text-gray-700 dark:text-gray-200">
                {{ progress && progress.total > 0
                  ? formatBytes(progress.downloaded) + ' / ' + formatBytes(progress.total)
                  : formatBytes(progress?.downloaded ?? 0) }}
              </span>
            </div>
            <div class="w-full h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                class="h-full bg-[#EC4141] rounded-full transition-all duration-150 ease-out"
                :style="{ width: (progress?.progress ?? 0) + '%' }"
              ></div>
            </div>
            <div class="flex items-center justify-between mt-2">
              <span class="text-xs text-gray-400 dark:text-gray-500">{{ formatSpeed(progress?.speed ?? 0) }}</span>
              <span class="text-xs font-medium text-[#EC4141]">{{ (progress?.progress ?? 0).toFixed(1) }}%</span>
            </div>
          </div>
          <div v-else class="flex border-t border-gray-100 dark:border-white/10 shrink-0">
            <button
              @click="handleClose"
              class="flex-1 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors focus:outline-none"
            >
              稍后
            </button>
            <div class="w-[1px] bg-gray-100 dark:bg-white/10"></div>
            <button
              @click="emit('download')"
              class="flex-1 py-3 text-sm text-[#EC4141] font-medium hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors focus:outline-none"
            >
              立即更新
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
/* ==================== 基础过渡（供 is-closing 使用） ==================== */
.update-overlay {
  transition: opacity 0.2s ease;
}

.update-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ==================== 进入动画（<Transition> 驱动） ==================== */
.update-modal-enter-active {
  transition: opacity 0.2s ease;
}

.update-modal-enter-active .update-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.update-modal-enter-from {
  opacity: 0;
}

.update-modal-enter-from .update-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

/* ==================== 离开动画（is-closing 类驱动） ==================== */
.update-overlay.is-closing {
  opacity: 0;
}

.update-card.is-closing {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>
