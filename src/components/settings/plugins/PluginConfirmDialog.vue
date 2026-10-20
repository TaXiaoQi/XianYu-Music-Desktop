<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next';

defineProps<{
  visible: boolean;
  title: string;
  confirmText: string;
  overlayZClass?: string;
}>();

defineEmits<{
  (e: 'cancel'): void;
  (e: 'confirm'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="plugin-confirm" appear>
      <div
        v-if="visible"
        class="plugin-confirm-overlay"
        :class="overlayZClass"
        @click.self="$emit('cancel')"
      >
        <div class="plugin-confirm-card">
          <div class="plugin-confirm-icon">
            <Trash2 class="h-6 w-6" />
          </div>
          <h3 class="plugin-confirm-title">{{ title }}</h3>
          <div class="plugin-confirm-subtitle">此操作不可撤销</div>
          <p class="plugin-confirm-desc">
            <slot />
          </p>
          <div class="plugin-confirm-actions">
            <button
              type="button"
              class="plugin-confirm-btn plugin-confirm-btn--ghost"
              @click="$emit('cancel')"
            >
              取消
            </button>
            <button
              type="button"
              class="plugin-confirm-btn plugin-confirm-btn--danger"
              @click="$emit('confirm')"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 与 ProfileLimitDialog（更换头像提示）一致的标准弹窗样式：
   上半部毛玻璃半透卡片 + 下半部浅色色块按钮区 */
.plugin-confirm-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.4);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

.plugin-confirm-card {
  width: min(90vw, 400px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.8);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: #1f2937;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 24px 22px 20px;
  text-align: center;
}

:global(.dark) .plugin-confirm-card {
  background: rgba(31, 33, 38, 0.82);
  border-color: rgba(255, 255, 255, 0.08);
  color: #f3f4f6;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.plugin-confirm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: 0 auto 14px;
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.1);
  color: #ec4141;
}

.plugin-confirm-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2937;
}

:global(.dark) .plugin-confirm-title {
  color: #f3f4f6;
}

.plugin-confirm-subtitle {
  margin-top: 4px;
  font-size: 0.72rem;
  color: rgba(156, 163, 175, 0.95);
}

.plugin-confirm-desc {
  margin: 10px 0 0;
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(75, 85, 99, 0.9);
}

:global(.dark) .plugin-confirm-desc {
  color: rgba(209, 213, 219, 0.85);
}

.plugin-confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: 10px;
  margin: 20px -22px -20px;
  padding: 12px 22px;
  background: rgba(249, 250, 251, 0.5);
  border-radius: 0 0 16px 16px;
}

:global(.dark) .plugin-confirm-actions {
  background: rgba(255, 255, 255, 0.05);
}

.plugin-confirm-btn {
  height: 38px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 600;
  transition: transform 140ms ease, opacity 140ms ease, background-color 140ms ease;
}

.plugin-confirm-btn:active {
  transform: scale(0.97);
}

.plugin-confirm-btn--ghost {
  background: rgba(255, 255, 255, 0.72);
  color: #4b5563;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}

.plugin-confirm-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.92);
}

:global(.dark) .plugin-confirm-btn--ghost {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(229, 231, 235, 0.9);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

:global(.dark) .plugin-confirm-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.14);
}

.plugin-confirm-btn--danger {
  background: #ec4141;
  color: #fff;
  box-shadow: 0 6px 18px rgba(236, 65, 65, 0.32);
}

.plugin-confirm-btn--danger:hover {
  background: #dc3535;
}

/* 过渡动画（与其他弹窗一致） */
.plugin-confirm-enter-active,
.plugin-confirm-leave-active {
  transition: opacity 180ms ease;
}

.plugin-confirm-enter-active .plugin-confirm-card,
.plugin-confirm-leave-active .plugin-confirm-card {
  transition: transform 200ms cubic-bezier(0.34, 1.4, 0.64, 1), opacity 180ms ease;
}

.plugin-confirm-enter-from,
.plugin-confirm-leave-to {
  opacity: 0;
}

.plugin-confirm-enter-from .plugin-confirm-card,
.plugin-confirm-leave-to .plugin-confirm-card {
  opacity: 0;
  transform: scale(0.92) translateY(10px);
}
</style>
