<script setup lang="ts">
import type { RemoteSource, RemoteSyncProgress } from '../../../types';

defineProps<{
  sources: RemoteSource[];
  loading: boolean;
  syncingId: string | null;
  progress: RemoteSyncProgress | null;
  percent: number;
  progressCaption: string;
}>();

const emit = defineEmits<{
  edit: [source: RemoteSource];
  sync: [source: RemoteSource];
  browse: [source: RemoteSource];
  remove: [source: RemoteSource];
}>();
</script>

<template>
  <div class="rl-catalog">
    <p v-if="loading" class="rl-blank">加载中...</p>
    <p v-else-if="sources.length === 0" class="rl-blank">还没有远程音乐库</p>
    <template v-else>
      <article v-for="source in sources" :key="source.id" class="rl-catalog__card">
        <div class="rl-catalog__brief">
          <p class="rl-catalog__name">{{ source.name }}</p>
          <p class="rl-catalog__address">{{ source.baseUrl }}{{ source.rootPath }}</p>
          <p v-if="source.lastSyncError" class="rl-catalog__error">{{ source.lastSyncError }}</p>
          <div v-if="progress?.sourceId === source.id && !progress.done" class="rl-meter">
            <div class="rl-meter__legend">
              <span>{{ progressCaption }}</span>
              <span v-if="progress.total > 0">{{ percent }}%</span>
            </div>
            <div class="rl-meter__lane">
              <div class="rl-meter__fill" :style="{ width: `${percent}%` }"></div>
            </div>
          </div>
        </div>
        <div class="rl-catalog__ops">
          <button type="button" class="rl-chip" title="编辑" @click="emit('edit', source)">编辑</button>
          <button
            type="button"
            class="rl-chip"
            :disabled="syncingId === source.id"
            title="同步"
            @click="emit('sync', source)"
          >
            {{ syncingId === source.id ? '同步中' : '同步' }}
          </button>
          <button type="button" class="rl-chip" title="浏览" @click="emit('browse', source)">浏览</button>
          <button type="button" class="rl-chip rl-chip--danger" title="删除" @click="emit('remove', source)">删除</button>
        </div>
      </article>
    </template>
  </div>
</template>

<style scoped>
.rl-catalog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: 12px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(255, 255, 255, 0.2);
  padding: 16px;
}

.rl-catalog__card {
  display: flex;
  align-items: center;
  gap: 16px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.06);
  padding: 14px 16px;
}

.rl-catalog__brief {
  flex: 1 1 0%;
  min-width: 0;
}

.rl-catalog__name,
.rl-catalog__address {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rl-catalog__name {
  color: #111827;
  font-size: 14px;
  font-weight: 600;
}

.rl-catalog__address {
  margin-top: 4px;
  color: #4b5563;
  font-size: 12px;
}

.rl-catalog__error {
  margin-top: 4px;
  color: #ec4141;
  font-size: 12px;
}

.rl-meter {
  margin-top: 10px;
  max-width: 460px;
}

.rl-meter__legend {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: rgb(75 85 99);
  font-size: 12px;
  font-weight: 600;
}

.rl-meter__lane {
  margin-top: 6px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.28);
}

.rl-meter__fill {
  height: 100%;
  border-radius: inherit;
  background: #ec4141;
  transition: width 160ms ease;
}

.rl-catalog__ops {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
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

.rl-chip--danger {
  border-color: rgba(236, 65, 65, 0.18);
  color: #ec4141;
}

.rl-blank {
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  color: rgb(100 116 139);
  font-size: 13px;
}

html.dark .rl-catalog {
  border-color: rgba(31, 41, 55, 0.4);
  background: rgba(0, 0, 0, 0.1);
}

html.dark .rl-catalog__card {
  background: rgba(255, 255, 255, 0.06);
}

html.dark .rl-catalog__name {
  color: #ffffff;
}

html.dark .rl-catalog__address {
  color: rgba(255, 255, 255, 0.55);
}

html.dark .rl-meter__legend {
  color: rgba(255, 255, 255, 0.7);
}
</style>
