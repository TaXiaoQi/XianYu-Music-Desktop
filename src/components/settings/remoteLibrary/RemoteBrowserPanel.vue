<script setup lang="ts">
import { computed } from 'vue';
import type { RemoteFileEntry } from '../../../types';

const props = defineProps<{
  location: string;
  items: RemoteFileEntry[];
  busy: boolean;
}>();

const emit = defineEmits<{
  ascend: [];
  enter: [entry: RemoteFileEntry];
}>();

const orderedItems = computed(() =>
  [...props.items].sort((one, another) => {
    if (one.isDir !== another.isDir) return one.isDir ? -1 : 1;
    return one.name.localeCompare(another.name, 'zh-Hans-CN');
  }),
);
</script>

<template>
  <div class="rl-explorer">
    <div class="rl-explorer__strip">
      <button type="button" class="rl-chip" :disabled="location === '/' || busy" @click="emit('ascend')">上级</button>
      <span class="rl-explorer__trail">{{ location }}</span>
    </div>
    <p v-if="busy" class="rl-blank">读取中...</p>
    <p v-else-if="items.length === 0" class="rl-blank">当前目录为空</p>
    <template v-else>
      <button
        v-for="entry in orderedItems"
        :key="entry.remotePath"
        type="button"
        class="rl-explorer__line"
        :disabled="!entry.isDir"
        @click="emit('enter', entry)"
      >
        <span class="rl-explorer__kind">{{ entry.isDir ? '文件夹' : '音频' }}</span>
        <strong class="rl-explorer__label">{{ entry.name }}</strong>
      </button>
    </template>
  </div>
</template>

<style scoped>
.rl-explorer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 12px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(255, 255, 255, 0.2);
  padding: 16px;
}

.rl-explorer__strip {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgb(55 65 81);
  font-size: 12px;
  font-weight: 700;
}

.rl-explorer__trail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rl-chip {
  min-height: 36px;
  border: 1px solid rgba(236, 65, 65, 0.18);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.07);
  padding: 0 15px;
  color: #ec4141;
  font-size: 12px;
  font-weight: 700;
}

.rl-chip:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.rl-explorer__line {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  border-radius: 10px;
  padding: 10px 12px;
  text-align: left;
  color: rgb(31 41 55);
  background: rgba(0, 0, 0, 0.05);
}

.rl-explorer__line:disabled {
  cursor: default;
  opacity: 0.72;
}

.rl-explorer__kind {
  color: #ec4141;
  font-size: 11px;
  font-weight: 800;
}

.rl-explorer__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 700;
}

.rl-blank {
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  color: rgb(100 116 139);
  font-size: 13px;
}

html.dark .rl-explorer {
  border-color: rgba(31, 41, 55, 0.4);
  background: rgba(0, 0, 0, 0.1);
}

html.dark .rl-explorer__strip,
html.dark .rl-explorer__line {
  color: rgba(255, 255, 255, 0.86);
}

html.dark .rl-explorer__line {
  background: rgba(255, 255, 255, 0.06);
}
</style>
