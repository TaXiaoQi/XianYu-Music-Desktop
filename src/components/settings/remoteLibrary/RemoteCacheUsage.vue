<script setup lang="ts">
import { computed } from 'vue';
import type { RemoteCacheUsage as CacheMeter } from '../../../types';

const props = defineProps<{
  usage: CacheMeter | null;
  busy: boolean;
}>();

const emit = defineEmits<{ clear: [] }>();

const meterLabel = computed(() => {
  const snapshot = props.usage;
  if (!snapshot) return '0 MB';
  return `${(snapshot.bytes / 1024 / 1024).toFixed(1)} MB / ${(snapshot.limitBytes / 1024 / 1024 / 1024).toFixed(0)} GB`;
});
</script>

<template>
  <div class="rl-storage">
    <span>{{ meterLabel }}</span>
    <button type="button" class="rl-button" :disabled="busy" @click="emit('clear')">
      {{ busy ? '清理中...' : '清理缓存' }}
    </button>
  </div>
</template>

<style scoped>
.rl-storage {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-radius: 12px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(255, 255, 255, 0.2);
  padding: 16px;
  color: rgb(31 41 55);
  font-size: 13px;
  font-weight: 700;
}

.rl-button {
  min-height: 36px;
  border: 1px solid rgba(236, 65, 65, 0.18);
  border-radius: 999px;
  background: #ec4141;
  padding: 0 15px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
}

.rl-button:hover:not(:disabled) {
  background: #d13b3b;
}

.rl-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

html.dark .rl-storage {
  border-color: rgba(31, 41, 55, 0.4);
  background: rgba(0, 0, 0, 0.1);
  color: rgba(255, 255, 255, 0.86);
}
</style>
