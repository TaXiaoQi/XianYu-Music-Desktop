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
        class="announcement-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm select-none"
      >
        <div class="announcement-card">
          <div
            class="announcement-icon"
            :class="{
              'announcement-icon--info': announcement.type === 'info',
              'announcement-icon--warning': announcement.type === 'warning',
              'announcement-icon--update': announcement.type === 'update',
            }"
          >
            <!-- info icon -->
            <svg
              v-if="announcement.type === 'info'"
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6"
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
              class="h-6 w-6"
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
              class="h-6 w-6"
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
          <h3 class="announcement-title">{{ announcement.title }}</h3>
          <p v-if="announcement.date" class="announcement-date">{{ announcement.date }}</p>

          <div
            ref="contentBodyRef"
            class="announcement-content"
            @scroll="refreshScrollState"
          >
            <p class="announcement-desc">
              {{ announcement.content }}
            </p>
          </div>

          <div class="announcement-footer">
            <div v-if="!scrolledToEnd" class="announcement-hint">
              请先阅读并滚动到公告底部
            </div>
            <button
              type="button"
              class="announcement-btn"
              :class="{ 'announcement-btn--disabled': !scrolledToEnd }"
              @click="handleClose"
              :disabled="!scrolledToEnd"
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
/* ==================== 基础过渡 ==================== */
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

.announcement-modal-leave-active {
  transition: opacity 0.2s ease;
}

.announcement-modal-leave-active .announcement-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.announcement-modal-leave-to {
  opacity: 0;
}

.announcement-modal-leave-to .announcement-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<!-- 深色模式使用非 scoped style 块，原因同 SettingsConflictDialog -->
<style>
/* ==================== 主弹窗 ==================== */
.announcement-card {
  width: min(90vw, 400px);
  background: rgba(255, 255, 255, 0.8);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 24px 22px 20px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.announcement-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  margin: 0 auto 14px;
}

.announcement-icon--info {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}

.announcement-icon--warning {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.announcement-icon--update {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.announcement-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 4px;
}

.announcement-date {
  font-size: 0.72rem;
  color: rgba(107, 114, 128, 0.85);
  margin: 0 0 16px;
}

.announcement-content {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
  max-height: 40vh;
  overflow-y: auto;
  text-align: left;
}

.announcement-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0;
  white-space: pre-line;
}

.announcement-footer {
  margin: 16px -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}

.announcement-hint {
  font-size: 0.72rem;
  color: rgba(107, 114, 128, 0.7);
  margin-bottom: 8px;
}

.announcement-btn {
  width: 100%;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: #1f2937;
  color: #ffffff;
  transition: background-color 160ms ease, color 160ms ease, transform 100ms ease;
}

.announcement-btn:not(:disabled):hover {
  background: #111827;
}

.announcement-btn:not(:disabled):active {
  transform: scale(0.97);
}

.announcement-btn--disabled {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(107, 114, 128, 0.5);
  cursor: not-allowed;
}

/* ==================== 深色模式 ==================== */
html.dark .announcement-card {
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
}

html.dark .announcement-icon--info {
  background: rgba(96, 165, 250, 0.18);
  color: #93c5fd;
}

html.dark .announcement-icon--warning {
  background: rgba(251, 191, 36, 0.18);
  color: #fbbf24;
}

html.dark .announcement-icon--update {
  background: rgba(52, 211, 153, 0.18);
  color: #34d399;
}

html.dark .announcement-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .announcement-date {
  color: rgba(255, 255, 255, 0.45);
}

html.dark .announcement-content {
  background: rgba(255, 255, 255, 0.04);
}

html.dark .announcement-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .announcement-hint {
  color: rgba(255, 255, 255, 0.45);
}

html.dark .announcement-footer {
  background: rgba(255, 255, 255, 0.05);
}

html.dark .announcement-btn {
  background: rgba(255, 255, 255, 0.9);
  color: #262626;
}

html.dark .announcement-btn:not(:disabled):hover {
  background: rgba(255, 255, 255, 1);
}

html.dark .announcement-btn--disabled {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.35);
}
</style>