<script setup lang="ts">
import WizardPulse from './WizardPulse.vue';

withDefaults(
  defineProps<{
    leftLabel?: string;
    leftExtra?: string;
    rightLabel?: string;
    rightDisabled?: boolean;
    rightBusy?: boolean;
    centered?: boolean;
  }>(),
  {
    leftLabel: '',
    leftExtra: '',
    rightLabel: '',
    rightDisabled: false,
    rightBusy: false,
    centered: false,
  },
);

const emit = defineEmits<{ left: []; right: [] }>();
</script>

<template>
  <div class="flex gap-3 border-t border-white/6 pt-4">
    <button
      v-if="leftLabel"
      type="button"
      :class="[
        'flex-1 rounded-xl border border-white/10 bg-transparent px-6 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5',
        leftExtra,
      ]"
      @click="emit('left')"
    >
      {{ leftLabel }}
    </button>
    <button
      v-if="rightLabel"
      type="button"
      :class="[
        centered ? 'flex flex-1 items-center justify-center gap-2' : 'flex-1',
        'rounded-xl bg-[#EC4141] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-50',
      ]"
      :disabled="rightDisabled"
      @click="emit('right')"
    >
      <WizardPulse v-if="rightBusy" />
      {{ rightLabel }}
    </button>
  </div>
</template>
