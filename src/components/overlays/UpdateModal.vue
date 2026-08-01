<script setup lang="ts">
import type { ServerUpdateInfo } from '../../utils/update';
import { APP_VERSION } from '../../../version';

defineProps<{
  visible: boolean;
  update: ServerUpdateInfo | null;
}>();

const emit = defineEmits(['close', 'download']);
</script>

<template>
  <Teleport to="body">
    <transition name="update-modal">
      <div
        v-if="visible && update"
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[2px] select-none"
        @click.self="emit('close')"
      >
        <div
          class="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-[420px] max-w-[90vw] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        >
          <!-- Header -->
          <div class="px-6 pt-6 pb-3 flex items-center gap-3">
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
          <div class="px-6 pb-5">
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
          <div class="flex border-t border-gray-100 dark:border-white/10">
            <button
              @click="emit('close')"
              class="flex-1 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors focus:outline-none"
            >
              稍后
            </button>
            <div class="w-[1px] bg-gray-100 dark:bg-white/10"></div>
            <button
              @click="emit('download')"
              class="flex-1 py-3 text-sm text-[#EC4141] font-medium hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors focus:outline-none"
            >
              前往下载
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.update-modal-enter-active,
.update-modal-leave-active {
  transition: opacity 0.2s ease;
}

.update-modal-enter-active > div,
.update-modal-leave-active > div {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.update-modal-enter-from,
.update-modal-leave-to {
  opacity: 0;
}

.update-modal-enter-from > div {
  transform: scale(0.95);
}

.update-modal-leave-to > div {
  transform: scale(0.95);
}
</style>
