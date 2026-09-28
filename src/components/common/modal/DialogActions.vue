<script setup lang="ts">
import { computed } from 'vue';

interface DialogActionProps {
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual accent of the primary button. */
  tone?: 'danger' | 'info' | 'brand';
  /** Disables the primary button (used by the text-input dialog). */
  confirmBlocked?: boolean;
}

const props = withDefaults(defineProps<DialogActionProps>(), {
  tone: 'info',
});

const emit = defineEmits<{
  confirm: [];
  dismiss: [];
}>();

const toneSkin: Record<'danger' | 'info' | 'brand', string> = {
  danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
  info: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
  brand: 'bg-[#EC4141] hover:bg-red-600 focus:ring-[#EC4141] disabled:cursor-not-allowed disabled:opacity-50',
};

const confirmSkin = computed(() => toneSkin[props.tone]);
</script>

<template>
  <div class="flex flex-col gap-3 bg-gray-50/50 px-4 py-3 dark:bg-white/5 sm:flex-row-reverse">
    <button
      class="inline-flex w-full justify-center rounded-xl border border-transparent px-4 py-2 text-base font-medium text-white shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 sm:text-sm"
      :class="confirmSkin"
      :disabled="confirmBlocked"
      @click="emit('confirm')"
    >
      {{ confirmLabel || '确定' }}
    </button>
    <button
      class="inline-flex w-full justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 sm:text-sm"
      @click="emit('dismiss')"
    >
      {{ cancelLabel || '取消' }}
    </button>
  </div>
</template>
