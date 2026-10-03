<script setup lang="ts">
import { computed } from 'vue';
import { GripVertical, Info, KeyRound, Puzzle, RefreshCw, Trash2 } from 'lucide-vue-next';
import type { PluginSource } from '../../../types';
import type { PluginUpdateCheckResult } from '../../../services/domain/pluginEngine';
import { pluginColorClasses } from './pluginStyles';

const props = defineProps<{
  plugin: PluginSource;
  index: number;
  dragging: boolean;
  searchQuery: string;
  isBaka: boolean;
  hasUserVars: boolean;
  subBrandLabel?: string;
  updateCheck?: PluginUpdateCheckResult;
  updating: boolean;
}>();

defineEmits<{
  (e: 'drag-start', index: number, event: PointerEvent): void;
  (e: 'open-detail', plugin: PluginSource): void;
  (e: 'update', plugin: PluginSource): void;
  (e: 'uninstall', plugin: PluginSource): void;
  (e: 'toggle', plugin: PluginSource): void;
}>();

const colorClasses = computed(() => pluginColorClasses(props.plugin.format, props.isBaka));
</script>

<template>
  <div
    data-plugin-row
    class="settings-plugin-card"
    :class="{
      'settings-plugin-card--dragging': dragging,
    }"
  >
    <div
      class="plugin-drag-handle touch-none select-none"
      :class="{
        'plugin-drag-handle--disabled': !!searchQuery.trim(),
        'cursor-grabbing': dragging,
        'cursor-grab': !dragging,
      }"
      @pointerdown="$emit('drag-start', index, $event)"
    >
      <GripVertical class="h-5 w-5" />
    </div>
    <div class="flex items-center gap-3 min-w-0 flex-1">
      <div
        class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        :class="[colorClasses.iconBg, colorClasses.iconText]"
      >
        <Puzzle class="h-5 w-5" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 min-w-0">
          <div class="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate min-w-0">
            {{ plugin.name }}
          </div>
          <span
            class="settings-plugin-tag shrink-0 whitespace-nowrap"
            :class="colorClasses.tagClass"
          >
            {{ colorClasses.label }}
          </span>
          <span
            v-if="subBrandLabel"
            class="settings-plugin-tag settings-plugin-tag--brand shrink-0 whitespace-nowrap"
            title="付费订阅来源"
          >
            {{ subBrandLabel }}
          </span>
          <span
            v-if="plugin.updateAvailable"
            class="settings-plugin-tag settings-plugin-tag--accent shrink-0 whitespace-nowrap"
          >
            可更新
          </span>
          <span
            v-if="hasUserVars"
            class="settings-plugin-tag settings-plugin-tag--vars shrink-0 whitespace-nowrap"
            title="此插件支持用户变量配置"
          >
            <KeyRound class="h-3 w-3 shrink-0" />
            <span class="whitespace-nowrap">变量</span>
          </span>
        </div>
        <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5 truncate">
          v{{ plugin.version }}
          <span v-if="plugin.author"> · {{ plugin.author }}</span>
          <span v-if="plugin.description"> · {{ plugin.description }}</span>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        class="settings-plugin-icon-button"
        title="详情信息"
        @click="$emit('open-detail', plugin)"
      >
        <Info class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="settings-plugin-icon-button"
        :class="{
          'settings-plugin-icon-button--updating': updating,
          'settings-plugin-icon-button--update-available': !!updateCheck?.hasUpdate,
        }"
        :disabled="updating"
        :title="updateCheck?.hasUpdate
          ? `${plugin.name} 可更新到 v${updateCheck?.newVersion}，点击执行更新`
          : (updating ? '正在更新...' : `检查 ${plugin.name} 的更新`)"
        @click="$emit('update', plugin)"
      >
        <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': updating }" />
      </button>
      <button
        type="button"
        class="settings-plugin-icon-button settings-plugin-icon-button--danger"
        title="卸载此插件"
        @click="$emit('uninstall', plugin)"
      >
        <Trash2 class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="glass-switch ml-1"
        :class="{ 'is-checked': plugin.enabled }"
        @click="$emit('toggle', plugin)"
      ></button>
    </div>
  </div>
</template>

<style scoped>
.settings-plugin-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border: none; /* 样式 */
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 0;
  background: transparent;
  transition: background-color 160ms ease; /* 样式 */
}

.settings-plugin-card:last-child {
  border-bottom: none;
}

.settings-plugin-card:hover {
  background: rgba(255, 255, 255, 0.4);
}

.plugin-drag-handle { /* 样式 */
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
  justify-content: center; /* 样式 */
  width: 24px; /* 样式 */
  height: 24px; /* 样式 */
  border-radius: 6px; /* 样式 */
  color: rgba(148, 163, 184, 0.6); /* 样式 */
  cursor: grab; /* 样式 */
  flex-shrink: 0; /* 样式 */
  transition: color 160ms ease, background-color 160ms ease; /* 样式 */
} /* 样式 */
.plugin-drag-handle:hover { /* 样式 */
  color: rgba(100, 116, 139, 0.9); /* 样式 */
  background: rgba(148, 163, 184, 0.1); /* 样式 */
} /* 样式 */
.plugin-drag-handle:active { /* 样式 */
  cursor: grabbing; /* 样式 */
} /* 样式 */
.plugin-drag-handle--disabled { /* 样式 */
  opacity: 0.3; /* 样式 */
  cursor: not-allowed; /* 样式 */
} /* 样式 */
.settings-plugin-card--dragging { /* 样式 */
  background: rgba(236, 65, 65, 0.06); /* 样式 */
}

.plugin-sort-move {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
} /* 样式 */
@media (prefers-reduced-motion: reduce) {
  .plugin-sort-move {
    transition: none;
  }
} /* 样式 */
</style>
