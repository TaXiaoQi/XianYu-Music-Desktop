<script setup lang="ts">
import type { LxUpdateAlert } from '../../composables/useLxUpdateAlert';

defineProps<{
  visible: boolean;
  alert: LxUpdateAlert | null;
  isUpdating: boolean;
}>();

defineEmits(['close', 'confirm']);
</script>

<template>
  <Teleport to="body">
    <transition name="lx-update-alert" appear>
      <div
        v-if="visible && alert"
        class="lx-update-alert-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm select-none"
        @click.self="$emit('close')"
      >
        <div class="lx-update-alert-card">
          <div class="lx-update-alert-icon">
            <svg
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
          <h3 class="lx-update-alert-title">音源插件更新</h3>
          <p class="lx-update-alert-subtitle">
            {{ alert.pluginName || '音源插件' }} 自报有新版本可用
          </p>

          <div class="lx-update-alert-log">{{ alert.log }}</div>

          <div class="lx-update-alert-footer">
            <button
              type="button"
              class="lx-update-alert-btn lx-update-alert-btn--secondary"
              :disabled="isUpdating"
              @click="$emit('close')"
            >
              稍后
            </button>
            <button
              v-if="alert.updateUrl"
              type="button"
              class="lx-update-alert-btn lx-update-alert-btn--primary"
              :disabled="isUpdating"
              @click="$emit('confirm')"
            >
              {{ isUpdating ? '更新中…' : '立即更新' }}
            </button>
            <button
              v-else
              type="button"
              class="lx-update-alert-btn lx-update-alert-btn--primary"
              @click="$emit('close')"
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.lx-update-alert-overlay {
  transition: opacity 0.2s ease;
}

.lx-update-alert-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.lx-update-alert-enter-active {
  transition: opacity 0.2s ease;
}

.lx-update-alert-enter-active .lx-update-alert-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.lx-update-alert-enter-from {
  opacity: 0;
}

.lx-update-alert-enter-from .lx-update-alert-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

.lx-update-alert-leave-active {
  transition: opacity 0.2s ease;
}

.lx-update-alert-leave-active .lx-update-alert-card {
  transition: opacity 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.lx-update-alert-leave-to {
  opacity: 0;
}

.lx-update-alert-leave-to .lx-update-alert-card {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
</style>

<style>
/* ==================== 主弹窗 ==================== */
.lx-update-alert-card {
  width: min(90vw, 400px);
  background: rgba(255, 255, 255, 0.8);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: #1f2937;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 24px 22px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.dark .lx-update-alert-card {
  background: rgba(31, 41, 55, 0.85);
  color: #e5e7eb;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.lx-update-alert-icon {
  width: 48px;
  height: 48px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
  margin-bottom: 12px;
}

.dark .lx-update-alert-icon {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.16);
}

.lx-update-alert-title {
  font-size: 17px;
  font-weight: 700;
  text-align: center;
}

.lx-update-alert-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: #6b7280;
  text-align: center;
}

.dark .lx-update-alert-subtitle {
  color: #9ca3af;
}

.lx-update-alert-log {
  width: 100%;
  margin-top: 14px;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.6;
  color: #374151;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 10px;
  padding: 12px 14px;
}

.dark .lx-update-alert-log {
  color: #d1d5db;
  background: rgba(255, 255, 255, 0.06);
}

.lx-update-alert-footer {
  margin-top: 18px;
  width: 100%;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.lx-update-alert-btn {
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  transition: opacity 0.15s ease, transform 0.15s ease;
  cursor: pointer;
}

.lx-update-alert-btn:active {
  transform: scale(0.97);
}

.lx-update-alert-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.lx-update-alert-btn--secondary {
  background: rgba(0, 0, 0, 0.06);
  color: inherit;
}

.dark .lx-update-alert-btn--secondary {
  background: rgba(255, 255, 255, 0.1);
}

.lx-update-alert-btn--primary {
  background: #2563eb;
  color: #fff;
}

.lx-update-alert-btn--primary:hover:not(:disabled) {
  background: #1d4ed8;
}
</style>
