<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
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
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const handleClose = () => {
  if (isClosing.value) return;
  isClosing.value = true;
  closeTimer = setTimeout(() => {
    emit('close');
    closeTimer = null;
  }, 220);
};

onUnmounted(() => {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
});

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
        class="update-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm select-none"
        :class="{ 'is-closing': isClosing }"
        @click.self="!isDownloading && handleClose()"
      >
        <div class="update-card" :class="{ 'is-closing': isClosing }">
          <div class="update-icon">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z"
                clip-rule="evenodd"
              />
            </svg>
          </div>
          <h3 class="update-title">发现新版本 v{{ update.version }}</h3>
          <p class="update-version">当前版本 v{{ APP_VERSION }}</p>

          <div class="update-content">
            <p v-if="update.updateContent" class="update-desc">
              {{ update.updateContent }}
            </p>
            <p v-else class="update-desc">
              有新版本可用，建议更新以获取最新功能与修复。
            </p>
          </div>

          <div v-if="isDownloading" class="update-progress-block">
            <div class="update-progress-info">
              <span class="update-progress-label">正在下载更新…</span>
              <span class="update-progress-value">
                {{ progress && progress.total > 0
                  ? formatBytes(progress.downloaded) + ' / ' + formatBytes(progress.total)
                  : formatBytes(progress?.downloaded ?? 0) }}
              </span>
            </div>
            <div class="update-progress-track">
              <div
                class="update-progress-bar"
                :style="{ width: (progress?.progress ?? 0) + '%' }"
              ></div>
            </div>
            <div class="update-progress-meta">
              <span class="update-speed">{{ formatSpeed(progress?.speed ?? 0) }}</span>
              <span class="update-percent">{{ (progress?.progress ?? 0).toFixed(1) }}%</span>
            </div>
          </div>

          <div v-else class="update-actions">
            <button type="button" class="update-btn update-btn--ghost" @click="handleClose">
              稍后
            </button>
            <button type="button" class="update-btn update-btn--primary" @click="emit('download')">
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

<!-- 深色模式使用非 scoped style 块，原因同 SettingsConflictDialog -->
<style>
/* ==================== 主弹窗 ==================== */
.update-card {
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

.update-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  margin: 0 auto 14px;
}

.update-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 6px;
}

.update-version {
  font-size: 0.78rem;
  color: rgba(107, 114, 128, 0.85);
  margin: 0 0 16px;
}

.update-content {
  margin-bottom: 18px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
  max-height: 40vh;
  overflow-y: auto;
  text-align: left;
}

.update-desc {
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
  margin: 0;
  white-space: pre-line;
}

.update-progress-block {
  margin-bottom: 18px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
}

.update-progress-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.update-progress-label {
  font-size: 0.78rem;
  color: rgba(107, 114, 128, 0.85);
}

.update-progress-value {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(55, 65, 81, 0.9);
}

.update-progress-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.update-progress-bar {
  height: 100%;
  background: #EC4141;
  border-radius: 999px;
  transition: width 150ms ease-out;
}

.update-progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.update-speed {
  font-size: 0.72rem;
  color: rgba(107, 114, 128, 0.85);
}

.update-percent {
  font-size: 0.72rem;
  font-weight: 600;
  color: #EC4141;
}

.update-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 18px -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}

.update-btn {
  flex: 1;
  height: 40px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 100ms ease;
  border: 1px solid transparent;
}

.update-btn:active {
  transform: scale(0.97);
}

.update-btn--ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: transparent;
  color: rgba(100, 116, 139, 0.9);
}

.update-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.04);
  color: rgb(31, 41, 55);
}

.update-btn--primary {
  background: #EC4141;
  color: #ffffff;
}

.update-btn--primary:hover {
  background: #d13b3b;
}

/* ==================== 深色模式 ==================== */
html.dark .update-card {
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.2);
}

html.dark .update-actions {
  background: rgba(255, 255, 255, 0.05);
}

html.dark .update-icon {
  background: rgba(52, 211, 153, 0.18);
  color: #34d399;
}

html.dark .update-title {
  color: rgba(255, 255, 255, 0.96);
}

html.dark .update-version {
  color: rgba(255, 255, 255, 0.45);
}

html.dark .update-content {
  background: rgba(255, 255, 255, 0.04);
}

html.dark .update-desc {
  color: rgba(255, 255, 255, 0.6);
}

html.dark .update-progress-block {
  background: rgba(255, 255, 255, 0.04);
}

html.dark .update-progress-track {
  background: rgba(255, 255, 255, 0.1);
}

html.dark .update-progress-label {
  color: rgba(255, 255, 255, 0.55);
}

html.dark .update-progress-value {
  color: rgba(255, 255, 255, 0.85);
}

html.dark .update-speed {
  color: rgba(255, 255, 255, 0.45);
}

html.dark .update-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

html.dark .update-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.96);
}

html.dark .update-btn--primary {
  background: #EC4141;
  color: #ffffff;
}

html.dark .update-btn--primary:hover {
  background: #d13b3b;
}
</style>