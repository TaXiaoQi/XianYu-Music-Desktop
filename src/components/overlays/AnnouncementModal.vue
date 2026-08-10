<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { Announcement } from '../../utils/announcement';

const props = defineProps<{
  visible: boolean;
  announcement: Announcement | null;
}>();

const emit = defineEmits(['close', 'action']);

const contentBodyRef = ref<HTMLElement | null>(null);
const scrolledToEnd = ref(false);

const handleClose = () => {
  if (!scrolledToEnd.value) return;
  emit('close');
};

const refreshScrollState = () => {
  const el = contentBodyRef.value;
  if (!el) return;
  const hasScrollableContent = el.scrollHeight > el.clientHeight + 4;
  if (!hasScrollableContent) {
    scrolledToEnd.value = true;
    return;
  }
  scrolledToEnd.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
};

watch(
  () => `${props.visible ? '1' : '0'}:${props.announcement?.id ?? ''}:${props.announcement?.updatedAt ?? ''}`,
  async () => {
    scrolledToEnd.value = false;
    await nextTick();
    refreshScrollState();
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <transition name="announcement-modal" appear>
      <div
        v-if="visible && announcement"
        class="announcement-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[2px] select-none"
      >
        <div
          class="announcement-card bg-white dark:bg-[#262626] rounded-2xl shadow-2xl w-[420px] max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden"
        >
          <!-- Header -->
          <div class="px-6 pt-6 pb-3 flex items-center gap-3 shrink-0">
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              :class="{
                'bg-blue-100 dark:bg-blue-900/30': announcement.type === 'info',
                'bg-amber-100 dark:bg-amber-900/30': announcement.type === 'warning',
                'bg-green-100 dark:bg-green-900/30': announcement.type === 'update',
              }"
            >
              <!-- info icon -->
              <svg
                v-if="announcement.type === 'info'"
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 text-blue-500"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zm-1 9a1 1 0 01-1-1v-4a1 1 0 112 0v4a1 1 0 01-1 1z"
                  clip-rule="evenodd"
                />
              </svg>
              <!-- warning icon -->
              <svg
                v-else-if="announcement.type === 'warning'"
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 text-amber-500"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
              <!-- update icon -->
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 text-green-500"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
            <div class="min-w-0">
              <h3 class="text-base font-bold text-gray-800 dark:text-gray-100 truncate">
                {{ announcement.title }}
              </h3>
              <p v-if="announcement.date" class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {{ announcement.date }}
              </p>
            </div>
          </div>

          <!-- Content -->
          <div
            ref="contentBodyRef"
            class="px-6 pb-5 flex-1 min-h-0 overflow-y-auto"
            @scroll="refreshScrollState"
          >
            <p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">
              {{ announcement.content }}
            </p>
          </div>

          <!-- Actions -->
          <div class="border-t border-gray-100 dark:border-white/10 shrink-0">
            <div
              v-if="!scrolledToEnd"
              class="px-5 pt-3 text-center text-xs text-gray-400 dark:text-gray-500"
            >
              请先阅读并滚动到公告底部
            </div>
            <button
              @click="handleClose"
              :disabled="!scrolledToEnd"
              class="w-full py-3 text-sm transition-colors focus:outline-none"
              :class="scrolledToEnd
                ? 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5'
                : 'cursor-not-allowed text-gray-300 dark:text-gray-600'"
            >
              {{ scrolledToEnd ? '我已阅读并确认' : '阅读到底后可确认' }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
/* ==================== 基础过渡（供 is-closing 使用） ==================== */
.announcement-overlay {
  transition: opacity 0.2s ease;
}

.announcement-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ==================== 进入动画（<Transition> 驱动） ==================== */
.announcement-modal-enter-active {
  transition: opacity 0.2s ease;
}

.announcement-modal-enter-active .announcement-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.announcement-modal-enter-from {
  opacity: 0;
}

.announcement-modal-enter-from .announcement-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

/* ==================== 离开动画（is-closing 类驱动） ==================== */
.announcement-overlay.is-closing {
  opacity: 0;
}

.announcement-card.is-closing {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>
