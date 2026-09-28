<script setup lang="ts">
import type { Song } from '../../../types';
import SettingHint from '../SettingHint.vue';

defineProps<{
  musicTagApp: string;
  targetFolder: string;
  readyToStart: boolean;
  preparedCount: number;
  songs: Song[];
  scanning: boolean;
}>();

defineEmits<{
  (e: 'choose-app'): void;
  (e: 'choose-folder'): void;
  (e: 'begin'): void;
}>();

const SPINNER_ARC =
  'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z';

const pickPathLeaf = (path: string) => {
  const fragments = path.split(/[\\/]/).filter(Boolean);
  return fragments.length > 0 ? fragments[fragments.length - 1] : '未选择';
};
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(520px,3fr)]">
    <section class="toolbox-section space-y-3">
      <h2 class="toolbox-section-title">
        <span class="toolbox-section-bar"></span>
        基础配置
      </h2>

      <div class="toolbox-stack">
        <div class="toolbox-item">
          <div class="mb-3 flex items-center justify-between gap-4">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">MusicTag 路径</div>
            <div class="flex items-center gap-3">
              <SettingHint text="用于歌曲标签写入和人工校对。" />
              <button
                type="button"
                class="toolbox-ghost-btn"
                @click="$emit('choose-app')"
              >
                选择路径
              </button>
            </div>
          </div>
          <div class="toolbox-path-field">
            <span v-if="musicTagApp" class="break-all text-gray-700 dark:text-gray-200">{{ musicTagApp }}</span>
            <span v-else class="text-gray-500 dark:text-white/45">请选择 MusicTag.exe</span>
          </div>
        </div>

        <div class="toolbox-item">
          <div class="mb-3 flex items-center justify-between gap-4">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">目标文件夹</div>
            <div class="flex items-center gap-3">
              <SettingHint severity="warning" text="这里决定本次要处理的整批歌曲文件。" />
              <button
                type="button"
                class="toolbox-ghost-btn"
                @click="$emit('choose-folder')"
              >
                选择文件夹
              </button>
            </div>
          </div>
          <div class="toolbox-path-field">
            <span v-if="targetFolder" class="break-all text-gray-700 dark:text-gray-200">{{ targetFolder }}</span>
            <span v-else class="text-gray-500 dark:text-white/45">请选择要整理的歌曲目录</span>
          </div>
        </div>
      </div>

      <div class="pt-2">
        <button
          type="button"
          class="rounded-xl bg-[#EC4141] px-8 py-3 text-sm font-medium text-white shadow-[0_12px_24px_-12px_rgba(236,65,65,0.6)] transition hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-45"
          :disabled="!readyToStart"
          @click="$emit('begin')"
        >
          开始流程
        </button>
      </div>
    </section>

    <aside class="xl:sticky xl:top-6 xl:self-start">
      <section class="toolbox-section space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="toolbox-section-title">
            <span class="toolbox-section-bar"></span>
            实时预览
          </h2>
          <div class="toolbox-chip">
            {{ preparedCount }}/2
          </div>
        </div>

        <div
          v-if="!targetFolder"
          class="toolbox-panel toolbox-panel--muted text-sm text-gray-500 dark:text-white/45"
        >
          请先在左侧选择目标文件夹，这里会显示该文件夹下所有支持的音频文件。
        </div>

        <div
          v-else-if="scanning"
          class="toolbox-panel toolbox-panel--muted flex items-center justify-center gap-3 text-sm text-gray-500 dark:text-white/45"
        >
          <svg class="h-5 w-5 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" :d="SPINNER_ARC"></path>
          </svg>
          <span>正在扫描文件夹...</span>
        </div>

        <div
          v-else-if="songs.length === 0"
          class="toolbox-panel border border-amber-200/70 bg-amber-50/80 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
        >
          该文件夹下没有找到支持的音频文件。
        </div>

        <div v-else class="toolbox-list">
          <div class="toolbox-list-header">
            <span>歌曲预览</span>
            <span class="text-xs font-normal text-gray-500 dark:text-white/45">共 {{ songs.length }} 首</span>
          </div>
          <div class="max-h-[420px] overflow-y-auto">
            <div
              v-for="song in songs"
              :key="song.path"
              class="toolbox-list-row"
            >
              <div class="truncate text-sm text-gray-700 dark:text-gray-200">{{ pickPathLeaf(song.path) }}</div>
            </div>
          </div>
        </div>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.toolbox-section {
  padding: 16px 20px;
}

.toolbox-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--text-primary, #1f2937);
}

:root.dark .toolbox-section-title {
  color: var(--text-primary, #e5e7eb);
}

.toolbox-section-bar {
  display: inline-block;
  width: 4px;
  height: 16px;
  border-radius: 9999px;
  background: #ec4141;
}

.toolbox-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbox-item {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 10px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.2);
  transition: background 0.2s, border-color 0.2s;
}

.toolbox-item:hover {
  border-color: rgba(229, 231, 235, 0.5);
  background: rgba(229, 231, 235, 0.4);
}

.toolbox-ghost-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  background: #ec4141;
  font-size: 0.75rem;
  font-weight: 600;
  color: #ffffff;
  cursor: pointer;
  transition: background 160ms ease;
}

.toolbox-ghost-btn:hover {
  background: #d13b3b;
}

.toolbox-path-field {
  border: 1px dashed rgba(229, 231, 235, 0.5);
  border-radius: 8px;
  padding: 10px 14px;
  background: rgba(243, 244, 246, 1);
  font-size: 0.75rem;
}

.toolbox-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 9999px;
  padding: 3px 10px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary, #9ca3af);
  background: rgba(243, 244, 246, 0.6);
}

.toolbox-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
}

.toolbox-panel--muted {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  padding: 20px 24px;
  background: rgba(255, 255, 255, 0.2);
}

.toolbox-list {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  overflow: hidden;
}

.toolbox-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
}

:root.dark .toolbox-list-header {
  color: var(--text-primary, #ffffff);
}

.toolbox-list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(229, 231, 235, 0.2);
  transition: background 160ms ease;
}

.toolbox-list-row:last-child {
  border-bottom: none;
}

.toolbox-list-row:hover {
  background: rgba(243, 244, 246, 0.5);
}
</style>
