<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  /** 行标题 */
  label: string;
  /** 开关当前状态 */
  checked: boolean;
}>();

const emit = defineEmits<{ toggle: [value: boolean] }>();

const title = computed(() => props.label);

function flip() {
  emit('toggle', !props.checked);
}
</script>

<template>
  <div class="flex items-center justify-between p-4 transition-colors hover:bg-white/40 dark:hover:bg-white/10">
    <div>
      <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ title }}</div>
    </div>
    <button type="button" class="glass-switch" :class="{ 'is-checked': checked }" @click="flip"></button>
  </div>
</template>
