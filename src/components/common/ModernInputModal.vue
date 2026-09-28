<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import DialogActions from './modal/DialogActions.vue';
import DialogSurface from './modal/DialogSurface.vue';

interface InputDialogProps {
  visible: boolean; title: string;
  placeholder?: string; initialValue?: string;
  confirmText?: string; cancelText?: string;
}

const props = defineProps<InputDialogProps>();
const emit = defineEmits(['update:visible', 'confirm', 'cancel']);

const CLOSE_ANIMATION_MS = 200;
const draftValue = ref('');
const fieldEl = ref<HTMLInputElement | null>(null);
const fadingOut = ref(false);
let settleTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.visible,
  async (shownNow) => {
    if (!shownNow) return;
    draftValue.value = props.initialValue || '';
    await nextTick();
    fieldEl.value?.focus();
  },
);

const settle = (outcome: 'confirm' | 'cancel') => {
  fadingOut.value = true;
  settleTimer = setTimeout(() => {
    if (outcome === 'confirm') { emit('confirm', draftValue.value.trim()); } else { emit('cancel'); }
    emit('update:visible', false); fadingOut.value = false;
    settleTimer = null;
  }, CLOSE_ANIMATION_MS);
};

const dismiss = () => settle('cancel');
const accept = () => {
  if (!draftValue.value.trim()) return;
  settle('confirm');
};

const onGlobalKeydown = (event: KeyboardEvent) => {
  if (!props.visible) return;
  if (event.key === 'Escape') dismiss();
  if (event.key === 'Enter') accept();
};

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
});
</script>

<template>
  <DialogSurface :shown="visible" :leaving="fadingOut" @backdrop-click="dismiss">
    <div class="px-6 pb-2 pt-6 text-center">
      <h3 class="text-lg font-bold leading-6 text-gray-900 dark:text-white">{{ title }}</h3>
    </div>

    <div class="pb-6 px-6">
      <input
        ref="fieldEl" v-model="draftValue" type="text" :placeholder="placeholder"
        class="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-gray-900 transition-all placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#EC4141] dark:border-gray-700 dark:bg-black/20 dark:text-white"
      />
    </div>

    <DialogActions
      tone="brand"
      :confirm-label="confirmText"
      :cancel-label="cancelText"
      :confirm-blocked="!draftValue.trim()"
      @confirm="accept"
      @dismiss="dismiss"
    />
  </DialogSurface>
</template>
