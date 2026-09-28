<!-- 信息栏顶部条：标题、编辑开关与信息栏放大/还原按钮 -->
<script setup lang="ts">
import { SquarePen } from 'lucide-vue-next';

defineProps<{
  editing: boolean;
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-edit'): void;
  (e: 'toggle-expand'): void;
}>();

// 两个方向的角标 path 数据：展开时显示还原箭头
const CORNER_PATH_ENLARGE = 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5';
const CORNER_PATH_RESTORE = 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5';
</script>

<template>
  <div class="song-info-header modal-external-header">
    <div class="song-info-header-title">
      <h2 class="text-lg font-bold dark:text-white text-gray-900">歌曲信息</h2>
      <button
        type="button"
        class="song-info-edit-toggle"
        :class="editing ? 'song-info-edit-toggle--active' : ''"
        :aria-label="editing ? '取消编辑歌曲信息' : '编辑歌曲信息'"
        :title="editing ? '取消编辑歌曲信息' : '编辑歌曲信息'"
        @click="emit('toggle-edit')"
      >
        <SquarePen class="h-4 w-4" :stroke-width="2.2" />
      </button>
    </div>
    <button
      type="button"
      class="lyrics-editor-expand-button"
      :title="expanded ? '还原歌曲信息' : '放大歌曲信息'"
      @click="emit('toggle-expand')"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path
          :d="expanded ? CORNER_PATH_RESTORE : CORNER_PATH_ENLARGE"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </div>
</template>
