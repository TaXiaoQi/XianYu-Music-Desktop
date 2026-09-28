<script setup lang="ts">
import WizardGlyph from './WizardGlyph.vue';
import WizardPulse from './WizardPulse.vue';

const props = withDefaults(
  defineProps<{
    label: string;
    size?: 'md' | 'lg';
    busy?: boolean;
    disabled?: boolean;
    icon?: 'export' | 'refresh';
  }>(),
  { size: 'lg', busy: false, disabled: false },
);

const emit = defineEmits<{ press: [] }>();

const spread = props.size === 'lg' ? 'gap-3 px-6 py-4 text-base' : 'gap-2 px-6 py-3.5 text-sm';
</script>

<template>
  <button
    type="button"
    :class="[
      'flex w-full items-center justify-center rounded-xl bg-white/6 border border-white/8 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50',
      spread,
    ]"
    :disabled="props.disabled || props.busy"
    @click="emit('press')"
  >
    <WizardPulse v-if="props.busy" />
    <WizardGlyph v-else-if="props.icon" :name="props.icon" />
    {{ props.label }}
  </button>
</template>
