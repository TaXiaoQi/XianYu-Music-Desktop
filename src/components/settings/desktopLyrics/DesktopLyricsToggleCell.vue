<script setup lang="ts">
const props = defineProps<{
  /** 开关当前状态 */
  checked: boolean;
}>();

const emit = defineEmits<{ toggle: [value: boolean] }>();

function flip() {
  emit('toggle', !props.checked);
}
</script>

<template>
  <div class="dlx-toggle-cell flex items-center justify-between">
    <div class="dlx-toggle-label shrink-0"><slot /></div>
    <button type="button" class="glass-switch" :class="{ 'is-checked': checked }" @click="flip"></button>
  </div>
</template>

<style scoped>
.dlx-toggle-cell {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 7px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(229, 231, 235, 0.4);
  transition: all 180ms ease;
}

:global(.dark) .dlx-toggle-cell {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(31, 41, 55, 0.4);
}

.dlx-toggle-cell:hover {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(236, 65, 65, 0.35);
}

:global(.dark) .dlx-toggle-cell:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(236, 65, 65, 0.35);
}

.dlx-toggle-label {
  font-size: 13px;
  font-weight: 700;
  color: rgb(55 65 81);
  user-select: none;
  white-space: nowrap;
}

:global(.dark) .dlx-toggle-label {
  color: rgba(255, 255, 255, 0.68);
}
</style>
