<script setup lang="ts">
import { X, Trash2 } from 'lucide-vue-next';

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
    <Transition name="plugin-detail">
      <div
        v-if="visible"
        class="fixed inset-0 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        :class="overlayZClass"
        @click.self="$emit('cancel')"
      >
        <div class="plugin-detail-card">
          <div class="plugin-detail-header">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-red-500/12 flex items-center justify-center shrink-0 text-red-500">
                <Trash2 class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="text-sm font-semibold text-gray-800 dark:text-gray-100">{{ title }}</div>
                <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5">此操作不可撤销</div>
              </div>
            </div>
            <button
              type="button"
              class="plugin-detail-close"
              aria-label="关闭"
              @click="$emit('cancel')"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="plugin-detail-body">
            <p class="text-sm text-gray-600 dark:text-white/70 leading-relaxed">
              <slot />
            </p>
            <div class="flex justify-end gap-2 pt-1">
              <button
                type="button"
                class="settings-plugin-button settings-plugin-button--ghost"
                @click="$emit('cancel')"
              >
                取消
              </button>
              <button
                type="button"
                class="settings-plugin-button settings-plugin-button--danger"
                @click="$emit('confirm')"
              >
                <Trash2 class="h-4 w-4" />
                {{ confirmText }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
